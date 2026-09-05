const { StateGraph, START, END } = require('../langgraph');
const { createState } = require('../state');
const { completeJson } = require('../mistral');
const finance = require('../tools/finance_tools');
const investigationTools = require('../tools/investigation_tools');
const actions = require('../tools/action_tools');
const { recommendFromPolicy, numericConfidence } = require('../policy');

async function step(state, tool, detail, kind = 'done') {
  state.steps.push({ tool, detail, kind });
  await actions.create_ai_activity({
    title: `Investigation Agent · ${tool}`,
    detail,
    kind,
    agent: 'investigation',
    action: 'investigate_exception',
    transaction_id: state.exception_id
  });
}

async function load_exception(state) {
  const record = await finance.lookup_transaction(state.exception_id);
  if (!record) {
    await step(state, 'lookup_transaction', `${state.exception_id} not found`, 'warning');
    return { success: false, error: `Transaction ${state.exception_id} was not found`, final_response: `I could not find ${state.exception_id} in the current ledger.` };
  }
  await step(state, 'lookup_transaction', `${record.id} · ${record.pattern}`);
  return {
    exception: record,
    payment: record.payment,
    order: record.order,
    settlement: record.settlement
  };
}

async function collect_evidence(state) {
  if (!state.exception) return {};
  const evidence = await investigationTools.collect_evidence(state.exception_id);
  await step(state, 'collect_evidence', `${evidence.length} evidence fields`);
  return { evidence };
}

async function analyze_exception(state) {
  if (!state.exception) return {};
  const related = await investigationTools.find_related_transactions(state.exception_id);
  await step(state, 'find_related_transactions', `${related.length} related records`);
  const history = await investigationTools.get_exception_history(state.exception_id);
  await step(state, 'get_exception_history', history.action ? `prior action ${history.action}` : 'no prior action');
  return { related_transactions: related, history };
}

async function detect_pattern(state) {
  if (!state.exception) return {};
  const pattern = await investigationTools.detect_related_patterns(state.exception_id);
  await step(state, 'detect_patterns', pattern ? `${pattern.exception_count} similar exceptions` : 'no pattern');
  return { pattern };
}

async function calculate_confidence(state) {
  if (!state.exception) return {};
  const scored = finance.calculate_match_score(state.payment, state.order, state.settlement, {
    duplicate: state.exception.pattern === 'duplicate'
  });
  const confidence = numericConfidence(scored.confidence);
  await step(state, 'confidence calculated', scored.confidence);
  return { confidence, match_score: scored };
}

async function recommend_action(state) {
  if (!state.exception) return {};
  const fallbackAssessment = state.exception.pattern === 'missing_settlement'
    ? `Payment ${state.payment.payment_id} was captured and order ${state.order.order_id} was fulfilled, but no settlement record exists in the current data.`
    : state.exception.difference
      ? `Settlement differs from the captured payment by ₹${Math.abs(state.exception.difference).toLocaleString('en-IN')}.`
      : `This record is ${state.exception.status.toLowerCase()} under pattern ${state.exception.pattern.replace('_', ' ')}.`;
  const analysis = await completeJson(
    'You are a finance investigation agent. Use only provided evidence. Return JSON with assessment and recommended_action (resolve|escalate|review). Never invent evidence or amounts.',
    {
      id: state.exception.id,
      pattern: state.exception.pattern,
      payment: state.payment,
      order: state.order,
      settlement: state.settlement,
      evidence: state.evidence,
      pattern_context: state.pattern,
      confidence: state.confidence
    },
    { assessment: fallbackAssessment, recommended_action: 'review' }
  );
  await step(state, analysis.source === 'mistral' ? 'Mistral analysis' : 'deterministic analysis', 'Assessment generated');
  const investigation = {
    exception_type: state.exception.pattern,
    assessment: analysis.assessment,
    confidence: state.confidence,
    evidence: state.evidence,
    pattern: state.pattern?.pattern || state.exception.pattern,
    recommended_action: analysis.recommended_action
  };
  investigation.recommended_action = recommendFromPolicy(state.exception, investigation);
  await step(state, 'recommendation generated', investigation.recommended_action, 'active');
  return { assessment: investigation.assessment, recommended_action: investigation.recommended_action, investigation };
}

async function save_investigation(state) {
  if (!state.investigation) return {};
  await actions.save_investigation(state.exception_id, state.investigation);
  await actions.create_audit_log({
    title: 'investigation_completed',
    detail: `${state.exception_id} · ${state.recommended_action}`,
    kind: 'active',
    agent: 'investigation',
    action: 'investigation_completed',
    transaction_id: state.exception_id,
    confidence: state.confidence
  });
  const evidenceLines = (state.evidence || []).slice(0, 6).map(item => item.label || `${item.field}: ${item.value}`).join('; ');
  return {
    success: true,
    agent: 'investigation',
    action: 'investigate_exception',
    final_response: `${state.assessment} Confidence ${Math.round((state.confidence || 0) * 100)}%. Recommended action: ${state.recommended_action}. Evidence: ${evidenceLines}.`
  };
}

const graph = new StateGraph()
  .addNode('load_exception', load_exception)
  .addNode('collect_evidence', collect_evidence)
  .addNode('analyze_exception', analyze_exception)
  .addNode('detect_pattern', detect_pattern)
  .addNode('calculate_confidence', calculate_confidence)
  .addNode('recommend_action', recommend_action)
  .addNode('save_investigation', save_investigation)
  .addEdge(START, 'load_exception')
  .addConditionalEdges('load_exception', state => state.exception ? 'continue' : 'stop', { continue: 'collect_evidence', stop: END })
  .addEdge('collect_evidence', 'analyze_exception')
  .addEdge('analyze_exception', 'detect_pattern')
  .addEdge('detect_pattern', 'calculate_confidence')
  .addEdge('calculate_confidence', 'recommend_action')
  .addEdge('recommend_action', 'save_investigation')
  .addEdge('save_investigation', END)
  .compile();

async function run(exception_id, user_request = '') {
  await actions.create_ai_activity({
    title: 'AI Controller · Investigation requested',
    detail: exception_id,
    kind: 'active',
    agent: 'controller',
    action: 'investigate_exception',
    transaction_id: exception_id
  });
  await actions.create_audit_log({
    title: 'investigation_started',
    detail: exception_id,
    kind: 'active',
    agent: 'investigation',
    action: 'investigation_started',
    transaction_id: exception_id
  });
  return graph.invoke(createState({ user_request, exception_id, agent: 'investigation' }));
}

module.exports = { run };
