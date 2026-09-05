const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const db = require('./db');
const ai = require('./ai');
const risk = require('./ai/risk');

function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnv();

const root = __dirname;
const port = Number(process.env.PORT || 3001);
const sessions = new Map();
const users = new Map([['demo@clario.ai', { name: 'Arjun Shah', email: 'demo@clario.ai', role: 'Finance admin' }]]);
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
// Snapshots are written after real reconciliation runs. Do not project values backward.
let riskSnapshots = [];
let riskBlockCache = { signature: null, block: null };
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
  return pattern === 'missing_settlement' ? 'Missing settlement' : pattern === 'duplicate' ? 'Duplicate transaction' : pattern === 'refund_mismatch' ? 'Refund mismatch' : pattern === 'settlement_delay' ? 'Settlement delay' : pattern === 'fee_variance' ? 'Fee variance' : pattern === 'fuzzy' ? 'Reference similarity' : pattern === 'exact' ? 'Matched' : 'Amount mismatch';
}

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'finance-data.js'), 'utf8'), sandbox);
const data = sandbox.window.ledgerPilotData;
let databaseReady = false;

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function auth(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return token && sessions.has(token) ? sessions.get(token) : null;
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
    if (stored && stored.length > 0) {
      data.records = stored;
      return stored;
    }
  }
  return data.records;
}

async function saveRecords(records) {
  data.records = records;
  if (databaseReady) await db.saveRecords(records);
}

async function getRecord(id) {
  const records = await getRecords();
  return records.find(record => record.id === id) || null;
}

function annotateRecords(records, sourceActions = new Map()) {
  return records.map(record => {
    const r = risk.riskScore(record, records);
    const action = sourceActions.get(record.id) || null;
    return {
      ...record,
        risk: r,
      risk_score: r.score,
      risk_tier: r.tier,
      risk_recommendation: r.recommendation,
      risk_reasons: r.risk_reasons,
      risk_breakdown: r.breakdown,
        state: recordState(record, action),
      resolution: action
    };
  });
}

function buildTimeline(id, record, action, investigation) {
  const pay = record.payment || {};
  const riskResult = record.risk || { score: '–', tier: 'Low', recommendations: [], risk_reasons: [] };
  const minutes = [30, 30, 29, 29, 27, 26, 25, 22];
  const time = m => { const d = new Date(Date.now() - m * 60000); return d.toTimeString().slice(0, 5); };
  const steps = [];
  let i = 0;
  steps.push({ time: time(minutes[i++]), title: 'Transaction received', detail: `Payment ${pay.payment_id || '–'} captured · ${risk.inr(pay.amount || 0)}`, kind: 'system' });
  steps.push({ time: time(minutes[i++]), title: 'Reconciliation failed', detail: `${patternLabel(record.pattern)} detected against settlement records`, kind: 'system' });
  steps.push({ time: time(minutes[i++]), title: 'Risk analysis completed', detail: `Score ${riskResult.score}/100 computed from ${(riskResult.risk_reasons || []).length} rule-based signals`, kind: 'risk' });
  steps.push({ time: time(minutes[i++]), title: `Risk score ${riskResult.score} — ${riskResult.tier}`, detail: (riskResult.risk_reasons || [])[0]?.explanation || 'No material risk signals', kind: 'risk' });
  if (investigation) {
    steps.push({ time: time(minutes[i++]), title: 'AI investigation started', detail: `Evidence gathering across payment, order, settlement and fee` , kind: 'ai' });
    steps.push({ time: time(minutes[i++]), title: 'Evidence collected', detail: `${(investigation.evidence || []).length} evidence items indexed`, kind: 'ai' });
    steps.push({ time: time(minutes[i++]), title: 'AI recommendation', detail: `${riskResult.recommendation === 'hold' ? 'Place on hold' : riskResult.recommendation === 'review' ? 'Review required' : 'Continue processing'}${investigation.recommendation ? ` · ${investigation.recommendation}` : ''}`, kind: 'ai' });
  } else {
    steps.push({ time: time(minutes[i++]), title: 'Held for investigation', detail: 'No AI investigation run yet for this case', kind: 'ai' });
  }
  if (action) {
    const verb = action === 'hold' ? 'placed transaction on hold' : action === 'approve' ? 'approved the transaction' : action === 'escalate' ? 'escalated to finance' : 'resolved the transaction';
    const decision = audit.find(e => e.title === 'human_decision' && String(e.detail || '').includes(id));
    const actor = decision ? String(decision.detail).replace(/^.*\bby\s+/, '') : 'Finance user';
    steps.push({ time: time(minutes[i] || 22), title: `Human ${verb}`, detail: `Decision recorded in the audit trail by ${actor}`, kind: 'human' });
  } else {
    steps.push({ time: time(minutes[i] || 22), title: 'Awaiting human decision', detail: riskResult.tier === 'High' ? 'Policy requires human approval before anything can be released' : 'Policy requires a human review before release', kind: 'human' });
  }
  return steps;
}

async function getSummary(sourceActions = actions) {
  const recs = await getRecords();
  const values = sourceActions instanceof Map ? [...sourceActions.values()] : [];
  const resolved = values.filter(action => action === 'resolve' || action === 'approve').length;
  const escalated = values.filter(action => action === 'escalate').length;
  const held = values.filter(action => action === 'hold').length;
  const exceptions = recs.filter(r => r.status === 'Exception' || r.status === 'Needs Review').length;
  return {
    total: recs.length,
    matched: recs.filter(r => r.status === 'Matched').length,
    exceptions,
    resolved,
    escalated,
    held,
    open: exceptions - resolved
  };
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

function recordActivity(title, detail, kind = 'done', runId = null) {
  const event = typeof title === 'object'
    ? { time: new Date().toISOString(), kind: 'done', ...title }
    : { time: new Date().toISOString(), title, detail, kind, runId };
  activity.unshift(event);
  void db.saveActivity(event);
  return event;
}

async function reportData() {
  const current = await getSummary();
  const recs = await getRecords();
  const byPattern = recs.reduce((out, record) => { out[record.pattern] = (out[record.pattern] || 0) + 1; return out; }, {});
  const pipeline = await reconciliationPipeline();
  const exceptions = recs.filter(r => r.status !== 'Matched');
  const agingTier = (record) => {
    if (record.pattern === 'missing_settlement' || record.pattern === 'refund_mismatch') return '7+ days';
    if (record.pattern === 'amount_mismatch' || record.pattern === 'duplicate') return '3-7 days';
    if (record.pattern === 'settlement_delay') return '1-3 days';
    return '< 24 hours';
  };
  const aging = exceptions.reduce((out, record) => { const tier = agingTier(record); out[tier] = (out[tier] || 0) + 1; return out; }, {});
  const severity = exceptions.reduce((out, record) => { const key = record.severity === 'Critical' ? 'Critical' : record.severity === 'High' ? 'High' : 'Medium'; out[key] = (out[key] || 0) + 1; return out; }, {});
  const byType = exceptions.reduce((out, record) => {
    const entry = out[record.pattern] || (out[record.pattern] = { count: 0, impact: 0 });
    entry.count += 1;
    entry.impact += Math.abs(record.difference || record.payment.amount || 0);
    return out;
  }, {});
  const statusBreakdown = { open: 0, resolved: 0, escalated: 0, onHold: 0 };
  for (const record of exceptions) {
    const action = actions.get(record.id);
    if (action === 'hold') statusBreakdown.onHold += 1;
    else if (action === 'escalate') statusBreakdown.escalated += 1;
    else if (action === 'resolve' || action === 'approve') statusBreakdown.resolved += 1;
    else statusBreakdown.open += 1;
  }
  const riskRecords = annotateRecords(recs, actions);
  const riskStats = risk.riskStats(riskRecords, actions);
  const states = { matched: 0, review: 0, failed: 0, on_hold: 0, resolved: 0, escalated: 0, approved: 0 };
  for (const record of riskRecords) states[record.state] = (states[record.state] || 0) + 1;
  const flaggedList = [...riskStats.highFlags, ...riskStats.mediumFlags]
    .sort((a, b) => b.risk.score - a.risk.score)
    .map(r => ({ id: r.id, score: r.risk.score, tier: r.risk.tier, reason: risk.flagReason(r, r.risk), impact: r.payment?.amount || 0, action: r.risk.recommendation === 'hold' ? 'Hold' : r.risk.recommendation === 'review' ? 'Review' : 'Continue', status: r.status, state: r.state }));
  const signature = `${recs.length}|${actions.size}|${riskSnapshots.length}|${current.matched}|${riskStats.high}`;
  if (riskBlockCache.signature !== signature) {
    riskBlockCache = {
      signature,
      block: {
        stats: { high: riskStats.high, medium: riskStats.medium, low: riskStats.low, atRiskValue: riskStats.atRiskValue, holds: riskStats.holds },
        topSignals: risk.topSignals(riskRecords),
        trend: risk.riskTrend(riskSnapshots),
        rootCause: risk.rootCause(riskRecords),
        flagged: flaggedList,
        flaggedTotal: flaggedList.length
      }
    };
  }
  const riskBlock = riskBlockCache.block;
  const previous = [...runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[1];
  const previousRun = previous
    ? { total: previous.recordsTotal ?? previous.records?.length ?? 150, matched: previous.matched ?? 120, exceptions: previous.exceptions ?? 30 }
    : { total: 150, matched: 120, exceptions: 30 };
  const comparison = {
    previous: { ...previousRun, matchRate: Number((previousRun.matched / previousRun.total * 100).toFixed(1)) },
    current: { ...current, matchRate: Number((current.matched / current.total * 100).toFixed(1)) }
  };
  return { metrics: {
    total: current.total, matched: current.matched, exceptions: current.exceptions, openExceptions: current.open,
    matchRate: current.total ? Number((current.matched / current.total * 100).toFixed(1)) : 0,
    autoResolutionRate: current.exceptions ? Number((current.resolved / current.exceptions * 100).toFixed(1)) : 0,
    recoveredValue: recs.filter(r => actions.get(r.id) === 'resolve').reduce((sum, r) => sum + Math.abs(r.difference || 0), 0),
    reconciledValue: recs.filter(r => r.status === 'Matched').reduce((sum, r) => sum + Math.abs(r.payment?.amount || 0), 0),
    atRiskValue: riskStats.atRiskValue
  }, byPattern, byType, aging, severity, statusBreakdown, states, comparison, risk: riskBlock, recurring: pipeline.recurring };
}

function serveStatic(req, res) {
  const requested = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.normalize(path.join(root, requested));
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  res.writeHead(200, { 'Content-Type': `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` });
  fs.createReadStream(file).pipe(res);
}

ai.attach({
  getRecords,
  saveRecords,
  getRecord,
  getAction: (id) => actions.get(id) || null,
  saveAction: async (id, actionName) => {
    actions.set(id, actionName);
    riskBlockCache.signature = null;
    await db.saveAction(id, actionName);
  },
  getInvestigation: async (id) => investigations.get(id) || await db.getInvestigation(id),
  saveInvestigation: async (id, investigation) => {
    investigations.set(id, investigation);
    await db.saveInvestigation(id, investigation);
  },
  saveRun: async (run) => {
    runs.set(run.runId, run);
    await db.saveRun(run);
  },
  savePattern: (pattern) => db.savePattern(pattern),
  recordActivity,
  recordAudit,
  getSummary,
  reportData,
  activityEvents: () => activity
});

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Max-Age': '86400' }); res.end(); return; }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'clario-api', database: databaseReady ? 'connected' : 'demo', mistral: ai.available(), aiMode: ai.available() ? 'mistral' : 'deterministic', message: ai.available() ? 'Mistral is configured.' : 'Mistral API key is not configured; deterministic evidence mode is active.' });
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.email?.trim().toLowerCase() !== 'demo@clario.ai' || body.password !== 'ClarioDemo123!') return json(res, 401, { error: 'Invalid demo credentials' });
      const token = crypto.randomBytes(24).toString('hex');
      const user = { name: 'Arjun Shah', email: 'demo@clario.ai', role: 'Finance admin' };
      sessions.set(token, user);
      recordAudit({ title: 'User signed in', detail: user.email, kind: 'active', actor: user.email });
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
      const token = crypto.randomBytes(24).toString('hex');
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
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
    if (!auth(req)) return json(res, 401, { error: 'Authentication required' });
    if (url.pathname === '/api/me' || url.pathname === '/api/auth/me') return json(res, 200, { user: auth(req) });
    if (url.pathname === '/api/ai/controller' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await ai.handleController(body.message || body.prompt || '', { context: body.context || {} });
      return json(res, 200, { ...result, aiMode: ai.available() ? 'mistral' : 'deterministic' });
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
      let rows = annotateRecords(source, actions)
        .filter(record => (!q || JSON.stringify(record).toLowerCase().includes(q)) && (!status || status === 'All' || record.status === status || (status === 'Missing' && !record.settlement)));
      rows.sort((a, b) => {
        const av = sort === 'amount' ? a.payment.amount : sort === 'status' ? a.status : a.id;
        const bv = sort === 'amount' ? b.payment.amount : sort === 'status' ? b.status : b.id;
        return (av > bv ? 1 : av < bv ? -1 : 0) * order;
      });
      const total = rows.length;
      return json(res, 200, { records: rows.slice((page - 1) * limit, page * limit), page, limit, total, pages: Math.ceil(total / limit) });
    }
    if (url.pathname === '/api/reconciliation/runs' && req.method === 'GET') {
      const stored = databaseReady ? await db.runs() : null;
      return json(res, 200, { runs: stored || [...runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)) });
    }
    const runStatus = url.pathname.match(/^\/api\/reconciliation\/runs\/([^/]+)$/);
    if (runStatus && req.method === 'GET') {
      const run = runs.get(runStatus[1]) || (databaseReady ? await db.getRun(runStatus[1]) : null);
      return run ? json(res, 200, run) : json(res, 404, { error: 'Run not found' });
    }
    if ((url.pathname === '/api/ai/activity' || url.pathname === '/api/activity') && req.method === 'GET') {
      const stored = databaseReady ? await db.activity(Number(url.searchParams.get('limit') || 100)) : null;
      return json(res, 200, { events: stored || activity });
    }
    if (url.pathname === '/api/ai/agents' && req.method === 'GET') {
      const agents = [
        { id: 'controller', name: 'AI Controller', role: 'Routes requests to the right agent', online: true },
        { id: 'reconciliation', name: 'Reconciliation Agent', role: 'Runs import · normalize · match', online: true },
        { id: 'investigation', name: 'Investigation Agent', role: 'Evidence-based exception analysis', online: true },
        { id: 'pattern', name: 'Pattern Agent', role: 'Recurring risk detection', online: true },
        { id: 'resolution', name: 'Resolution Agent', role: 'Policy-checked actions & audit', online: true }
      ];
      for (const agent of agents) {
        const own = activity.filter(event => event.agent === agent.id);
        agent.executions = own.length;
        agent.lastAt = own[0]?.time || null;
      }
      return json(res, 200, { agents, totalExecutions: activity.length });
    }
    if (url.pathname === '/api/settings' && req.method === 'GET') {
      return json(res, 200, settingsStore);
    }
    if (url.pathname === '/api/settings' && req.method === 'PUT') {
      const body = await readBody(req);
      for (const group of ['rules', 'ai', 'notifications']) {
        if (!body[group] || typeof body[group] !== 'object') continue;
        for (const [key, value] of Object.entries(body[group])) {
          if (!(key in settingsStore[group])) continue;
          if (typeof settingsStore[group][key] === 'number') settingsStore[group][key] = Number(value) || settingsStore[group][key];
          else if (typeof settingsStore[group][key] === 'boolean') settingsStore[group][key] = Boolean(value);
        }
      }
      recordAudit('Settings updated', 'Reconciliation rules, AI policies or notifications changed', 'done');
      return json(res, 200, settingsStore);
    }
    if ((url.pathname === '/api/reconciliation/recurring' || url.pathname === '/api/patterns/recurring') && req.method === 'GET') {
      const pipeline = await reconciliationPipeline();
      return json(res, 200, { patterns: pipeline.recurring });
    }
    if (url.pathname === '/api/reconciliation' && req.method === 'GET') {
      const sourceRecords = await getRecords();
      const storedActions = databaseReady ? await db.actionMap() : null;
      const sourceActions = storedActions || actions;
      const query = (url.searchParams.get('q') || '').toLowerCase();
      const status = url.searchParams.get('status');
      const records = annotateRecords(sourceRecords, sourceActions).filter(record => (!query || JSON.stringify(record).toLowerCase().includes(query)) && (!status || status === 'All' || record.status === status || (status === 'Missing' && !record.settlement)));
      return json(res, 200, { records, summary: await getSummary(sourceActions) });
    }
    if (url.pathname === '/api/dashboard/live-records' && req.method === 'GET') {
      const recs = await getRecords();
      const records = annotateRecords(recs, actions)
        .filter(record => record.state !== 'resolved')
        .sort((a, b) => (b.severity === 'Critical') - (a.severity === 'Critical') || b.payment.amount - a.payment.amount)
        .slice(0, 12);
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
    if (url.pathname === '/api/audit' && req.method === 'GET') {
      const stored = databaseReady ? await db.auditEvents() : null;
      return json(res, 200, { events: stored && stored.length ? stored : audit });
    }
    if (url.pathname === '/api/reports' && req.method === 'GET') {
      const report = await reportData();
      return json(res, 200, { ...report, metrics: { ...report.metrics, matchRate: `${report.metrics.matchRate}%`, autoResolutionRate: `${report.metrics.autoResolutionRate}%`, recoveredValue: `₹${report.metrics.recoveredValue.toLocaleString('en-IN')}` } });
    }
    if (url.pathname === '/api/reports/data' && req.method === 'GET') return json(res, 200, await reportData());
    if ((url.pathname === '/api/reports.csv' || url.pathname === '/api/reports/csv') && req.method === 'GET') {
      const report = await reportData();
      const lines = [['metric', 'value'], ...Object.entries(report.metrics), ['recurring_patterns', report.recurring.length]].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','));
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="reconciliation-report.csv"', 'Access-Control-Allow-Origin': '*' });
      return res.end(lines.join('\n'));
    }
    const timelineMatch = url.pathname.match(/^\/api\/exceptions\/([^/]+)\/timeline$/);
    if (timelineMatch && req.method === 'GET') {
      const id = timelineMatch[1];
      const record = await getRecord(id);
      if (!record) return json(res, 404, { error: 'Exception not found' });
      const all = annotateRecords(await getRecords(), actions);
      const annotated = all.find(r => r.id === id) || record;
      return json(res, 200, { id, timeline: buildTimeline(id, annotated, actions.get(id), investigations.get(id) || await db.getInvestigation(id)) });
    }
    const investigationMatch = url.pathname.match(/^\/api\/exceptions\/([^/]+)\/investigate$/);
    if (investigationMatch && req.method === 'POST') {
      const id = investigationMatch[1];
      const result = await ai.investigate(id, `Investigate ${id}`);
      if (!result.investigation) return json(res, result.error?.includes('not found') ? 404 : 400, { error: result.error || result.final_response });
      return json(res, 200, { id, investigation: result.investigation });
    }
    const investigationRead = url.pathname.match(/^\/api\/exceptions\/([^/]+)\/investigation$/);
    if (investigationRead && req.method === 'GET') {
      const investigation = investigations.get(investigationRead[1]) || await db.getInvestigation(investigationRead[1]);
      if (!investigation) return json(res, 404, { error: 'Investigation not found' });
      return json(res, 200, { id: investigationRead[1], investigation });
    }
    const actionMatch = url.pathname.match(/^\/api\/exceptions\/([^/]+)\/(resolve|escalate|approve|hold)$/);
    if (actionMatch && req.method === 'POST') {
      const [, id, actionName] = actionMatch;
      const result = await ai[actionName](id);
      if (result.success === false) {
        const status = result.error === 'policy_denied' ? 409 : /not found/i.test(result.final_response || result.error || '') ? 404 : 409;
        return json(res, status, { error: result.final_response || result.error, policy: result.policy });
      }
      const actor = auth(req)?.name || 'Finance user';
      recordActivity('Human decision applied', `${actor} · ${actionName} → ${id}`, 'active');
      recordAudit({ title: `human_decision`, detail: `${id} · ${actionName} by ${actor}`, kind: 'active', actor });
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
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'API route not found' });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Internal server error' });
  }
});

async function start() {
  try {
    databaseReady = Boolean(await db.connectDatabase(data));
    const storedAudit = databaseReady ? await db.auditEvents() : null;
    if (storedAudit) audit.push(...storedAudit);
    const storedActions = databaseReady ? await db.actionMap() : null;
    if (storedActions) storedActions.forEach((action, id) => actions.set(id, action));
    console.log(`${databaseReady ? 'MongoDB-backed' : 'Demo'} Clario API listening on http://localhost:${port}`);
  } catch (error) {
    console.warn('MongoDB connection failed; using process-local demo state:', error.message);
    databaseReady = false;
  }
  if (databaseReady) {
    const storedRuns = await db.runs();
    if (storedRuns) storedRuns.forEach(run => runs.set(run.runId, run));
    const storedActivity = await db.activity();
    if (storedActivity) activity.push(...storedActivity);
    const storedRiskSnapshots = await db.riskSnapshots();
    if (storedRiskSnapshots) riskSnapshots = storedRiskSnapshots;
  }
  server.listen(port);
}

start();
