const { StateGraph, START, END } = require('../langgraph');
const { createState } = require('../state');
const { completeJson } = require('../mistral');
const patternTools = require('../tools/pattern_tools');
const actions = require('../tools/action_tools');
const finance = require('../tools/finance_tools');

async function load_history(state) {
  const exceptions = await patternTools.get_historical_exceptions();
  await actions.create_ai_activity({
    title: 'Pattern Agent · get_historical_exceptions',
    detail: `${exceptions.length} historical exceptions`,
    agent: 'pattern',
    action: 'detect_patterns'
  });
  return { exceptions };
}

async function group_and_score(state) {
  const patterns = await patternTools.detect_patterns();
  await actions.create_ai_activity({
    title: 'Pattern Agent · group_exception_patterns',
    detail: `${patterns.length} recurring groups`,
    agent: 'pattern',
    action: 'detect_patterns'
  });
  for (const pattern of patterns) await patternTools.save_pattern(pattern);
  await actions.create_ai_activity({
    title: 'Pattern Agent · save_pattern',
    detail: `${patterns.length} patterns persisted`,
    agent: 'pattern',
    action: 'detect_patterns'
  });
  return { patterns, pattern: patterns[0] || null };
}

async function explain(state) {
  const fallback = state.pattern
    ? `Recurring Pattern Detected\n\nPattern:\n${state.pattern.label}\n\nOccurrences:\n${state.pattern.occurrences}\n\nTransactions:\n${state.pattern.transactions.slice(0, 8).join('\n')}\n\nConfidence:\n${Math.round(state.pattern.confidence * 100)}%\n\nAssessment:\nThe same ${state.pattern.pattern.replace('_', ' ')} appears across multiple transactions.`
    : 'No recurring exception pattern with two or more occurrences was found in the current ledger.';
  const analysis = await completeJson(
    'Explain recurring finance exception patterns. Return JSON {assessment}. Use only provided pattern stats. Do not invent transactions.',
    { patterns: state.patterns },
    { assessment: fallback }
  );
  if (state.pattern) {
    await actions.create_audit_log({
      title: 'pattern_detected',
      detail: `${state.pattern.label} · ${state.pattern.occurrences} occurrences`,
      kind: 'active',
      agent: 'pattern',
      action: 'pattern_detected',
      confidence: state.pattern.confidence
    });
  }
  await actions.create_ai_activity({
    title: 'Pattern Agent · Mistral analysis',
    detail: state.pattern ? state.pattern.label : 'no recurring pattern',
    agent: 'pattern',
    action: 'detect_patterns'
  });
  return {
    assessment: analysis.assessment,
    confidence: state.pattern?.confidence || 0,
    success: true,
    agent: 'pattern',
    action: 'detect_patterns',
    final_response: analysis.assessment
  };
}

const graph = new StateGraph()
  .addNode('load_history', load_history)
  .addNode('group_and_score', group_and_score)
  .addNode('explain', explain)
  .addEdge(START, 'load_history')
  .addEdge('load_history', 'group_and_score')
  .addEdge('group_and_score', 'explain')
  .addEdge('explain', END)
  .compile();

async function run(user_request = 'Find recurring issues') {
  return graph.invoke(createState({ user_request, agent: 'pattern' }));
}

async function list_unresolved() {
  const records = await finance.get_transactions();
  const { getAction } = require('../runtime').getRuntime();
  const open = records.filter(record => record.status !== 'Matched' && getAction(record.id) !== 'resolve' && getAction(record.id) !== 'approve');
  const lines = open.slice(0, 12).map(record => `${record.id} · ${record.pattern} · ${finance.money(record.payment.amount)} · ${record.confidence}`);
  return createState({
    success: true,
    agent: 'query',
    action: 'list_unresolved',
    final_response: open.length ? `Unresolved exceptions (${open.length}):\n${lines.join('\n')}` : 'There are no unresolved exceptions in the current ledger.'
  });
}

module.exports = { run, list_unresolved };
