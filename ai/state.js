function createState(overrides = {}) {
  return {
    user_request: '',
    agent: null,
    action: null,
    exception_id: null,
    exception: null,
    payment: null,
    order: null,
    settlement: null,
    related_transactions: [],
    evidence: [],
    pattern: null,
    patterns: [],
    assessment: null,
    confidence: null,
    recommended_action: null,
    policy: null,
    executed_action: null,
    run: null,
    summary: null,
    error: null,
    success: true,
    final_response: null,
    steps: [],
    ...overrides
  };
}

module.exports = { createState };
