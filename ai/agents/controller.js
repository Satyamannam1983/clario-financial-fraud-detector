const { completeJson } = require('../mistral');
const reconciliationAgent = require('./reconciliation_agent');
const investigationAgent = require('./investigation_agent');
const patternAgent = require('./pattern_agent');
const resolutionAgent = require('./resolution_agent');
const actions = require('../tools/action_tools');

const ID_RE = /RZP-\d+/i;

function fallbackRoute(message) {
  const text = String(message || '').toLowerCase();
  const exception_id = (message.match(ID_RE) || [null])[0]?.toUpperCase() || null;
  if (/report|match rate|performance|metrics|runs completed|resolution mix|exception type|financial impact|aging|recurring pattern|compare/.test(text)) return { agent: 'query', action: 'page_query', page: 'reports', exception_id };
  if (/audit/.test(text)) return { agent: 'query', action: 'page_query', page: 'audit', exception_id };
  if (/activity|agent log|recent log|recent events|what (has|did) clario/.test(text)) return { agent: 'query', action: 'page_query', page: 'activity', exception_id };
  if (/status|summary|health|overview|dashboard|how are we doing|how are things/.test(text)) return { agent: 'query', action: 'page_query', page: 'overview', exception_id };
  if (/unresolved|open exceptions|show exceptions/.test(text)) return { agent: 'query', action: 'list_unresolved', exception_id };
  if (/recurring|pattern|increasing|repeated/.test(text)) return { agent: 'pattern', action: 'detect_patterns', exception_id };
  if (/investigate|why is|failing|what happened/.test(text)) return { agent: 'investigation', action: 'investigate_exception', exception_id };
  if (/escalate/.test(text)) return { agent: 'resolution', action: 'escalate_exception', requested_action: 'escalate', exception_id };
  if (/approve/.test(text)) return { agent: 'resolution', action: 'approve_exception', requested_action: 'approve', exception_id };
  if (/hold|block|freeze|stop payment|suspicious/.test(text)) return { agent: 'resolution', action: 'hold_exception', requested_action: 'hold', exception_id };
  if (/resolve/.test(text)) return { agent: 'resolution', action: 'resolve_exception', requested_action: 'resolve', exception_id };
  if (/reconcil|run the latest|today's transactions/.test(text)) return { agent: 'reconciliation', action: 'run_reconciliation', exception_id };
  return { agent: 'query', action: 'list_unresolved', exception_id };
}

const inr = value => `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;

async function investigationChatResponse(id, message) {
  const { getRecord, getInvestigation, getAction, getRecords, getSummary } = require('../runtime').getRuntime();
  const risk = require('../risk');
  const record = await getRecord(id);
  if (!record) return `I could not find ${id} in the ledger. Try a different exception id.`;
  const all = await getRecords();
  const investigation = await getInvestigation(id);
  const action = getAction(id);
  const text = String(message || '').toLowerCase();
  const riskResult = risk.riskScore(record, all);
  const similar = all.filter(r => r.status !== 'Matched' && r.pattern === record.pattern && r.id !== id).slice(0, 5);
  const pay = record.payment || {};
  const set = record.settlement;
  const diff = record.difference;
  const pattern = (record.pattern || 'unknown').replace(/_/g, ' ');
  const signalLines = riskResult.signals.map(s => `${s.kind === 'critical' ? '!' : s.kind === 'risk' ? '+' : '·'} ${s.label}: +${s.points} (${s.detail})`).join('\n');
  if (/score\s*\d+|\bbreakdown\b|calculate|do the math|add up|why.*(exactly|score)/.test(text)) {
    return risk.scoreBreakdownText(riskResult, id);
  }
  if (/fraud|risk score|why.*(high|risky)|signals/.test(text)) {
    return `Risk score for ${id}: ${riskResult.score}/100 — ${riskResult.tier} risk.\nContributing signals:\n${signalLines || 'No material risk signals'}\n\nRecommended action from the engine: ${riskResult.recommendation}.`;
  }
  if (/what happens if|approve|consequence|release/.test(text)) {
    if (action === 'hold') return `Approving ${id} would move it from on-hold → approved and release the block.${set ? ` The settlement exists at ${inr(set.settlement_amount)}${diff ? ` but a ${inr(Math.abs(diff))} variance stays unresolved` : ''}.` : ` No settlement exists, so approving would leave ${inr(pay.amount)} captured but un-reconciled.`} The decision is recorded in the audit trail with your identity.`;
    if (action) return `${id} already has action "${action}" — approving again is blocked by policy.`;
    return `Approving ${id} would close it as resolved.${diff ? ` The ${inr(Math.abs(diff))} variance would be permanently excepted rather than recovered` : ' All amounts match'}. With a ${riskResult.score}/100 risk score, the safer move is to place it on hold or escalate for finance review.`;
  }
  if (/auto.?resolv|approve.*these|bulk/.test(text)) {
    const threshold = 90;
    const medium = all.filter(r => r.status !== 'Matched' && r.id !== id && risk.riskScore(r, all).tier === 'Medium');
    const eligible = medium.filter(r => parseFloat(r.confidence) >= threshold);
    const high = all.filter(r => r.status !== 'Matched' && risk.riskScore(r, all).tier === 'High');
    return `${eligible.length} of ${medium.length} medium-risk exceptions meet the ${threshold}% confidence threshold and could be auto-approved. The remaining ${medium.length - eligible.length} require human review, and ${high.length} high-risk cases need hold-or-escalate decisions.`;
  }
  if (/evidence|proof|support|why.*flag/.test(text)) {
    const reasons = (record.reasons || []).map(r => `✓ ${r}`).join('\n');
    const invEvidence = (investigation?.evidence || []).slice(0, 6).map(item => {
      const label = item.label || (item.field ? item.field.replace(/\./g, ' → ') : 'evidence');
      return `✓ ${label}`;
    }).join('\n');
    return `Evidence for ${id}:\n${reasons || 'No matching evidence recorded'}${!set ? '\n✗ Settlement record missing' : `\n✓ Settlement ${set.settlement_id} · ${inr(set.settlement_amount)}`}\n${invEvidence ? `\nAI investigation evidence:\n${invEvidence}` : ''}\n\nRisk signals:\n${signalLines || 'None'}`;
  }
  if (/critical|how bad|urgent|big deal/.test(text)) {
    return `${id} is marked ${record.severity || 'unknown'} severity.\n- Pattern: ${pattern}\n- Amount: ${inr(pay.amount)}${diff ? ` · variance ${inr(diff)}` : ''}\n- Status: ${record.status}${diff > 2000 ? '\n\nThe variance exceeds ₹2,000, which is why it scored ' + record.score + ' and needs attention before settlement risk grows.' : ''}`;
  }
  if (/happened before|similar|recurring|other cases|repeat/.test(text)) {
    if (!similar.length) return `No other open exceptions share the "${pattern}" pattern right now.`;
    const lines = similar.map(r => `- ${r.id} · ${inr(r.payment?.amount)} · ${r.status}${r.difference ? ` · var ${inr(r.difference)}` : ''}`);
    return `Yes — ${similar.length} similar ${pattern} exception${similar.length > 1 ? 's are' : ' is'} open:\n${lines.join('\n')}`;
  }
  if (/recommend|should (we|i) (do|take)|what.*next|suggest|action|wait/.test(text)) {
    if (action) return `${id} already has an action: "${action}". It's excluded from further automatic processing until finance reviews it.`;
    if (investigation?.recommendation) return `Recommendation for ${id}: ${investigation.recommendation}${investigation.confidence ? ` (AI confidence ${investigation.confidence})` : ''}\nYou can ask me to resolve, escalate, or place it on hold.`;
    return `I'd investigate ${id} first to gather evidence, then decide: resolve if policy allows, escalate if it needs finance, or place it on hold when the risk signals warrant it.`;
  }
  if (/settlement/.test(text)) {
    if (!set) return `${id} has NO settlement record — the payment was captured (${inr(pay.amount)}) but nothing settled. That's why it's flagged as ${record.pattern === 'missing_settlement' ? 'missing settlement' : 'unsettled'}.`;
    return `${id} settlement:\n- Settlement ${set.settlement_id} · ${inr(set.settlement_amount)}\n- Status: ${set.settlement_status}\n- Date: ${set.settlement_date}${diff ? `\n- Variance vs payment: ${inr(diff)}` : ''}`;
  }
  if (/amount|payment|how much|value/.test(text)) {
    return `Payment for ${id}: ${inr(pay.amount)} (${pay.payment_status || 'Captured'}) via ${pay.method || 'N/A'}\nOrder: ${record.order?.order_id || 'N/A'} · ${inr(record.order?.order_amount || pay.amount)}${diff ? `\nDifference: ${inr(diff)}` : '\nVariance: none (amount matched)'}`;
  }
  if (/hold|block|freeze/.test(text)) {
    if (action === 'hold') return `${id} is already on hold — no auto-resolution or escalation will act on it.`;
    return `I can place ${id} on hold. That blocks automatic resolution/escalation until a finance user releases it, and every change is written to the audit trail. Say "hold ${id}" or use the button.`;
  }
  const evidence = (investigation?.evidence || []).slice(0, 4).map(item => {
    const label = item.label || (item.field ? item.field.replace(/\./g, ' → ') : 'evidence');
    return `- ${label}`;
  }).join('\n');
  const summary = await getSummary();
  return `${id} · ${pattern} · ${record.severity || 'Unknown'} severity\n- Status: ${record.status} ${action ? `· action: ${action}` : ''}\n- Risk: ${riskResult.score}/100 (${riskResult.tier}) · engine recommends ${riskResult.recommendation}\n- Amount: ${inr(pay.amount)}${diff ? ` · variance ${inr(diff)}` : ''}\n- Confidence: ${record.confidence}\n${investigation?.recommendation ? `- AI recommendation: ${investigation.recommendation}` : ''}${evidence ? `\nEvidence so far:\n${evidence}` : 'Ask me about severity, risk signals, similar cases, settlement, amounts, evidence, or what to do next.'}`;
}

async function pageQueryResponse(page, message) {
  const { getRecords, getSummary, activityEvents } = require('../runtime').getRuntime();
  const summary = await getSummary();
  const records = await getRecords();
  const events = activityEvents() || [];
  const matchRate = summary.total ? Number((summary.matched / summary.total * 100).toFixed(1)) : 0;
  const autoRate = summary.exceptions ? Number((summary.resolved / summary.exceptions * 100).toFixed(1)) : 0;
  if (page === 'reports') {
    const runtimeApi = require('../runtime').getRuntime();
    const report = typeof runtimeApi.reportData === 'function' ? await runtimeApi.reportData() : null;
    const question = String(message || '').toLowerCase();
    if (report && /biggest|largest|most financial|costs the most|impact/.test(question)) {
      const topImpact = Object.entries(report.byType || {}).sort((a, b) => b[1].impact - a[1].impact)[0];
      return createState({ success: true, agent: 'query', action: 'report_impact', final_response: topImpact
        ? `The biggest financial impact is ${topImpact[0].replace(/_/g, ' ')}: ${topImpact[1].count} cases affecting ${inr(topImpact[1].impact)}. Start with the highest-value flagged transaction in that group, then review whether the variance is recoverable or needs escalation.`
        : 'No exception type currently has a measurable financial impact.' });
    }
    if (report && /investigate first|what should i investigate|where should i start|priority/.test(question)) {
      const first = (report.risk?.flagged || [])[0];
      return createState({ success: true, agent: 'query', action: 'report_priority', final_response: first
        ? `Investigate ${first.id} first. It is ${first.tier} risk at ${first.score}/100, with ${first.reason.toLowerCase()} and ${inr(first.impact)} at stake. Open its case report to review evidence before choosing hold, resolve, or escalate.`
        : 'There are no flagged transactions requiring investigation right now.' });
    }
    if (report && /summari[sz]e|manager|executive|brief me/.test(question)) {
      const cur = report.comparison?.current || {};
      return createState({ success: true, agent: 'query', action: 'report_summary', final_response: `Manager summary: ${cur.matchRate}% of ${cur.total} records matched, with ${report.metrics?.openExceptions ?? cur.exceptions} open exceptions. The primary control concern is ${report.risk?.rootCause?.pattern || 'the current exception mix'}, and at-risk value is ${inr(report.risk?.stats?.atRiskValue || 0)}. Recommended focus: investigate the highest-risk flagged case and keep policy-blocked cases under human review.` });
    }
    if (report && /match rate|compare|previous run|improve|decline/.test(question)) {
      const prev = report.comparison?.previous, cur = report.comparison?.current;
      if (prev && cur) {
        const delta = (cur.matchRate - prev.matchRate).toFixed(1);
        return createState({ success: true, agent: 'query', action: 'report_comparison', final_response: `Match rate is ${cur.matchRate}% now versus ${prev.matchRate}% previously (${delta >= 0 ? '+' : ''}${delta} points). ${cur.matched - prev.matched} more records matched in the current run, while exceptions moved from ${prev.exceptions} to ${cur.exceptions}.` });
      }
    }
    if (report && /risk|fraud|trend|flagged|at.?risk|high.?risk|why.*(increase|rise|up)/.test(message)) {
      const rz = report.risk || {}; const st = rz.stats || {}; const tr = rz.trend || []; const root = rz.rootCause;
      const trendLine = tr.length ? `\n- Weekly trend: ${tr.map(t => `${t.week}: ${t.high} high/${t.medium} med`).join(', ')}` : '';
      const signal = rz.topSignals?.[0];
      return createState({
        success: true,
        agent: 'query',
        action: 'page_query',
        final_response: `Clario · Risk intelligence\n- High risk: ${st.high} cases · Medium: ${st.medium} · Low: ${st.low}\n- At-risk value: ${inr(st.atRiskValue || 0)}\n- On hold: ${st.holds}${trendLine}\n- Top risk signal: ${signal ? `${signal.label} (${signal.count} cases)` : 'n/a'}${root ? `\n- Root cause: ${root.pct}% of flagged cases are "${root.pattern}" · ${root.advice}` : ''}\n\nThe rise is driven by ${signal ? `${signal.label.toLowerCase()} repeating` : 'the dominant pattern'}${root ? ` — ${root.count} flagged case(s) tied to "${root.pattern}"` : ''}. Open the FLAGGED TRANSACTIONS table to act on each case.`
      });
    }
    if (report?.comparison?.previous && report?.comparison?.current) {
      const prev = report.comparison.previous, cur = report.comparison.current;
      const delta = (cur.matchRate - prev.matchRate).toFixed(1);
      const topImpact = Object.entries(report.byType || {}).sort((a, b) => b[1].impact - a[1].impact)[0];
      const worstAging = Object.entries(report.aging || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t, c]) => `${t}: ${c}`).join(', ');
const riskBlock = report.risk || {};
    const riskStats = riskBlock.stats || {};
    const trend = (riskBlock.trend || []).slice(-1)[0];
    const rootCause = riskBlock.rootCause;
    const riskLine = `\n- Anomaly risk: ${riskStats.high} high · ${riskStats.medium} medium · ${riskStats.low} low risk exceptions${trend ? ` (latest ${trend.high} high, from ${(riskBlock.trend || [])[0]?.high} in the first recorded run)` : ''}${riskStats.atRiskValue ? ` · at-risk value ${inr(riskStats.atRiskValue)}` : ''}${riskStats.holds ? ` · ${riskStats.holds} on hold` : ''}${rootCause ? `\n- Root cause: ${rootCause.pct}% of high/medium risk cases are "${rootCause.pattern}". ${rootCause.advice}` : ''}`;
    return createState({
      success: true,
      agent: 'query',
      action: 'page_query',
      final_response: `Clario · Report analyst\n- Match rate: ${cur.matchRate}% (${cur.matched}/${cur.total}) vs previous ${prev.matchRate}% (${delta >= 0 ? '+' : ''}${delta} points)\n- Open exceptions: ${report.metrics?.openExceptions ?? cur.exceptions}\n- Auto-resolution: ${report.metrics?.autoResolutionRate}%\n- Recovered value: ${inr(report.metrics?.recoveredValue)}\n- Exception aging: ${worstAging}\n${topImpact ? `- Highest impact type: ${topImpact[0].replace(/_/g, ' ')} · ${topImpact[1].count} cases · ${inr(topImpact[1].impact)}` : ''}${riskLine}\n\nAsk me to "run reconciliation" to refresh these numbers.`
    });
    }
    return createState({
      success: true,
      agent: 'query',
      action: 'page_query',
      final_response: `Clario · Reports\n- Match rate: ${matchRate}% (${summary.matched}/${summary.total})\n- Open exceptions: ${summary.open}\n- Auto-resolved: ${summary.resolved} (${autoRate}% of exceptions)\n- Escalated to finance: ${summary.escalated}\n\nAsk me to "run reconciliation" to refresh these numbers.`
    });
  }
  if (page === 'audit') {
    const lines = (events.length ? events : [{ title: 'No events yet', detail: 'Run reconciliation to start the audit trail.' }]).slice(0, 8).map(event => `${event.kind === 'warning' ? '!' : '✓'} ${event.title}${event.detail ? ` · ${event.detail}` : ''}`);
    return createState({ success: true, agent: 'query', action: 'page_query', final_response: `Clario · Audit Trail\n${lines.join('\n')}` });
  }
  if (page === 'activity') {
    const lines = (events.length ? events : [{ title: 'No agent activity yet', detail: 'Run reconciliation to start the controller.' }]).slice(0, 8).map(event => `${event.kind === 'warning' ? '!' : event.kind === 'active' ? '◉' : '✓'} ${event.title}${event.detail ? ` · ${event.detail}` : ''}`);
    return createState({ success: true, agent: 'query', action: 'page_query', final_response: `Clario · AI Activity\n${lines.join('\n')}` });
  }
  const exceptions = records.filter(record => record.status !== 'Matched').length;
  return createState({
    success: true,
    agent: 'query',
    action: 'page_query',
    final_response: `Clario · Overview\n- Reconciliation health: ${matchRate}% match rate (${summary.matched}/${summary.total} records)\n- Open exceptions: ${summary.open}\n- Recovered value: ${summary.resolved} resolved\n- Recent activity: ${events[0] ? events[0].title : 'none yet'}\n\nAsk about reports, audit, activity, transactions or a specific RZP id.`
  });
}

function createState(payload) {
  return payload;
}

async function route(message) {
  const fallback = fallbackRoute(message);
  const routed = await completeJson(
    'You are the Clario AI Controller. Route the user request. Return JSON with agent (reconciliation|investigation|pattern|resolution|query), action, exception_id (or null), requested_action (resolve|escalate|approve or null). Do not perform financial reasoning.',
    { message },
    fallback
  );
  const exception_id = (routed.exception_id || fallback.exception_id || (message.match(ID_RE) || [null])[0] || null);
  return {
    agent: routed.agent || fallback.agent,
    action: routed.action || fallback.action,
    exception_id: exception_id ? String(exception_id).toUpperCase() : null,
    requested_action: routed.requested_action || fallback.requested_action || null,
    page: routed.page || fallback.page || null
  };
}

function needId(intent) {
  return ['investigation', 'resolution'].includes(intent.agent);
}

async function handle(message, options = {}) {
  const text = String(message || '').trim();
  if (!text) {
    return { success: false, agent: 'controller', action: 'invalid_request', response: 'Send a finance request such as "Run reconciliation" or "Investigate RZP-1047".', confidence: null };
  }
  if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(text)) {
    return { success: true, agent: 'controller', action: 'greeting', response: 'Hello — I am Clario, your finance control analyst. I can explain risk, compare reconciliation runs, identify the highest-impact exception, or guide your next investigation.', confidence: null };
  }
  const intent = await route(text);
  const context = options?.context || {};
  if (!intent.exception_id && context.id) intent.exception_id = String(context.id).toUpperCase();
  const inInvestigation = Boolean(context.id);
  const inReports = context.page === 'report' || context.page === 'reports';
  const lowerText = text.toLowerCase();
  const actionCommand = /^\s*(hold|block|freeze|approve|escalate|resolve|release)\b/.test(lowerText) || /run reconciliation|place .* on hold|put .* on hold/.test(lowerText);
  if (inReports && !actionCommand) {
    const result = await pageQueryResponse('reports', text);
    return { success: true, agent: 'query', action: 'page_query', response: result.final_response || result.error || 'Report data unavailable.', confidence: null };
  }
  await actions.create_ai_activity({
    title: 'AI Controller · request routed',
    detail: `${intent.agent} · ${text}${inInvestigation ? ` (context: ${intent.exception_id})` : ''}`,
    kind: 'active',
    agent: 'controller',
    action: intent.action,
    transaction_id: intent.exception_id
  });
  // Conversational questions about a specific transaction → chat response, not full agent run.
  // This fires both when inside the investigation page (inInvestigation) AND when the user
  // asks a question from the global controller that contains an exception ID but is phrased
  // as an explanatory question rather than an action command.
  const QUESTION_RE = /why|what|how|show|explain|risky|risk score|evidence|proof|happened|failing|failed|is it|can it|should|recommend|settlement|amount|payment|pattern|recurring|similar|score|breakdown|consequence|approve.*happen|auto.?resolv/i;
  const GLOBAL_ACTION_RE = /^\s*(hold|block|freeze|approve|escalate|resolve|release)\b|place .* on hold|put .* on hold|run reconciliation|run the latest/i;
  const PAGE_NAV_RE = /audit|activity|agent log|report match|match rate|resolution mix|aging|comparison|financial impact|recurring pattern|exception type|status summary|overview|dashboard|health/i;
  if (intent.exception_id && QUESTION_RE.test(text) && !GLOBAL_ACTION_RE.test(text) && !PAGE_NAV_RE.test(text)) {
    const response = await investigationChatResponse(intent.exception_id, text);
    return { success: true, agent: 'investigation', action: 'investigation_chat', response, confidence: null };
  }
  if (inInvestigation) {
    const lower = text.toLowerCase();
    const realAction = GLOBAL_ACTION_RE.test(lower) || PAGE_NAV_RE.test(lower);
    if (!realAction && intent.exception_id) {
      const response = await investigationChatResponse(intent.exception_id, text);
      return { success: true, agent: 'investigation', action: 'investigation_chat', response, confidence: null };
    }
  }
  if (needId(intent) && !intent.exception_id) {
    return { success: false, agent: intent.agent, action: intent.action, response: 'Specify a transaction id such as RZP-1047.', confidence: null };
  }
  let result;
  try {
    if (intent.agent === 'reconciliation') result = await reconciliationAgent.run(text);
    else if (intent.agent === 'investigation') result = await investigationAgent.run(intent.exception_id, text);
    else if (intent.agent === 'pattern') result = await patternAgent.run(text);
    else if (intent.agent === 'resolution') result = await resolutionAgent.run(intent.exception_id, intent.requested_action || 'resolve', text);
    else if (intent.action === 'page_query') result = await pageQueryResponse(intent.page || 'overview', text);
    else result = await patternAgent.list_unresolved();
  } catch (error) {
    return {
      success: false,
      agent: intent.agent,
      action: intent.action,
      response: error.message || 'The agent could not complete that request.',
      confidence: null
    };
  }
  return {
    success: result.success !== false,
    agent: result.agent || intent.agent,
    action: result.action || intent.action,
    response: result.final_response || result.error || 'Request completed.',
    confidence: result.confidence ?? result.investigation?.confidence ?? result.pattern?.confidence ?? null,
    run: result.run || null,
    investigation: result.investigation || null,
    summary: result.summary || null,
    policy: result.policy || null
  };
}

module.exports = { handle, route };
