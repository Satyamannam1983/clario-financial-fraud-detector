const inr = value => `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;

function riskScore(record, all = []) {
  const signals = [];
  const push = (key, label, points, detail, kind = 'risk') => { if (points > 0) signals.push({ key, label, points, detail, kind }); };
  const diff = Math.abs(record.difference || 0);
  const pay = record.payment || {};
  const customerId = pay.customer_id;
  const peers = all.filter(r => r.id !== record.id);
  const payTime = pay.payment_time ? new Date(pay.payment_time).getTime() : null;
  const merchantId = pay.merchant_id;
  const merchantName = pay.merchant_name || merchantId || 'This merchant';
  const merchantAmounts = peers.filter(r => r.payment?.merchant_id === merchantId).map(r => r.payment?.amount || 0);
  if (payTime && customerId) {
    const withinWindow = peers.filter(r => r.payment?.customer_id === customerId && r.payment?.payment_time && Math.abs(new Date(r.payment.payment_time).getTime() - payTime) <= 45000).length;
    if (withinWindow >= 6) push('velocity_anomaly', 'Velocity anomaly', 26, `${withinWindow + 1} payments from the same account within a 90 second window`, 'critical');
    else if (withinWindow >= 3) push('velocity_anomaly', 'Velocity anomaly', 18, `${withinWindow + 1} payments from the same account within a 90 second window`, 'risk');
  }
  if (merchantAmounts.length >= 2) {
    const sorted = [...merchantAmounts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    const amount = pay.amount || 0;
    if (median > 0 && amount >= 12000 && amount >= median * 5) push('merchant_frequency_anomaly', 'Merchant frequency anomaly', 22, `${merchantName} normally processes ${inr(Math.round(median * 0.5))}–${inr(Math.round(median * 1.5))}; this transaction is ${inr(amount)}`, 'risk');
    else if (median > 0 && amount >= 8000 && amount >= median * 3) push('merchant_frequency_anomaly', 'Merchant frequency anomaly', 12, `${merchantName} normally processes ${inr(Math.round(median * 0.5))}–${inr(Math.round(median * 1.5))}; this transaction is ${inr(amount)}`, 'info');
  }
  const recurringCount = peers.filter(r => r.pattern === record.pattern && r.status !== 'Matched').length;
  if (record.pattern === 'missing_settlement') push('missing', 'Missing settlement', 78, 'Payment and order matched, but no settlement record exists', 'critical');
  if (record.pattern === 'duplicate') push('duplicate', 'Duplicate payment', 54, 'Same order captured more than once in a short window', 'risk');
  if (record.pattern === 'refund_mismatch') push('refund', 'Refund mismatch', 34, 'Refund not reflected in settlement', 'risk');
  if (record.difference !== null && diff > 0) {
    const points = diff >= 2000 ? 28 : diff >= 1000 ? 22 : diff >= 244 ? 16 : 10;
    push('amount', 'Amount anomaly', points, `Variance of ${inr(diff)} vs expected`, 'risk');
  }
  if (record.pattern === 'settlement_delay') push('timing', 'Unusual settlement timing', 20, 'Settlement date outside SLA', 'risk');
  if (record.pattern === 'fee_variance') push('fee', 'Settlement fee mismatch', 12, 'Fee differs from configured rule', 'info');
  if (record.pattern === 'fuzzy') push('fuzzy', 'Merchant reference similarity', 8, 'Customer reference similar, not exact', 'info');
  if (recurringCount >= 6) push('history', 'Historical recurrence', 12, `${recurringCount} similar open cases`, 'risk');
  else if (recurringCount >= 3) push('history', 'Historical recurrence', 8, `${recurringCount} similar open cases`, 'risk');
  let score = Math.max(0, Math.min(100, signals.reduce((sum, s) => sum + s.points, 0)));
  const tier = score >= 75 ? 'High' : score >= 50 ? 'Medium' : 'Low';
  const recommendation = tier === 'High' ? 'hold' : tier === 'Medium' ? 'review' : 'continue';
  signals.sort((a, b) => b.points - a.points || a.label.localeCompare(b.label));
  const risk_reasons = signals.map(s => ({ signal: s.key, points: s.points, severity: s.kind === 'critical' ? 'critical' : s.kind === 'risk' ? 'high' : 'moderate', explanation: s.detail }));
  const grouped = new Map();
  for (const signal of signals) grouped.set(signal.label, (grouped.get(signal.label) || 0) + signal.points);
  const breakdown = [
    { label: 'Base score', points: 0 },
    ...[...grouped.entries()].map(([label, points]) => ({ label: label[0].toUpperCase() + label.slice(1), points })).sort((a, b) => b.points - a.points)
  ];
  return { score, tier, signals, risk_reasons, breakdown, recommendation, velocity: 0, recurring: recurringCount, risk_score: score, risk_tier: tier };
}

function scoreBreakdownText(result, id) {
  const rows = (result.breakdown || []).map(item => `  +${item.points}  ${item.label}`).join('\n');
  return `Why is the risk score ${result.score} for ${id}? It's the sum of deterministic, rule-based signals:\n\nRisk Score Breakdown\nBase score        0\n${rows}\n${'─'.repeat(28)}\nRisk score        ${result.score} (${result.tier})\n\nEach signal is computed from ledger data — this is an anomaly/risk score, not a fraud probability.`;
}

function flagReason(record, risk) {
  const top = risk.signals.find(s => s.kind !== 'info') || risk.signals[0];
  return top ? top.label : record.pattern.replace(/_/g, ' ') || 'Exception';
}

function riskStats(records, actions) {
  const high = [], medium = [], low = [];
  for (const record of records) {
    if (record.status === 'Matched') continue;
    const tier = record.risk?.tier || 'Low';
    if (tier === 'High') high.push(record);
    else if (tier === 'Medium') medium.push(record);
    else low.push(record);
  }
  const atRiskValue = [...high, ...medium].reduce((sum, r) => sum + (r.payment?.amount || 0), 0);
  const holds = records.filter(r => actions?.get(r.id) === 'hold').length;
  return { high: high.length, medium: medium.length, low: low.length, atRiskValue, holds, highFlags: high, mediumFlags: medium };
}

function topSignals(records) {
  const grouped = new Map();
  for (const record of records) {
    if (record.status === 'Matched' || !record.risk) continue;
    for (const signal of record.risk.signals) {
      if (signal.kind === 'info') continue;
      grouped.set(signal.label, (grouped.get(signal.label) || 0) + 1);
    }
  }
  return [...grouped.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 5);
}

function riskTrend(snapshots) {
  return (snapshots || []).map((snapshot, i) => ({
    week: `Run ${i + 1}`,
    label: `Run ${i + 1}`,
    date: snapshot.date,
    high: snapshot.high,
    medium: snapshot.medium,
    low: snapshot.low,
    atRiskValue: snapshot.at_risk_value
  }));
}

function rootCause(records) {
  const pool = records.filter(r => r.status !== 'Matched' && r.risk && r.risk.tier !== 'Low');
  if (!pool.length) return null;
  const counts = new Map();
  for (const record of pool) counts.set(record.pattern, (counts.get(record.pattern) || 0) + 1);
  let top = null, topCount = 0;
  for (const [pattern, count] of counts) if (count > topCount) { top = pattern; topCount = count; }
  const pct = Math.round((topCount / pool.length) * 100);
  const impact = pool.filter(r => r.pattern === top).reduce((sum, r) => sum + (r.payment?.amount || 0), 0);
  const diffs = pool.filter(r => r.difference).map(r => Math.abs(r.difference));
  const freq = new Map();
  for (const value of diffs) freq.set(value, (freq.get(value) || 0) + 1);
  let mode = null, modeCount = 0;
  for (const [value, count] of freq) if (count > modeCount) { mode = value; modeCount = count; }
  const label = top.replace(/_/g, ' ');
  const advice = mode
    ? `A recurring ${inr(mode)} variance appears in ${modeCount} of the ${pool.length} flagged case(s).`
    : `${label} is the dominant failure across flagged cases.`;
  return {
    pattern: label,
    pct,
    share: pct,
    count: topCount,
    financial_impact: impact,
    modeDiff: mode || null,
    advice,
    recommendation: `Review settlement reconciliation rules for ${label} — ${advice}`
  };
}

module.exports = { riskScore, riskStats, topSignals, riskTrend, rootCause, flagReason, scoreBreakdownText, inr };
