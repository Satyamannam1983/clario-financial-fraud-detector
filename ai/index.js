const { attach } = require('./runtime');
const { completeJson, available } = require('./mistral');
const controller = require('./agents/controller');
const reconciliationAgent = require('./agents/reconciliation_agent');
const investigationAgent = require('./agents/investigation_agent');
const patternAgent = require('./agents/pattern_agent');
const resolutionAgent = require('./agents/resolution_agent');

async function investigateException(record) {
  const result = await investigationAgent.run(record.id, `Investigate ${record.id}`);
  if (result.investigation) return result.investigation;
  throw new Error(result.error || 'Investigation failed');
}

module.exports = {
  attach,
  available,
  completeJson,
  handleController: controller.handle,
  runReconciliation: reconciliationAgent.run,
  investigate: investigationAgent.run,
  investigateException,
  detectPatterns: patternAgent.run,
  listUnresolved: patternAgent.list_unresolved,
  resolve: (id) => resolutionAgent.run(id, 'resolve', `Resolve ${id}`),
  escalate: (id) => resolutionAgent.run(id, 'escalate', `Escalate ${id}`),
  approve: (id) => resolutionAgent.run(id, 'approve', `Approve ${id}`),
  hold: (id) => resolutionAgent.run(id, 'hold', `Place ${id} on hold`)
};
