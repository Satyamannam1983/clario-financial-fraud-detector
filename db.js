const { MongoClient } = require('mongodb');

let client;
let database;

async function connectDatabase(seedData) {
  if (!process.env.MONGODB_URI) {
    console.warn('MongoDB is not configured; using process-local demo state.');
    return null;
  }
  client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  database = client.db(process.env.MONGODB_DB || 'ledgerpilot');
  await database.collection('records').createIndex({ id: 1 }, { unique: true });
  await database.collection('actions').createIndex({ id: 1 }, { unique: true });
  await database.collection('audit').createIndex({ time: -1 });
  await database.collection('investigations').createIndex({ id: 1 }, { unique: true });
  await database.collection('runs').createIndex({ runId: 1 }, { unique: true });
  await database.collection('activity').createIndex({ time: -1 });
  await database.collection('patterns').createIndex({ key: 1 }, { unique: true });
  await database.collection('risk_snapshots').createIndex({ run_id: 1 }, { unique: true });

  if (await database.collection('records').countDocuments() === 0) {
    await database.collection('records').insertMany(seedData.records.map(record => ({ ...record })));
  }
  return database;
}

function isConnected() {
  return Boolean(database);
}

async function records() {
  return database ? database.collection('records').find({}, { projection: { _id: 0 } }).toArray() : null;
}

async function saveRecords(rows) {
  if (!database || !rows?.length) return;
  const ops = rows.map(record => ({
    updateOne: { filter: { id: record.id }, update: { $set: { ...record } }, upsert: true }
  }));
  await database.collection('records').bulkWrite(ops, { ordered: false });
}

async function actionMap() {
  if (!database) return null;
  const rows = await database.collection('actions').find({}, { projection: { _id: 0 } }).toArray();
  return new Map(rows.map(row => [row.id, row.action]));
}

async function saveAction(id, action) {
  if (database) await database.collection('actions').updateOne({ id }, { $set: { id, action, updatedAt: new Date() } }, { upsert: true });
}

async function saveAudit(event) {
  if (database) await database.collection('audit').insertOne({ ...event });
}

async function auditEvents() {
  return database ? database.collection('audit').find({}, { projection: { _id: 0 } }).sort({ time: -1 }).toArray() : null;
}

async function saveInvestigation(id, investigation) {
  if (database) await database.collection('investigations').updateOne({ id }, { $set: { id, investigation, updatedAt: new Date() } }, { upsert: true });
}

async function getInvestigation(id) {
  if (!database) return null;
  const row = await database.collection('investigations').findOne({ id }, { projection: { _id: 0 } });
  return row?.investigation || null;
}

async function saveRun(run) {
  if (database) await database.collection('runs').replaceOne({ runId: run.runId }, { ...run, updatedAt: new Date() }, { upsert: true });
}
async function getRun(runId) {
  if (!database) return null;
  return database.collection('runs').findOne({ runId }, { projection: { _id: 0 } });
}
async function runs(limit = 50) {
  return database ? database.collection('runs').find({}, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(limit).toArray() : null;
}
async function saveActivity(event) {
  if (database) await database.collection('activity').insertOne({ ...event });
}
async function activity(limit = 100) {
  return database ? database.collection('activity').find({}, { projection: { _id: 0 } }).sort({ time: -1 }).limit(limit).toArray() : null;
}
async function savePattern(pattern) {
  if (database) await database.collection('patterns').replaceOne({ key: pattern.key }, { ...pattern, updatedAt: new Date() }, { upsert: true });
}
async function patterns() {
  return database ? database.collection('patterns').find({}, { projection: { _id: 0 } }).toArray() : null;
}
async function saveRiskSnapshot(snapshot) {
  if (database) await database.collection('risk_snapshots').replaceOne(
    { run_id: snapshot.run_id },
    { ...snapshot, updatedAt: new Date() },
    { upsert: true }
  );
}
async function riskSnapshots(limit = 52) {
  return database
    ? database.collection('risk_snapshots').find({}, { projection: { _id: 0 } }).sort({ date: 1 }).limit(limit).toArray()
    : null;
}

module.exports = {
  connectDatabase, isConnected, records, saveRecords, actionMap, saveAction, saveAudit, auditEvents,
  saveInvestigation, getInvestigation, saveRun, getRun, runs, saveActivity, activity,
  savePattern, patterns, saveRiskSnapshot, riskSnapshots
};
