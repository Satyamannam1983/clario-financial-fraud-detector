/**
 * Clario — Vercel Serverless Entry Point
 *
 * Adapts the existing server.js request handler for Vercel's serverless runtime.
 * Each invocation shares module-level state within a warm lambda, but state is NOT
 * guaranteed between cold starts. MongoDB is used for all persistence so that
 * reconciliation runs, audit events, actions and investigations survive restarts.
 *
 * Required environment variables (set in Vercel project dashboard):
 *   MONGODB_URI      — MongoDB Atlas connection string (required for persistence)
 *   MONGODB_DB       — database name (default: ledgerpilot)
 *   MISTRAL_API_KEY  — Mistral AI key (optional; deterministic fallback if absent)
 *   MISTRAL_MODEL    — model id (default: mistral-small-2506)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const db = require('../db');
const ai = require('../ai');
const risk = require('../ai/risk');

// ── Load .env for local dev (Vercel injects env vars natively in production) ──
function loadEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnv();

// ── Shared module-level state (warm lambda) ────────────────────────────────────
const root = path.join(__dirname, '..');
const sessions = new Map();
const users = new Map([['demo@clario.ai', { name: 'Arjun Shah', email: 'demo@clario.ai', role: 'Finance admin' }]]);
const sessionSecret = process.env.CLARIO_SESSION_SECRET || 'clario-demo-session-secret-change-me';
const audit = [];
const actions = new Map();
const investigations = new Map();
const runs = new Map();
const activity = [];
const settingsStore = {
  rules: { amountTolerance: 1000, timestampToleranceMinutes: 30, fuzzyMatchThreshold: 85, autoResolutionThreshold: 90 },
  ai: { investigation: true, patternDetection: true, autoResolution: false, humanApproval: true },
  notifications: { critical: true, failedReconciliation: false, recurringPatterns: true, dailyReport: false }
};
let riskSnapshots = [];
let riskBlockCache = { signature: null, block: null };
let databaseReady = false;
let initialized = false;

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'finance-data.js'), 'utf8'), sandbox);
const data = sandbox.window.ledgerPilotData;

// ── Import helpers from server.js logic (shared implementations) ───────────────
// We inline the handler here to avoid duplicating server.js for the serverless case.
// The actual business logic lives in db.js, ai/, and risk.js — this file is only glue.

const STATE_LABELS = { matched: 'Matched', review: 'Needs Review', failed: 'Failed', on_hold: 'On Hold', resolved: 'Resolved', escalated: 'Escalated', approved: 'Approved' };

function recordState(record, action) {
  if (action === 'hold') return 'on_hold';
  if (action === 'resolve') return 'resolved';
  if (action === 'approve') return 'approved';
  if (action === 'escalate') return 'escalated';
  if (record.status === 'Matched') return 'matched';
  if (record.risk?.tier === 'Medium') return 'review';
  return 'failed';
}

function patternLabel(pattern) {
  const labels = { missing_settlement: 'Missing settlement', duplicate: 'Duplicate transaction', refund_mismatch: 'Refund mismatch', settlement_delay: 'Settlement delay', fee_variance: 'Fee variance', fuzzy: 'Reference similarity', exact: 'Matched' };
  return labels[pattern] || 'Amount mismatch';
}

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function auth(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  if (sessions.has(token)) return sessions.get(token);
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const user = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return user && user.email ? user : null;
  } catch {
    return null;
  }
}

function createSessionToken(user) {
  const encoded = Buffer.from(JSON.stringify({ ...user, iat: Date.now() }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function recordAudit(title, detail, kind = 'done') {
  const event = typeof title === 'object' ? { time: new Date().toISOString(), kind: 'done', ...title } : { time: new Date().toISOString(), title, detail, kind };
  audit.unshift(event);
  void db.saveAudit(event);
  return event;
}

async function getRecords() {
  if (databaseReady) {
    const stored = await db.records();
    if (stored && stored.length > 0) { data.records = stored; return stored; }
  }
  return data.records;
}

async function saveRecords(records) {
  data.records = records;
  if (databaseReady) await db.saveRecords(records);
}

async function getRecord(id) {
  const records = await getRecords();
  return records.find(r => r.id === id) || null;
}

function annotateRecords(records, sourceActions = new Map()) {
  return records.map(record => {
    const r = risk.riskScore(record, records);
    const action = sourceActions.get(record.id) || null;
    return { ...record, risk: r, risk_score: r.score, risk_tier: r.tier, risk_recommendation: r.recommendation, risk_reasons: r.risk_reasons, risk_breakdown: r.breakdown, state: recordState(record, action), resolution: action };
  });
}

function recordActivity(title, detail, kind = 'done', runId = null) {
  const event = typeof title === 'object' ? { time: new Date().toISOString(), kind: 'done', ...title } : { time: new Date().toISOString(), title, detail, kind, runId };
  activity.unshift(event);
  void db.saveActivity(event);
  return event;
}

async function getSummary(sourceActions = actions) {
  const recs = await getRecords();
  const values = sourceActions instanceof Map ? [...sourceActions.values()] : [];
  const resolved = values.filter(a => a === 'resolve' || a === 'approve').length;
  const escalated = values.filter(a => a === 'escalate').length;
  const held = values.filter(a => a === 'hold').length;
  const exceptions = recs.filter(r => r.status === 'Exception' || r.status === 'Needs Review').length;
  return { total: recs.length, matched: recs.filter(r => r.status === 'Matched').length, exceptions, resolved, escalated, held, open: exceptions - resolved };
}

async function reconciliationPipeline() {
  const recs = await getRecords();
  const stages = ['IMPORT', 'NORMALIZE', 'MATCH', 'INVESTIGATE', 'RESOLVE'];
  const recurring = recs.reduce((map, record) => {
    const key = record.pattern === 'exact' ? null : `${record.pattern}:${record.difference ?? 'missing'}`;
    if (key) map[key] = (map[key] || 0) + 1;
    return map;
  }, {});
  return { stages, recurring: Object.entries(recurring).map(([key, count]) => ({ key, count, pattern: key.split(':')[0] })).filter(item => item.count >= 2) };
}

async function reportData() {
  const current = await getSummary();
  const recs = await getRecords();
  const byPattern = recs.reduce((out, r) => { out[r.pattern] = (out[r.pattern] || 0) + 1; return out; }, {});
  const pipeline = await reconciliationPipeline();
  const exceptions = recs.filter(r => r.status !== 'Matched');
  const agingTier = r => { if (r.pattern === 'missing_settlement' || r.pattern === 'refund_mismatch') return '7+ days'; if (r.pattern === 'amount_mismatch' || r.pattern === 'duplicate') return '3-7 days'; if (r.pattern === 'settlement_delay') return '1-3 days'; return '< 24 hours'; };
  const aging = exceptions.reduce((out, r) => { const t = agingTier(r); out[t] = (out[t] || 0) + 1; return out; }, {});
  const severity = exceptions.reduce((out, r) => { const k = r.severity === 'Critical' ? 'Critical' : r.severity === 'High' ? 'High' : 'Medium'; out[k] = (out[k] || 0) + 1; return out; }, {});
  const byType = exceptions.reduce((out, r) => { const e = out[r.pattern] || (out[r.pattern] = { count: 0, impact: 0 }); e.count += 1; e.impact += Math.abs(r.difference || r.payment.amount || 0); return out; }, {});
  const statusBreakdown = { open: 0, resolved: 0, escalated: 0, onHold: 0 };
  for (const r of exceptions) { const a = actions.get(r.id); if (a === 'hold') statusBreakdown.onHold += 1; else if (a === 'escalate') statusBreakdown.escalated += 1; else if (a === 'resolve' || a === 'approve') statusBreakdown.resolved += 1; else statusBreakdown.open += 1; }
  const riskRecords = annotateRecords(recs, actions);
  const riskStats = risk.riskStats(riskRecords, actions);
  const states = { matched: 0, review: 0, failed: 0, on_hold: 0, resolved: 0, escalated: 0, approved: 0 };
  for (const r of riskRecords) states[r.state] = (states[r.state] || 0) + 1;
  const flaggedList = [...riskStats.highFlags, ...riskStats.mediumFlags].sort((a, b) => b.risk.score - a.risk.score).map(r => ({ id: r.id, score: r.risk.score, tier: r.risk.tier, reason: risk.flagReason(r, r.risk), impact: r.payment?.amount || 0, action: r.risk.recommendation === 'hold' ? 'Hold' : r.risk.recommendation === 'review' ? 'Review' : 'Continue', status: r.status, state: r.state }));
  const signature = `${recs.length}|${actions.size}|${riskSnapshots.length}|${current.matched}|${riskStats.high}`;
  if (riskBlockCache.signature !== signature) {
    riskBlockCache = { signature, block: { stats: { high: riskStats.high, medium: riskStats.medium, low: riskStats.low, atRiskValue: riskStats.atRiskValue, holds: riskStats.holds }, topSignals: risk.topSignals(riskRecords), trend: risk.riskTrend(riskSnapshots), rootCause: risk.rootCause(riskRecords), flagged: flaggedList, flaggedTotal: flaggedList.length } };
  }
  const riskBlock = riskBlockCache.block;
  const previous = [...runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[1];
  const previousRun = previous ? { total: previous.recordsTotal ?? previous.records?.length ?? 150, matched: previous.matched ?? 120, exceptions: previous.exceptions ?? 30 } : { total: 150, matched: 120, exceptions: 30 };
  const comparison = { previous: { ...previousRun, matchRate: Number((previousRun.matched / previousRun.total * 100).toFixed(1)) }, current: { ...current, matchRate: Number((current.matched / current.total * 100).toFixed(1)) } };
  return { metrics: { total: current.total, matched: current.matched, exceptions: current.exceptions, openExceptions: current.open, matchRate: current.total ? Number((current.matched / current.total * 100).toFixed(1)) : 0, autoResolutionRate: current.exceptions ? Number((current.resolved / current.exceptions * 100).toFixed(1)) : 0, recoveredValue: recs.filter(r => actions.get(r.id) === 'resolve').reduce((sum, r) => sum + Math.abs(r.difference || 0), 0) }, byPattern, byType, aging, severity, statusBreakdown, states, comparison, risk: riskBlock, recurring: pipeline.recurring };
}

// ── Attach AI runtime ──────────────────────────────────────────────────────────
ai.attach({ getRecords, saveRecords, getRecord, getAction: id => actions.get(id) || null, saveAction: async (id, actionName) => { actions.set(id, actionName); riskBlockCache.signature = null; await db.saveAction(id, actionName); }, getInvestigation: async id => investigations.get(id) || await db.getInvestigation(id), saveInvestigation: async (id, inv) => { investigations.set(id, inv); await db.saveInvestigation(id, inv); }, saveRun: async run => { runs.set(run.runId, run); await db.saveRun(run); }, savePattern: p => db.savePattern(p), recordActivity, recordAudit, getSummary, reportData, activityEvents: () => activity });

// ── Init (runs once per cold start) ───────────────────────────────────────────
async function init() {
  if (initialized) return;
  initialized = true;
  try {
    databaseReady = Boolean(await db.connectDatabase(data));
    if (databaseReady) {
      const storedAudit = await db.auditEvents(); if (storedAudit) audit.push(...storedAudit);
      const storedActions = await db.actionMap(); if (storedActions) storedActions.forEach((a, id) => actions.set(id, a));
      const storedRuns = await db.runs(); if (storedRuns) storedRuns.forEach(r => runs.set(r.runId, r));
      const storedActivity = await db.activity(); if (storedActivity) activity.push(...storedActivity);
      const storedSnapshots = await db.riskSnapshots(); if (storedSnapshots) riskSnapshots = storedSnapshots;
    }
  } catch (err) {
    console.warn('MongoDB init failed; using demo state:', err.message);
    databaseReady = false;
  }
}

// ── Request handler (same logic as server.js, without http.createServer) ──────
async function handler(req, res) {
  await init();
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Max-Age': '86400' });
    res.end(); return;
  }

  try {
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'clario-api', database: databaseReady ? 'connected' : 'demo', mistral: ai.available() });
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.email?.trim().toLowerCase() !== 'demo@clario.ai' || body.password !== 'ClarioDemo123!') return json(res, 401, { error: 'Invalid demo credentials' });
      const token = createSessionToken(user);
      const user = { name: 'Arjun Shah', email: 'demo@clario.ai', role: 'Finance admin' };
      sessions.set(token, user);
      recordAudit('User signed in', user.email, 'active');
      return json(res, 200, { token, user });
    }
    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'Enter a valid email address' });
      if (password.length < 8) return json(res, 400, { error: 'Password must be at least 8 characters' });
      if (users.has(email)) return json(res, 409, { error: 'An account already exists for this email' });
      const user = { name: name || email.split('@')[0], email, role: 'Finance admin' };
      users.set(email, user);
      const token = createSessionToken(user);
      sessions.set(token, user);
      recordAudit('User account created', email, 'active');
      recordActivity('User registered', `${user.name} · ${email}`, 'done');
      return json(res, 201, { token, user });
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const user = auth(req);
      if (user) recordAudit('User signed out', user.email, 'done');
      sessions.delete((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      return json(res, 200, { ok: true });
    }
    if (!auth(req)) return json(res, 401, { error: 'Authentication required' });
    if (url.pathname === '/api/me' || url.pathname === '/api/auth/me') return json(res, 200, { user: auth(req) });
    if (url.pathname === '/api/ai/controller' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await ai.handleController(body.message || body.prompt || '', { context: body.context || {} });
      return json(res, 200, result);
    }
    if (url.pathname === '/api/dashboard' || url.pathname === '/api/dashboard/summary') {
      const pipeline = await reconciliationPipeline();
      return json(res, 200, { summary: await getSummary(), activity: activity.slice(0, 10), recurring: pipeline.recurring });
    }
    if (url.pathname === '/api/transactions' && req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const status = url.searchParams.get('status');
      const sort = url.searchParams.get('sort') || 'id';
      const order = url.searchParams.get('order') === 'desc' ? -1 : 1;
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 25)));
      const source = await getRecords();
      let rows = annotateRecords(source, actions).filter(r => (!q || JSON.stringify(r).toLowerCase().includes(q)) && (!status || status === 'All' || r.status === status || (status === 'Missing' && !r.settlement)));
      rows.sort((a, b) => { const av = sort === 'amount' ? a.payment.amount : sort === 'status' ? a.status : a.id; const bv = sort === 'amount' ? b.payment.amount : sort === 'status' ? b.status : b.id; return (av > bv ? 1 : av < bv ? -1 : 0) * order; });
      const total = rows.length;
      return json(res, 200, { records: rows.slice((page - 1) * limit, page * limit), page, limit, total, pages: Math.ceil(total / limit) });
    }
    if (url.pathname === '/api/reconciliation/runs' && req.method === 'GET') {
      const stored = databaseReady ? await db.runs() : null;
      return json(res, 200, { runs: stored || [...runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)) });
    }
    const runStatus = url.pathname.match(/^\/api\/reconciliation\/runs\/([^/]+)$/);
    if (runStatus && req.method === 'GET') { const run = runs.get(runStatus[1]) || (databaseReady ? await db.getRun(runStatus[1]) : null); return run ? json(res, 200, run) : json(res, 404, { error: 'Run not found' }); }
    if ((url.pathname === '/api/ai/activity' || url.pathname === '/api/activity') && req.method === 'GET') {
      const stored = databaseReady ? await db.activity(Number(url.searchParams.get('limit') || 100)) : null;
      return json(res, 200, { events: stored || activity });
    }
    if (url.pathname === '/api/ai/agents' && req.method === 'GET') {
      const agents = [{ id: 'controller', name: 'AI Controller', role: 'Routes requests to the right agent', online: true }, { id: 'reconciliation', name: 'Reconciliation Agent', role: 'Runs import · normalize · match', online: true }, { id: 'investigation', name: 'Investigation Agent', role: 'Evidence-based exception analysis', online: true }, { id: 'pattern', name: 'Pattern Agent', role: 'Recurring risk detection', online: true }, { id: 'resolution', name: 'Resolution Agent', role: 'Policy-checked actions & audit', online: true }];
      for (const agent of agents) { const own = activity.filter(e => e.agent === agent.id); agent.executions = own.length; agent.lastAt = own[0]?.time || null; }
      return json(res, 200, { agents, totalExecutions: activity.length });
    }
    if (url.pathname === '/api/settings' && req.method === 'GET') return json(res, 200, settingsStore);
    if (url.pathname === '/api/settings' && req.method === 'PUT') {
      const body = await readBody(req);
      for (const group of ['rules', 'ai', 'notifications']) { if (!body[group] || typeof body[group] !== 'object') continue; for (const [key, value] of Object.entries(body[group])) { if (!(key in settingsStore[group])) continue; if (typeof settingsStore[group][key] === 'number') settingsStore[group][key] = Number(value) || settingsStore[group][key]; else if (typeof settingsStore[group][key] === 'boolean') settingsStore[group][key] = Boolean(value); } }
      recordAudit('Settings updated', 'Reconciliation rules, AI policies or notifications changed', 'done');
      return json(res, 200, settingsStore);
    }
    if ((url.pathname === '/api/reconciliation/recurring' || url.pathname === '/api/patterns/recurring') && req.method === 'GET') { const pipeline = await reconciliationPipeline(); return json(res, 200, { patterns: pipeline.recurring }); }
    if (url.pathname === '/api/reconciliation' && req.method === 'GET') {
      const sourceRecords = await getRecords();
      const storedActions = databaseReady ? await db.actionMap() : null;
      const sourceActions2 = storedActions || actions;
      const query = (url.searchParams.get('q') || '').toLowerCase();
      const status = url.searchParams.get('status');
      const records = annotateRecords(sourceRecords, sourceActions2).filter(r => (!query || JSON.stringify(r).toLowerCase().includes(query)) && (!status || status === 'All' || r.status === status || (status === 'Missing' && !r.settlement)));
      return json(res, 200, { records, summary: await getSummary(sourceActions2) });
    }
    if (url.pathname === '/api/dashboard/live-records' && req.method === 'GET') {
      const recs = await getRecords();
      const records = annotateRecords(recs, actions).filter(r => r.state !== 'resolved').sort((a, b) => (b.severity === 'Critical') - (a.severity === 'Critical') || b.payment.amount - a.payment.amount).slice(0, 12);
      return json(res, 200, { records, summary: await getSummary() });
    }
    if (url.pathname === '/api/reconciliation/run' && req.method === 'POST') {
      const result = await ai.runReconciliation('Run reconciliation');
      if (result.success === false) return json(res, 500, { error: result.error || result.final_response });
      if (result.run?.runId && !riskSnapshots.some(s => s.run_id === result.run.runId)) {
        const all = annotateRecords(await getRecords(), actions);
        const stats = risk.riskStats(all, actions);
        const snapshot = { run_id: result.run.runId, date: new Date().toISOString().slice(0, 10), high: stats.high, medium: stats.medium, low: stats.low, at_risk_value: stats.atRiskValue };
        riskSnapshots.push(snapshot);
        await db.saveRiskSnapshot(snapshot);
      }
      return json(res, 202, result.run);
    }
    if (url.pathname === '/api/audit' && req.method === 'GET') { const stored = databaseReady ? await db.auditEvents() : null; return json(res, 200, { events: stored && stored.length ? stored : audit }); }
    if (url.pathname === '/api/reports' && req.method === 'GET') { const report = await reportData(); return json(res, 200, { ...report, metrics: { ...report.metrics, matchRate: `${report.metrics.matchRate}%`, autoResolutionRate: `${report.metrics.autoResolutionRate}%`, recoveredValue: `₹${report.metrics.recoveredValue.toLocaleString('en-IN')}` } }); }
    if (url.pathname === '/api/reports/data' && req.method === 'GET') return json(res, 200, await reportData());
    if ((url.pathname === '/api/reports.csv' || url.pathname === '/api/reports/csv') && req.method === 'GET') {
      const report = await reportData();
      const lines = [['metric', 'value'], ...Object.entries(report.metrics), ['recurring_patterns', report.recurring.length]].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="reconciliation-report.csv"', 'Access-Control-Allow-Origin': '*' });
      return res.end(lines.join('\n'));
    }
    const timelineMatch = url.pathname.match(/^\/api\/exceptions\/([^/]+)\/timeline$/);
    if (timelineMatch && req.method === 'GET') {
      const id = timelineMatch[1];
      const record = await getRecord(id);
      if (!record) return json(res, 404, { error: 'Exception not found' });
      // Build a simple timeline inline
      const riskM = risk.riskScore(record, await getRecords());
      const inv = investigations.get(id) || await db.getInvestigation(id);
      const action = actions.get(id) || null;
      const steps = [];
      const pay = record.payment || {};
      const t = m => { const d = new Date(Date.now() - m * 60000); return d.toTimeString().slice(0, 5); };
      steps.push({ time: t(30), title: 'Transaction received', detail: `Payment ${pay.payment_id || '–'} captured · ₹${Math.round(pay.amount || 0).toLocaleString('en-IN')}`, kind: 'system' });
      steps.push({ time: t(29), title: 'Reconciliation failed', detail: `${patternLabel(record.pattern)} detected against settlement records`, kind: 'system' });
      steps.push({ time: t(27), title: 'Risk analysis completed', detail: `Score ${riskM.score}/100 computed from ${riskM.signals.length} rule-based signals`, kind: 'risk' });
      steps.push({ time: t(26), title: `Risk score ${riskM.score} — ${riskM.tier}`, detail: riskM.risk_reasons[0]?.explanation || 'No material risk signals', kind: 'risk' });
      if (inv) {
        steps.push({ time: t(25), title: 'AI investigation started', detail: 'Evidence gathering across payment, order, settlement and fee', kind: 'ai' });
        steps.push({ time: t(22), title: 'Evidence collected', detail: `${(inv.evidence || []).length} evidence items indexed`, kind: 'ai' });
        steps.push({ time: t(20), title: 'AI recommendation', detail: inv.recommended_action || riskM.recommendation, kind: 'ai' });
      } else {
        steps.push({ time: t(22), title: 'Held for investigation', detail: 'No AI investigation run yet for this case', kind: 'ai' });
      }
      if (action) {
        const verb = action === 'hold' ? 'placed transaction on hold' : action === 'approve' ? 'approved the transaction' : action === 'escalate' ? 'escalated to finance' : 'resolved the transaction';
        const auditEntry = audit.find(e => e.title === 'human_decision' && String(e.detail || '').includes(id));
        const actor = auditEntry ? String(auditEntry.detail).replace(/^.*\bby\s+/, '') : 'Finance user';
        steps.push({ time: t(18), title: `Human ${verb}`, detail: `Decision recorded in the audit trail by ${actor}`, kind: 'human' });
      } else {
        steps.push({ time: t(18), title: 'Awaiting human decision', detail: riskM.tier === 'High' ? 'Policy requires human approval before anything can be released' : 'Policy requires a human review before release', kind: 'human' });
      }
      return json(res, 200, { id, timeline: steps });
    }
    const investigationMatch = url.pathname.match(/^\/api\/exceptions\/([^/]+)\/investigate$/);
    if (investigationMatch && req.method === 'POST') { const id = investigationMatch[1]; const result = await ai.investigate(id, `Investigate ${id}`); if (!result.investigation) return json(res, result.error?.includes('not found') ? 404 : 400, { error: result.error || result.final_response }); return json(res, 200, { id, investigation: result.investigation }); }
    const investigationRead = url.pathname.match(/^\/api\/exceptions\/([^/]+)\/investigation$/);
    if (investigationRead && req.method === 'GET') { const inv = investigations.get(investigationRead[1]) || await db.getInvestigation(investigationRead[1]); if (!inv) return json(res, 404, { error: 'Investigation not found' }); return json(res, 200, { id: investigationRead[1], investigation: inv }); }
    const actionMatch = url.pathname.match(/^\/api\/exceptions\/([^/]+)\/(resolve|escalate|approve|hold)$/);
    if (actionMatch && req.method === 'POST') {
      const [, id, actionName] = actionMatch;
      const result = await ai[actionName](id);
      if (result.success === false) { const status = result.error === 'policy_denied' ? 409 : /not found/i.test(result.final_response || result.error || '') ? 404 : 409; return json(res, status, { error: result.final_response || result.error, policy: result.policy }); }
      const actor = auth(req)?.name || 'Finance user';
      recordActivity('Human decision applied', `${actor} · ${actionName} → ${id}`, 'active');
      recordAudit({ title: 'human_decision', detail: `${id} · ${actionName} by ${actor}`, kind: 'active', actor });
      return json(res, 200, { id, action: actionName, summary: result.summary || await getSummary(), policy: result.policy });
    }
    const genericAction = url.pathname.match(/^\/api\/actions\/([^/]+)$/);
    if (genericAction && req.method === 'POST') {
      const body = await readBody(req);
      const actionName = body.action || 'approve';
      if (!['approve', 'resolve', 'escalate', 'hold'].includes(actionName)) return json(res, 400, { error: 'Unsupported action' });
      const id = genericAction[1];
      const result = await ai[actionName](id);
      if (result.success === false) return json(res, 409, { error: result.final_response || result.error, policy: result.policy });
      return json(res, 200, { id, action: actionName, summary: result.summary || await getSummary() });
    }
    return json(res, 404, { error: 'API route not found' });
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: 'Internal server error' });
  }
}

module.exports = handler;
