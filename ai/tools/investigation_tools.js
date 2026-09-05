const { getRuntime } = require('../runtime');
const { lookup_transaction, get_transactions, money } = require('./finance_tools');

async function collect_evidence(transaction_id) {
  const record = await lookup_transaction(transaction_id);
  if (!record) return [];
  const evidence = [
    { field: 'payment.amount', value: record.payment.amount, label: `Payment ${money(record.payment.amount)}` },
    { field: 'payment.status', value: record.payment.payment_status, label: `Payment status ${record.payment.payment_status}` },
    { field: 'order.order_id', value: record.order.order_id, label: `Order ${record.order.order_id}` },
    { field: 'order.amount', value: record.order.order_amount, label: `Order amount ${money(record.order.order_amount)}` },
    { field: 'settlement', value: record.settlement ? record.settlement.settlement_amount : null, label: record.settlement ? `Settlement ${money(record.settlement.settlement_amount)}` : 'Settlement record missing' }
  ];
  (record.reasons || []).forEach(reason => evidence.push({ field: 'matching_rule', value: reason, label: reason }));
  if (record.fee) evidence.push({ field: 'fee', value: record.fee.actual_fee, label: `Fee expected ${record.fee.expected_fee} / actual ${record.fee.actual_fee}` });
  if (record.bank) evidence.push({ field: 'bank.posted', value: record.bank.posted, label: record.bank.posted ? 'Bank statement posted' : 'Not posted on bank statement' });
  return evidence;
}

async function find_related_transactions(transaction_id) {
  const record = await lookup_transaction(transaction_id);
  if (!record) return [];
  const records = await get_transactions();
  return records.filter(item => item.id !== record.id && (
    item.order?.order_id === record.order?.order_id ||
    item.payment?.customer_id === record.payment?.customer_id ||
    item.difference === record.difference
  )).slice(0, 8);
}

async function get_exception_history(transaction_id) {
  const { getInvestigation, getAction, activityEvents } = getRuntime();
  const investigation = await getInvestigation(transaction_id);
  const action = getAction(transaction_id);
  const events = (activityEvents() || []).filter(event => String(event.detail || '').includes(transaction_id) || event.transaction_id === transaction_id);
  return { investigation, action, events: events.slice(0, 12) };
}

async function detect_related_patterns(transaction_id) {
  const record = await lookup_transaction(transaction_id);
  if (!record) return null;
  const records = await get_transactions();
  const same = records.filter(item => item.pattern === record.pattern && item.status !== 'Matched');
  const sameVariance = record.difference != null
    ? records.filter(item => item.difference === record.difference && item.status !== 'Matched')
    : [];
  return {
    pattern: record.pattern,
    exception_count: same.length,
    variance: record.difference,
    variance_count: sameVariance.length,
    sample_ids: (sameVariance.length ? sameVariance : same).slice(0, 5).map(item => item.id)
  };
}

module.exports = { collect_evidence, find_related_transactions, get_exception_history, detect_related_patterns };
