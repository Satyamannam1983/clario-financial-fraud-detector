(function () {
  const money = value => `₹${value.toLocaleString('en-IN')}`;
  const patterns = [
    ...Array(120).fill('exact'),
    ...Array(12).fill('fuzzy'),
    ...Array(6).fill('amount_mismatch'),
    ...Array(4).fill('missing_settlement'),
    ...Array(3).fill('duplicate'),
    ...Array(2).fill('settlement_delay'),
    ...Array(2).fill('fee_variance'),
    'refund_mismatch'
  ];
  const payments = [];
  const orders = [];
  const settlements = [];
  const refunds = [];
  const fees = [];
  const bankStatement = [];
  const merchants = [
    ['MER-ACME', 'Acme Retail', 'Retail'],
    ['MER-NOVA', 'Nova Market', 'Marketplace'],
    ['MER-URBAN', 'Urban Cart', 'Retail'],
    ['MER-ORBIT', 'Orbit Services', 'SaaS'],
    ['MER-LOTUS', 'Lotus Foods', 'Food & Beverage'],
    ['MER-CEDAR', 'Cedar Home', 'Home & Living'],
    ['MER-PULSE', 'Pulse Fitness', 'Wellness'],
    ['MER-MERIDIAN', 'Meridian Travel', 'Travel']
  ];

  patterns.forEach((pattern, index) => {
    const number = 10021 + index;
    const paymentId = `PAY-${number}`;
    const orderId = `ORD-${8421 + index}`;
    // Reused customers and merchants create realistic historical behaviour for risk rules.
    const velocityCluster = index >= 118 && index < 124;
    const customerId = velocityCluster ? 'CUS-VEL-91' : `CUS-${3100 + (index % 56)}`;
    const [merchantId, merchantName, merchantCategory] = merchants[index % merchants.length];
    const baseAmount = [4500, 8200, 2100, 12500, 6780, 3420, 9600][index % 7];
    const merchantOutlier = pattern === 'fuzzy' && index === 121;
    const amount = merchantOutlier ? 48500 : pattern === 'amount_mismatch' ? baseAmount + 244 : baseAmount;
    const paymentTime = velocityCluster
      ? new Date(Date.UTC(2026, 8, 5, 14, 10, (index - 118) * 12)).toISOString()
      : new Date(Date.UTC(2026, 8, 1 + Math.floor(index / 42), 9 + (index % 8), (index * 7) % 60)).toISOString();
    const sameOrder = pattern === 'duplicate' && index > 0 ? `ORD-${8421 + index - 1}` : orderId;
    const payment = {
      payment_id: paymentId,
      order_id: sameOrder,
      customer_id: customerId,
      amount,
      currency: 'INR',
      payment_status: 'Captured',
      payment_time: paymentTime,
      method: index % 3 === 0 ? 'UPI' : index % 3 === 1 ? 'Card' : 'Netbanking',
      gateway: index % 3 === 0 ? 'Razorpay' : index % 3 === 1 ? 'Stripe' : 'PayU',
      merchant_id: merchantId,
      merchant_name: merchantName,
      merchant_category: merchantCategory
    };
    const order = {
      order_id: sameOrder,
      customer_id: customerId,
      order_amount: pattern === 'amount_mismatch' ? baseAmount : amount,
      order_status: pattern === 'duplicate' ? 'Fulfilled' : 'Fulfilled',
      order_time: paymentTime,
      merchant_id: merchantId,
      merchant_name: merchantName
    };
    let settlementAmount = amount;
    if (pattern === 'amount_mismatch' || pattern === 'fee_variance') settlementAmount -= 244;
    if (pattern === 'refund_mismatch') settlementAmount = amount - 1200;
    const settlement = pattern === 'missing_settlement' ? null : {
      settlement_id: `SET-${59001 + index}`,
      payment_id: paymentId,
      settlement_amount: settlementAmount,
      settlement_date: pattern === 'settlement_delay' ? '2026-09-08' : '2026-09-05',
      settlement_status: pattern === 'settlement_delay' ? 'Delayed' : 'Settled',
      fee: pattern === 'fee_variance' ? 300 : 200,
      tax: pattern === 'fee_variance' ? 54 : 44
    };
    payments.push(payment);
    orders.push(order);
    settlements.push(settlement);
    refunds.push(pattern === 'refund_mismatch' ? { refund_id: `REF-${70001 + index}`, payment_id: paymentId, amount: 1200, status: 'Pending' } : null);
    fees.push({ payment_id: paymentId, expected_fee: 200, actual_fee: settlement?.fee ?? 0, tax: settlement?.tax ?? 0 });
    bankStatement.push({ reference_id: paymentId, amount: settlementAmount, posted: pattern !== 'missing_settlement' });
  });

  function scoreRecord(index) {
    const pattern = patterns[index];
    const payment = payments[index];
    const order = orders[index];
    const settlement = settlements[index];
    const reasons = [];
    let score = 100;
    if (payment.order_id === order.order_id) reasons.push('Order ID exact');
    else { reasons.push('Customer reference similar'); score -= 8; }
    if (settlement && settlement.payment_id === payment.payment_id) reasons.push('Payment ID exact');
    else if (!settlement) { reasons.push('Settlement record missing'); score -= 36; }
    if (settlement && settlement.settlement_amount === payment.amount) reasons.push('Amount exact');
    else if (settlement) { reasons.push(`Amount variance ${money(Math.abs(payment.amount - settlement.settlement_amount))}`); score -= pattern === 'fuzzy' ? 8 : 13; }
    if (pattern === 'fuzzy') { reasons.push('Timestamp difference: 18 min'); score = 86; }
    if (pattern === 'duplicate') { reasons.push('Duplicate order and amount'); score = 74; }
    if (pattern === 'settlement_delay') { reasons.push('Settlement date outside SLA'); score = 78; }
    if (pattern === 'fee_variance') { reasons.push('Fee differs from configured rule'); score = 82; }
    if (pattern === 'refund_mismatch') { reasons.push('Refund not reflected in settlement'); score = 69; }
    const status = pattern === 'exact' ? 'Matched' : pattern === 'fuzzy' ? 'Needs Review' : 'Exception';
    const severity = pattern === 'missing_settlement' ? 'Critical' : pattern === 'amount_mismatch' || pattern === 'duplicate' ? 'High' : pattern === 'exact' ? 'None' : 'Medium';
    const confidence = Math.max(62, Math.min(99, score));
    return {
      id: `RZP-${1021 + index}`,
      pattern,
      payment,
      order,
      settlement,
      refund: refunds[index],
      fee: fees[index],
      bank: bankStatement[index],
      status,
      severity,
      score: confidence,
      confidence: `${confidence}%`,
      difference: settlement ? payment.amount - settlement.settlement_amount : null,
      reasons
    };
  }

  const records = payments.map((_, index) => scoreRecord(index));
  const swapIds = (currentId, predicate) => {
    const target = records.find(predicate);
    const current = records.find(record => record.id === currentId);
    if (!target || !current || target.id === currentId) return;
    const previous = target.id;
    target.id = currentId;
    current.id = previous;
  };
  swapIds('RZP-1047', record => record.pattern === 'missing_settlement');
  swapIds('RZP-1022', record => record.difference === 244);
  const recurring = records.filter(record => record.difference === 244);
  window.ledgerPilotData = {
    payments, orders, settlements, refunds, fees, bankStatement, records,
    summary: {
      total: records.length,
      matched: records.filter(record => record.status === 'Matched').length,
      fuzzy: records.filter(record => record.pattern === 'fuzzy').length,
      exceptions: records.filter(record => record.status === 'Exception').length,
      recurringFeePattern: recurring.length >= 3
    }
  };
}());
