const { getRuntime } = require('../runtime');

function money(value) {
  return `₹${Number(value).toLocaleString('en-IN')}`;
}

function normalizeRecord(record) {
  const payment = record.payment || {};
  const order = record.order || {};
  const settlement = record.settlement || null;
  return {
    ...record,
    payment: { ...payment, amount: Number(payment.amount || 0), order_id: payment.order_id || order.order_id },
    order: { ...order, order_amount: Number(order.order_amount || 0) },
    settlement: settlement ? { ...settlement, settlement_amount: Number(settlement.settlement_amount || 0) } : null
  };
}

function calculate_match_score(payment, order, settlement, extras = {}) {
  const reasons = [];
  let score = 100;
  if (payment?.order_id && order?.order_id && payment.order_id === order.order_id) reasons.push('Order ID exact');
  else { reasons.push('Customer reference similar'); score -= 8; }
  if (settlement && settlement.payment_id === payment.payment_id) reasons.push('Payment ID exact');
  else if (!settlement) { reasons.push('Settlement record missing'); score -= 36; }
  if (settlement && settlement.settlement_amount === payment.amount) reasons.push('Amount exact');
  else if (settlement) {
    reasons.push(`Amount variance ${money(Math.abs(payment.amount - settlement.settlement_amount))}`);
    score -= 13;
  }
  if (extras.duplicate) { reasons.push('Duplicate order and amount'); score = Math.min(score, 74); }
  if (extras.delayed) { reasons.push('Settlement date outside SLA'); score = Math.min(score, 78); }
  const confidence = Math.max(62, Math.min(99, score));
  return { score: confidence, confidence: `${confidence}%`, reasons };
}

function inferPattern(record, related = []) {
  const { payment, order, settlement, refund } = record;
  const duplicates = related.filter(item => item.id !== record.id && item.order?.order_id === order?.order_id);
  if (!settlement) return 'missing_settlement';
  if (duplicates.length) return 'duplicate';
  if (refund) return 'refund_mismatch';
  const difference = payment.amount - settlement.settlement_amount;
  if (difference === 0 && payment.order_id === order.order_id) return 'exact';
  if (settlement.settlement_status === 'Delayed') return 'settlement_delay';
  if (Math.abs(difference) > 0 && record.fee && record.fee.actual_fee !== record.fee.expected_fee) return 'fee_variance';
  if (Math.abs(difference) > 0) return Math.abs(difference) < 400 ? 'amount_mismatch' : 'fuzzy';
  return record.pattern || 'fuzzy';
}

function classifyStatus(pattern) {
  if (pattern === 'exact') return { status: 'Matched', severity: 'None' };
  if (pattern === 'fuzzy') return { status: 'Needs Review', severity: 'Medium' };
  if (pattern === 'missing_settlement') return { status: 'Exception', severity: 'Critical' };
  if (pattern === 'amount_mismatch' || pattern === 'duplicate') return { status: 'Exception', severity: 'High' };
  return { status: 'Exception', severity: 'Medium' };
}

async function get_transactions() {
  return getRuntime().getRecords();
}

async function lookup_transaction(transaction_id) {
  const records = await get_transactions();
  const id = String(transaction_id || '').toUpperCase();
  return records.find(record => record.id.toUpperCase() === id) || null;
}

async function normalize_records(records) {
  return (records || await get_transactions()).map(normalizeRecord);
}

function rematchRecord(record, all) {
  const normalized = normalizeRecord(record);
  const related = all.filter(item => item.order?.order_id === normalized.order.order_id);
  const pattern = inferPattern(normalized, related);
  const extras = { duplicate: pattern === 'duplicate', delayed: pattern === 'settlement_delay' };
  const scored = calculate_match_score(normalized.payment, normalized.order, normalized.settlement, extras);
  const { status, severity } = classifyStatus(pattern);
  return {
    ...normalized,
    pattern,
    ...scored,
    status,
    severity,
    difference: normalized.settlement ? normalized.payment.amount - normalized.settlement.settlement_amount : null
  };
}

async function run_reconciliation() {
  const loaded = await get_transactions();
  const normalized = await normalize_records(loaded);
  const matched = normalized.map(record => rematchRecord(record, normalized));
  await getRuntime().saveRecords(matched);
  const summary = calculate_reconciliation_metrics(matched);
  const exceptions = matched.filter(record => record.status !== 'Matched');
  return { records: matched, summary, exceptions };
}

function calculate_reconciliation_metrics(records) {
  const exceptions = records.filter(record => record.status === 'Exception' || record.status === 'Needs Review');
  const matched = records.filter(record => record.status === 'Matched');
  return {
    total: records.length,
    matched: matched.length,
    exceptions: exceptions.length,
    open: exceptions.length,
    matchRate: records.length ? Number(((matched.length / records.length) * 100).toFixed(1)) : 0
  };
}

function create_exception(record) {
  return record.status !== 'Matched' ? record : null;
}

module.exports = {
  money,
  get_transactions,
  lookup_transaction,
  normalize_records,
  calculate_match_score,
  calculate_reconciliation_metrics,
  run_reconciliation,
  create_exception,
  rematchRecord,
  inferPattern
};
