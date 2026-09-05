const { getRuntime } = require('../runtime');
const { evaluatePolicy } = require('../policy');

async function save_investigation(id, investigation) {
  await getRuntime().saveInvestigation(id, investigation);
  return investigation;
}

async function save_reconciliation_run(run) {
  await getRuntime().saveRun(run);
  return run;
}

async function create_ai_activity({ title, detail, kind = 'done', agent, action, transaction_id, confidence, runId }) {
  return getRuntime().recordActivity({ title, detail, kind, agent, action, transaction_id, confidence, runId });
}

async function create_audit_log({ title, detail, kind = 'done', actor = 'Clario AI', agent, action, transaction_id, confidence, reason }) {
  return getRuntime().recordAudit({
    time: new Date().toISOString(),
    title,
    detail,
    kind,
    actor,
    agent,
    action,
    transaction_id,
    confidence,
    reason
  });
}

async function resolve_exception(id, extras = {}) {
  return execute_action(id, 'resolve', extras);
}

async function escalate_exception(id, extras = {}) {
  return execute_action(id, 'escalate', extras);
}

async function approve_exception(id, extras = {}) {
  return execute_action(id, 'approve', extras);
}

async function execute_action(id, requestedAction, { exception, investigation } = {}) {
  const runtime = getRuntime();
  const record = exception || await runtime.getRecord(id);
  const existing = investigation || await runtime.getInvestigation(id);
  const policy = evaluatePolicy({ exception: record && { ...record, resolution: runtime.getAction(id) }, investigation: existing, requestedAction });
  if (policy.decision === 'duplicate') {
    const error = new Error(policy.reasons[0]);
    error.code = 'duplicate_action';
    throw error;
  }
  if (!policy.allowed) {
    const error = new Error(policy.reasons.join('. '));
    error.code = 'policy_denied';
    error.policy = policy;
    throw error;
  }
  await runtime.saveAction(id, requestedAction);
  return { id, action: requestedAction, policy };
}

module.exports = {
  save_investigation,
  save_reconciliation_run,
  create_ai_activity,
  create_audit_log,
  resolve_exception,
  escalate_exception,
  approve_exception,
  execute_action
};
