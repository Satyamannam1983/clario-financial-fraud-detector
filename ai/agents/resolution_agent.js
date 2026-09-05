const { StateGraph, START, END } = require('../langgraph');
const { createState } = require('../state');
const { getRuntime } = require('../runtime');
const finance = require('../tools/finance_tools');
const actions = require('../tools/action_tools');
const { evaluatePolicy } = require('../policy');
const investigationAgent = require('./investigation_agent');

async function step(state, title, detail, kind = 'done') {
  state.steps.push({ title, detail, kind });
  await actions.create_ai_activity({
    title: `Resolution Agent · ${title}`,
    detail,
    kind,
    agent: 'resolution',
    action: state.requested_action,
    transaction_id: state.exception_id
  });
}

async function load_investigation(state) {
  const record = await finance.lookup_transaction(state.exception_id);
  if (!record) {
    return { success: false, error: `Exception ${state.exception_id} was not found`, final_response: `I could not find ${state.exception_id}.` };
  }
  let investigation = await getRuntime().getInvestigation(state.exception_id);
  if (!investigation) {
    const result = await investigationAgent.run(state.exception_id, `Investigate ${state.exception_id} before ${state.requested_action}`);
    investigation = result.investigation || null;
  }
  await step(state, 'load_investigation', investigation ? 'investigation loaded' : 'investigation missing', investigation ? 'done' : 'warning');
  return { exception: { ...record, resolution: getRuntime().getAction(state.exception_id) }, investigation, payment: record.payment, order: record.order, settlement: record.settlement };
}

async function check_policy(state) {
  if (!state.exception) return {};
  const policy = evaluatePolicy({
    exception: state.exception,
    investigation: state.investigation,
    requestedAction: state.requested_action
  });
  await step(state, 'policy checked', policy.reasons.join('; '), policy.allowed ? 'done' : 'warning');
  return { policy, confidence: policy.confidence };
}

async function execute_action(state) {
  if (!state.exception) return {};
  if (state.policy?.decision === 'duplicate') {
    return { success: false, error: state.policy.reasons[0], final_response: state.policy.reasons[0] };
  }
  if (!state.policy?.allowed) {
    return {
      success: false,
      error: 'policy_denied',
      final_response: `Policy blocked ${state.requested_action} for ${state.exception_id}. ${state.policy.reasons.join('. ')}. Suggested action: ${state.policy.policy_action}.`
    };
  }
  await actions.execute_action(state.exception_id, state.requested_action, {
    exception: state.exception,
    investigation: state.investigation
  });
  await step(state, 'action executed', state.requested_action);
  return { executed_action: state.requested_action, success: true };
}

async function persist(state) {
  if (!state.executed_action) return { agent: 'resolution', action: state.requested_action };
  await actions.create_audit_log({
    title: `exception_${state.executed_action === 'approve' ? 'approved' : state.executed_action === 'resolve' ? 'resolved' : state.executed_action === 'hold' ? 'on_hold' : 'escalated'}`,
    detail: `${state.exception_id} · ${state.exception.pattern}`,
    kind: state.executed_action === 'escalate' ? 'warning' : 'done',
    agent: 'resolution',
    action: state.executed_action,
    transaction_id: state.exception_id,
    confidence: state.confidence,
    reason: state.policy?.reasons?.join('; ')
  });
  await step(state, 'audit created', `exception_${state.executed_action}`);
  const summary = await getRuntime().getSummary();
  const verb = state.executed_action === 'hold' ? 'placed on hold' : state.executed_action === 'approve' ? 'approved' : `${state.executed_action}d`;
  return {
    summary,
    agent: 'resolution',
    action: state.requested_action,
    final_response: `${state.exception_id} ${verb}. Policy reasons: ${state.policy.reasons.join('; ')}.`
  };
}

const graph = new StateGraph()
  .addNode('load_investigation', load_investigation)
  .addNode('check_policy', check_policy)
  .addNode('execute_action', execute_action)
  .addNode('persist', persist)
  .addEdge(START, 'load_investigation')
  .addConditionalEdges('load_investigation', state => state.exception ? 'continue' : 'stop', { continue: 'check_policy', stop: END })
  .addEdge('check_policy', 'execute_action')
  .addEdge('execute_action', 'persist')
  .addEdge('persist', END)
  .compile();

async function run(exception_id, requested_action, user_request = '') {
  return graph.invoke(createState({
    user_request,
    exception_id,
    requested_action,
    agent: 'resolution',
    action: requested_action
  }));
}

module.exports = { run };
