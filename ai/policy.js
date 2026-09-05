const INELIGIBLE_AUTO_RESOLVE = new Set(['missing_settlement', 'duplicate', 'refund_mismatch']);

function numericConfidence(value) {
  if (typeof value === 'number') return value > 1 ? value / 100 : value;
  if (typeof value === 'string') return Number(value.replace('%', '')) / 100;
  return 0;
}

function evidenceSufficient(evidence = []) {
  return Array.isArray(evidence) && evidence.length >= 3;
}

function evaluatePolicy({ exception, investigation, requestedAction, actor = 'user' }) {
  const pattern = exception?.pattern || investigation?.exception_type || 'unknown';
  const confidence = numericConfidence(investigation?.confidence ?? exception?.confidence);
  const evidence = investigation?.evidence || [];
  const already = exception?.resolution;
  const reasons = [];

  if (!exception) {
    return { allowed: false, decision: 'reject', policy_action: 'reject', reasons: ['Exception not found'] };
  }
  if (already && already === requestedAction) {
    return { allowed: false, decision: 'duplicate', policy_action: requestedAction, reasons: [`${exception.id} already has action "${already}"`] };
  }
  if (already === 'hold' && requestedAction === 'resolve') {
    return { allowed: false, decision: 'on_hold', policy_action: 'approve_or_escalate', confidence, reasons: [`${exception.id} is on hold. A held transaction must be approved or escalated; it cannot be auto-resolved.`] };
  }
  if (exception.status === 'Matched' && requestedAction !== 'review') {
    return { allowed: false, decision: 'reject', policy_action: 'reject', reasons: [`${exception.id} is matched and is not an open exception`] };
  }

  let policyAction = 'escalate';
  if (INELIGIBLE_AUTO_RESOLVE.has(pattern)) {
    policyAction = 'escalate';
    reasons.push(`${pattern} cannot be auto-resolved`);
  } else if (confidence >= 0.9 && evidenceSufficient(evidence)) {
    policyAction = 'resolve';
    reasons.push('confidence >= 0.90 and evidence is sufficient');
  } else if (confidence >= 0.7) {
    policyAction = actor === 'user' && evidenceSufficient(evidence) ? 'resolve' : 'review';
    reasons.push(policyAction === 'resolve'
      ? 'human-requested resolve allowed at confidence 0.70–0.89 with sufficient evidence'
      : 'confidence 0.70–0.89 requires human review');
  } else {
    policyAction = 'escalate';
    reasons.push('confidence below 0.70 must be escalated');
  }

  if (requestedAction === 'escalate' || requestedAction === 'approve') {
    return { allowed: true, decision: requestedAction, policy_action: policyAction, confidence, reasons };
  }
  if (requestedAction === 'hold') {
    reasons.push('finance-controlled hold: no automatic actions until released');
    return { allowed: true, decision: 'hold', policy_action: 'hold', confidence, reasons };
  }
  if (requestedAction === 'resolve') {
    const allowed = policyAction === 'resolve';
    if (!allowed) reasons.push('backend policy denied auto-resolution');
    return { allowed, decision: allowed ? 'resolve' : policyAction, policy_action: policyAction, confidence, reasons };
  }
  return { allowed: false, decision: policyAction, policy_action: policyAction, confidence, reasons };
}

function recommendFromPolicy(exception, investigation) {
  return evaluatePolicy({ exception, investigation, requestedAction: 'resolve', actor: 'policy' }).policy_action;
}

module.exports = { evaluatePolicy, recommendFromPolicy, numericConfidence, INELIGIBLE_AUTO_RESOLVE };
