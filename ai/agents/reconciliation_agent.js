const { StateGraph, START, END } = require('../langgraph');
const { createState } = require('../state');
const { completeJson } = require('../mistral');
const { getRuntime } = require('../runtime');
const finance = require('../tools/finance_tools');
const actions = require('../tools/action_tools');

function track(state, title, detail, kind = 'done') {
  state.steps.push({ title, detail, kind });
  return actions.create_ai_activity({
    title: `Reconciliation Agent · ${title}`,
    detail,
    kind,
    agent: 'reconciliation',
    action: 'run_reconciliation'
  });
}

async function load_records(state) {
  const records = await finance.get_transactions();
  await track(state, 'get_transactions', `${records.length} records loaded`);
  return { records };
}

async function normalize(state) {
  const records = await finance.normalize_records(state.records);
  await track(state, 'normalize_records', 'Payment, order, and settlement fields standardized');
  return { records };
}

async function match_and_score(state) {
  const matched = state.records.map(record => finance.rematchRecord(record, state.records));
  await track(state, 'calculate_match_score', 'Deterministic match scores calculated');
  return { records: matched };
}

async function detect_exceptions(state) {
  const exceptions = state.records.map(finance.create_exception).filter(Boolean);
  await track(state, 'create_exception', `${exceptions.length} exceptions detected`, exceptions.length ? 'warning' : 'done');
  return { exceptions };
}

async function persist_run(state) {
  const summary = finance.calculate_reconciliation_metrics(state.records);
  await getRuntime().saveRecords(state.records);
  const runId = `RUN-${new Date().toISOString().slice(0, 10)}-${String(Date.now()).slice(-3)}`;
  const run = {
    runId,
    status: 'completed',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    summary: { ...summary, resolved: 0, escalated: 0, open: summary.exceptions },
    stages: ['IMPORT', 'NORMALIZE', 'MATCH', 'INVESTIGATE', 'RESOLVE']
  };
  await actions.save_reconciliation_run(run);
  await actions.create_audit_log({
    title: 'reconciliation_completed',
    detail: `${summary.total} records · ${summary.matched} matches`,
    agent: 'reconciliation',
    action: 'reconciliation_completed'
  });
  await track(state, 'save_reconciliation_run', run.runId);
  const explanation = await completeJson(
    'You explain finance reconciliation results. Return JSON {assessment}. Do not invent numbers; use the provided summary only.',
    { summary, exceptions: (state.exceptions || []).slice(0, 8).map(item => ({ id: item.id, pattern: item.pattern, difference: item.difference })) },
    { assessment: `Reconciliation completed: ${summary.matched}/${summary.total} matched, ${summary.exceptions} exceptions.` }
  );
  return {
    run,
    summary,
    assessment: explanation.assessment,
    final_response: explanation.assessment,
    agent: 'reconciliation',
    action: 'run_reconciliation',
    success: true
  };
}

const graph = new StateGraph()
  .addNode('load_records', load_records)
  .addNode('normalize', normalize)
  .addNode('match_and_score', match_and_score)
  .addNode('detect_exceptions', detect_exceptions)
  .addNode('persist_run', persist_run)
  .addEdge(START, 'load_records')
  .addEdge('load_records', 'normalize')
  .addEdge('normalize', 'match_and_score')
  .addEdge('match_and_score', 'detect_exceptions')
  .addEdge('detect_exceptions', 'persist_run')
  .addEdge('persist_run', END)
  .compile();

async function run(user_request = 'Run reconciliation') {
  await actions.create_audit_log({
    title: 'reconciliation_started',
    detail: user_request,
    kind: 'active',
    agent: 'reconciliation',
    action: 'reconciliation_started'
  });
  return graph.invoke(createState({ user_request, agent: 'reconciliation' }));
}

module.exports = { run };
