const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ai = require('../ai');

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'finance-data.js'), 'utf8'), sandbox);
const records = sandbox.window.ledgerPilotData.records.map(record => ({ ...record }));
const actions = new Map();
const investigations = new Map();
const runs = new Map();
const activity = [];
const audit = [];
const patterns = [];

ai.attach({
  getRecords: async () => records,
  saveRecords: async (rows) => { records.splice(0, records.length, ...rows); },
  getRecord: async (id) => records.find(record => record.id === id) || null,
  getAction: (id) => actions.get(id) || null,
  saveAction: async (id, action) => { actions.set(id, action); },
  getInvestigation: async (id) => investigations.get(id) || null,
  saveInvestigation: async (id, investigation) => { investigations.set(id, investigation); },
  saveRun: async (run) => { runs.set(run.runId, run); },
  savePattern: async (pattern) => { patterns.push(pattern); },
  recordActivity: (event) => { activity.unshift(event); return event; },
  recordAudit: (event) => { audit.unshift(event); return event; },
  getSummary: async () => ({
    total: records.length,
    matched: records.filter(record => record.status === 'Matched').length,
    exceptions: records.filter(record => record.status !== 'Matched').length,
    resolved: [...actions.values()].filter(action => action === 'resolve').length,
    escalated: [...actions.values()].filter(action => action === 'escalate').length,
    open: records.filter(record => record.status !== 'Matched').length
  }),
  activityEvents: () => activity
});

async function assert(label, condition) {
  if (!condition) throw new Error(`FAIL ${label}`);
  console.log(`PASS ${label}`);
}

async function main() {
  const rzp1047 = records.find(record => record.id === 'RZP-1047');
  const rzp1022 = records.find(record => record.id === 'RZP-1022');
  await assert('RZP-1047 is missing settlement in seed', rzp1047?.pattern === 'missing_settlement' && !rzp1047.settlement);
  await assert('RZP-1022 has ₹244 variance in seed', rzp1022?.difference === 244);

  const recon = await ai.handleController('Run reconciliation');
  await assert('reconciliation agent', recon.success && recon.agent === 'reconciliation' && recon.run?.summary?.total === records.length);

  const investigate = await ai.handleController('Investigate RZP-1047');
  await assert('investigation uses live missing settlement', investigate.success && /missing|no settlement/i.test(investigate.response) && investigate.investigation.exception_type === 'missing_settlement');

  const patternsResult = await ai.handleController('Find recurring issues');
  await assert('pattern agent finds ₹244 cluster', patternsResult.success && /244/.test(patternsResult.response));

  const blocked = await ai.handleController('Resolve RZP-1047');
  await assert('policy blocks missing settlement resolve', blocked.success === false && /cannot be auto-resolved|Policy blocked/i.test(blocked.response));

  const resolved = await ai.handleController('Resolve RZP-1022');
  await assert('resolve eligible amount mismatch', resolved.success && actions.get('RZP-1022') === 'resolve');

  const duplicate = await ai.handleController('Resolve RZP-1022');
  await assert('duplicate action rejected', duplicate.success === false);

  const escalated = await ai.handleController('Escalate RZP-1047');
  await assert('escalate missing settlement', escalated.success && actions.get('RZP-1047') === 'escalate');

  await assert('activity events recorded', activity.length > 5);
  await assert('audit events recorded', audit.some(event => event.title === 'investigation_completed') && audit.some(event => event.title === 'exception_resolved'));
  console.log('All agent scenarios passed.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
