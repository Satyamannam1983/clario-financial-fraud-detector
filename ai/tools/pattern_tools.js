const { getRuntime } = require('../runtime');
const { get_transactions, money } = require('./finance_tools');

async function get_historical_exceptions() {
  const records = await get_transactions();
  return records.filter(record => record.status !== 'Matched');
}

function group_exception_patterns(exceptions) {
  const groups = new Map();
  for (const record of exceptions) {
    const varianceKey = record.difference == null ? 'missing' : record.difference;
    const key = `${record.pattern}:${varianceKey}`;
    if (!groups.has(key)) groups.set(key, { key, pattern: record.pattern, variance: record.difference, transactions: [] });
    groups.get(key).transactions.push(record);
  }
  return [...groups.values()];
}

function calculate_pattern_frequency(group) {
  return group.transactions.length;
}

function calculate_pattern_impact(group) {
  return group.transactions.reduce((sum, record) => sum + Math.abs(record.difference || record.payment?.amount || 0), 0);
}

async function detect_patterns() {
  const exceptions = await get_historical_exceptions();
  const grouped = group_exception_patterns(exceptions)
    .map(group => {
      const occurrences = calculate_pattern_frequency(group);
      const impact = calculate_pattern_impact(group);
      const confidence = Math.min(0.99, 0.55 + occurrences * 0.08 + (impact > 0 ? 0.1 : 0));
      return {
        key: group.key,
        pattern: group.pattern,
        variance: group.variance,
        occurrences,
        impact,
        confidence: Number(confidence.toFixed(2)),
        transactions: group.transactions.map(item => item.id),
        label: group.variance == null ? `${group.pattern} with missing settlement` : `${money(Math.abs(group.variance))} ${group.pattern.replace('_', ' ')}`
      };
    })
    .filter(group => group.occurrences >= 2)
    .sort((a, b) => b.occurrences - a.occurrences || b.impact - a.impact);
  return grouped;
}

async function save_pattern(pattern) {
  await getRuntime().savePattern(pattern);
  return pattern;
}

module.exports = {
  get_historical_exceptions,
  group_exception_patterns,
  calculate_pattern_frequency,
  calculate_pattern_impact,
  detect_patterns,
  save_pattern
};
