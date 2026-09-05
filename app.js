let matchedRecords = window.ledgerPilotData.records;
let currentPage = 'overview';
const workspaceState = { audit: [], reports: null, activity: [], runs: [] };
let investigationState = null;
const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3001/api' : '/api';
const TOKEN_KEY = 'clario.apiToken';
async function api(path, options = {}) {
  const headers = {'Content-Type': 'application/json', ...(options.headers || {})};
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {...options, headers});
  } catch (networkError) {
    throw new Error('Cannot reach the Clario server. Make sure `node server.js` is running on port 3001.', {cause: networkError});
  }
  if (response.status === 401 && path !== '/auth/login') {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('clario.authenticated');
    showLogin();
    throw new Error('Authentication required');
  }
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `API request failed (${response.status})`);
  return response.json();
}
async function hydrateData() {
  try {
    const payload = await api('/reconciliation');
    matchedRecords = payload.records;
    window.ledgerPilotData.records = payload.records;
    window.ledgerPilotData.summary = payload.summary;
  } catch (error) {
    console.warn('Clario API unavailable; using local demo data.', error.message);
  }
}
async function hydrateWorkspace() {
  const [auditPayload, reportsPayload, activityPayload, runsPayload, agentsPayload, settingsPayload, healthPayload] = await Promise.all([api('/audit'), api('/reports'), api('/ai/activity'), api('/reconciliation/runs'), api('/ai/agents').catch(() => ({ agents: [] })), api('/settings').catch(() => null), api('/health').catch(() => null)]);
  workspaceState.audit = auditPayload.events || [];
  workspaceState.reports = reportsPayload;
  workspaceState.activity = activityPayload.events || [];
  workspaceState.runs = runsPayload.runs || [];
  workspaceState.agents = agentsPayload.agents || [];
  workspaceState.settings = settingsPayload;
  workspaceState.health = healthPayload;
}
function dashboardMetrics() {
  const data = window.ledgerPilotData;
  const captured = data.records.reduce((sum, record) => sum + record.payment.amount, 0);
  const settled = data.records.reduce((sum, record) => sum + (record.settlement?.settlement_amount || 0), 0);
  return { captured, settled, coverage: captured ? Math.round((settled / captured) * 100) : 0 };
}
const records = matchedRecords.slice(0, 5).map(record => [
  record.id,
  money(record.payment.amount),
  money(record.order.order_amount),
  record.settlement ? money(record.settlement.settlement_amount) : 'Missing',
  record.difference === null ? '—' : money(Math.abs(record.difference)),
  record.status,
  record.status === 'Matched' ? 'green' : record.severity === 'Critical' ? 'orange' : 'yellow'
]);
function money(value) { return `₹${(Number(value)||0).toLocaleString('en-IN')}`; }
function moneyShort(value){const n=Number(value)||0;if(n>=10000000)return `₹${(n/10000000).toFixed(2)}Cr`;if(n>=100000)return `₹${(n/100000).toFixed(2)}L`;if(n>=1000)return `₹${(n/1000).toFixed(1)}K`;return `₹${n.toLocaleString('en-IN')}`}
const pages = {
 overview:{label:'Overview', html:`<div class="page overview-page"><div class="hero-kicker">CLARIO / FINANCE CONTROL CENTER <span>04 SEP 2026</span></div><div class="hero-copy"><div><h1>Reconciliation<br><em>under control.</em></h1><p>Track match quality, surface exceptions early, and move every financial record toward resolution.</p><div class="hero-signal"><div class="hero-signal-copy"><span>LIVE MATCH RATE</span><strong>94.5%</strong><b>↑ 2.1% from last run</b></div><div class="hero-sparkline" aria-label="Match rate trend"><i style="height:42%"></i><i style="height:56%"></i><i style="height:49%"></i><i style="height:72%"></i><i style="height:67%"></i><i style="height:86%"></i><i style="height:100%"></i></div></div></div><button class="hero-cta" id="hero-run">Run Reconciliation <b>→</b></button></div><div class="ai-float"><span class="ai-orb">✦</span><div><b>AI analyzing settlement patterns...</b><small>7 exceptions in focus</small><div class="ai-progress"><i></i></div></div><strong>ACTIVE</strong></div>
 <section class="health-modules"><div class="health-module health-ring-card"><div class="eyebrow">RECONCILIATION HEALTH</div><div class="health-ring-visual"><div><strong>94.5%</strong><span>HEALTHY</span></div></div><div class="health-details"><b>120 matched</b><b>7 exceptions</b><b>23 under review</b></div><span class="health-trend">↑ 2.1% from last run</span></div><div class="health-module value-module"><div class="eyebrow">VALUE RECONCILED</div><strong class="value-total">₹2.84L</strong><div class="value-track"><i></i></div><div class="value-footer"><span>₹3.12L captured</span><b>+12% this run</b></div><div class="coverage-signal"><div class="coverage-heading"><span>SETTLEMENT COVERAGE</span><b>91%</b></div><div class="coverage-blocks"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><small>₹28K held in exception review</small></div></div></section><section class="money-flow-panel card"><div class="section-head"><div><div class="eyebrow">MONEY FLOW</div><h2>Where value moved</h2></div><span class="card-note">CURRENT RUN</span></div><div class="money-flow"><div><small>CAPTURED</small><b>₹3.12L</b></div><i>↓</i><div><small>ORDERED</small><b>₹3.08L</b></div><i>↓</i><div class="money-settled"><small>SETTLED</small><b>₹2.84L</b></div><i>↓</i><div class="money-exception"><small>EXCEPTIONS</small><b>₹34.7K</b></div></div></section>
 <div class="cockpit-grid"><section class="flow-panel"><div class="section-intro"><div><div class="eyebrow">SIGNATURE SYSTEM</div><h2>Reconciliation Flow</h2><p>From payments to a perfectly reconciled record.</p></div><span class="flow-note">AI cross-checks data across all sources</span></div><div class="flow-map"><div class="flow-node"><span class="node-icon">↗</span><small>PAYMENTS</small><b>127</b><em>records</em></div><div class="flow-line"><i></i><span>normalized</span></div><div class="flow-node"><span class="node-icon">◫</span><small>ORDERS</small><b>127</b><em>verified</em></div><div class="flow-line"><i></i><span>matched</span></div><div class="flow-node success-node"><span class="node-icon">✓</span><small>SETTLEMENTS</small><b>120</b><em>matched</em></div><div class="exception-branch"><div class="branch-line"></div><div class="flow-node exception-node"><span class="node-icon">!</span><small>EXCEPTIONS</small><b>7</b><em>detected</em></div></div></div><div class="flow-footer"><span><i class="legend-dot"></i>Exact match</span><span><i class="legend-dot coral"></i>Needs investigation</span><button data-page-link="reconciliation">Explore all records →</button></div></section>
 <section class="controller-panel"><div class="controller-top"><div><div class="eyebrow">AI CONTROLLER</div><h2>Operational intelligence</h2></div><span class="live-pill"><i></i> ACTIVE</span></div><div class="controller-task"><small>CURRENT TASK</small><b>Investigating RZP-1047</b><span>Missing settlement record</span></div><div class="controller-steps">${controllerStep('✓','Payment located','done')}${controllerStep('✓','Order verified','done')}${controllerStep('◉','Checking settlement...','current')}${controllerStep('○','Analyzing transaction pattern','')}${controllerStep('○','Preparing recommendation','')}</div><p class="controller-foot">Finding the why behind every mismatch.</p></section></div>
 <div class="lower-grid"><section class="activity-panel"><div class="section-head"><div><div class="eyebrow">LIVE LOG</div><h2>Recent Activity</h2></div><button data-page-link="activity">View all →</button></div><div class="activity-feed">${feed('✓','Reconciliation run completed','127 records processed','2 min ago')}${feed('✓','5 exceptions automatically resolved','AI confidence > 90%','8 min ago')}${feed('⚠','Investigating RZP-1047','Missing settlement record','12 min ago')}${feed('●','Data normalized','127 records standardized','14 min ago')}</div></section><section class="attention-panel"><div class="section-head"><div><div class="eyebrow">REVIEW QUEUE</div><h2>Exceptions needing attention</h2></div><button data-page-link="exceptions">See all →</button></div><div class="exception-feed">${attention('RZP-1047','Missing settlement','₹12,500','Critical','91%','critical')}${attention('RZP-1022','Amount mismatch','₹8,240','High','87%','high')}${attention('RZP-1038','Duplicate transaction','₹6,780','Medium','76%','medium')}${attention('RZP-1011','Settlement delay','₹4,320','Low','68%','low')}</div></section></div>
 <section class="runs-panel"><div class="section-head"><div><div class="eyebrow">HISTORY</div><h2>Recent Runs</h2></div><button data-page-link="reports">Run history →</button></div><div class="run-list">${runRow('RECON-2026-09-04-001','127 / 127 matched','94.5%')}${runRow('RECON-2026-09-03-001','98 / 102 matched','96.1%')}${runRow('RECON-2026-09-02-001','210 / 220 matched','95.5%')}</div></section></div>`},
 reconciliation:{label:'Reconciliation',html:reconciliationPage()},
 transactions:{label:'Transactions',html:reconciliationPage()},
 investigation:{label:'AI Investigation',html:investigationPage()},
 exceptions:{label:'Exception Center',html:exceptionsPage()},
 activity:{label:'AI Activity',html:`<div class="page"><div class="eyebrow">WORKSPACE / AUTOMATION</div><h1 class="page-title">AI Agent Activity</h1><p class="page-subtitle">A transparent log of what Clario has processed and why.</p><section class="card section-card"><div class="card-heading"><div><div class="card-title">Run RECON-2026-09-04-001</div><div class="card-note">Completed 2 minutes ago · 127 records</div></div><span class="status green">COMPLETE</span></div><div class="timeline large">${activity('✓','Loaded 127 records')}${activity('✓','Normalized transaction data')}${activity('✓','Matched 120 transactions')}${activity('⚠','Investigating 7 exceptions','warn')}${activity('→','3 cases require human review','arrow')}${activity('✓','Generated reconciliation report')}</div></section></div>`},
 audit:{label:'Audit Trail',html:`<div class="page"><div class="eyebrow">INSIGHTS / CONTROL LOG</div><h1 class="page-title">Audit Trail</h1><p class="page-subtitle">Every agent action, evidence source, and finance decision in one place.</p><section class="audit-panel">${auditRow('09:42:01','Records imported','127 records','done')}${auditRow('09:42:03','Matching completed','120 matches · 94.5%','done')}${auditRow('09:42:05','Exception detected','RZP-1047 · Missing settlement','warning')}${auditRow('09:42:07','AI investigation started','Agent confidence workflow','active')}${auditRow('09:42:09','Evidence collected','4 transaction sources','done')}${auditRow('09:42:10','Recommendation generated','Confidence: 91%','active')}${auditRow('09:42:14','Escalated to Finance','Human review required','warning')}</section></div>`},
 reports:{label:'Reports',html:`<div class="page"><div class="eyebrow">WORKSPACE / INSIGHTS</div><h1 class="page-title">Reports</h1><p class="page-subtitle">Operational summaries built from your reconciliation history.</p><div class="metric-strip">${stat('94.5%','Match Rate','Current run','','reports')}${stat('18 min','Avg. Resolution','↓ 12% this month','','reports')}${stat('₹38.2K','Recovered Value','This month','','reports')}${stat('24','Runs Completed','Last 30 days','','reports')}</div><div class="reports-grid"><section class="card section-card report-chart-card"><div class="section-head"><div><div class="eyebrow">RECONCILIATION PERFORMANCE</div><h2>Match rate by run</h2></div><span class="status green">LAST 7 RUNS</span></div><div class="report-chart"><div class="chart-y"><span>100%</span><span>75%</span><span>50%</span><span>25%</span></div><div class="chart-bars">${['91','94','88','96','93','97','95'].map((value,index)=>`<div class="chart-bar-wrap"><b style="height:${value}%"></b><span>R${index+1}</span></div>`).join('')}</div></div></section><section class="card section-card report-breakdown"><div class="eyebrow">OUTCOME BREAKDOWN</div><h2>Resolution mix</h2><div class="breakdown-row"><span><i class="legend-dot"></i>Auto-resolved</span><b>71%</b></div><div class="breakdown-row"><span><i class="legend-dot coral"></i>Human review</span><b>29%</b></div><div class="breakdown-meter"><i></i></div><p>Confidence thresholds keep financial decisions auditable.</p></section></div></div>`},
 settings:{label:'Settings',html:`<div class="page"><div class="eyebrow">WORKSPACE / CONFIGURATION</div><h1 class="page-title">Settings</h1><p class="page-subtitle">Manage sources, thresholds, and notification preferences.</p><section class="card section-card settings-card"><div class="setting-row"><div><strong>Auto-investigate explainable exceptions</strong><span>Allow the agent to assess fee and tax deductions automatically.</span></div><button class="toggle on"><i></i></button></div><div class="setting-row"><div><strong>Human review threshold</strong><span>Escalate cases below the confidence threshold.</span></div><b class="setting-value">85%</b></div><div class="setting-row"><div><strong>Connected sources</strong><span>Razorpay · Shopify Payments</span></div><span class="status green">2 LIVE</span></div></section></div>`}
};
function stat(v,l,m,k,page){return `<div class="metric-item clickable-card" data-page-link="${page}"><div class="metric-value">${v}</div><div class="metric-label">${l}</div><div class="metric-meta ${k}">${m}</div><span class="card-arrow">↗</span></div>`}
function activity(icon,text,kind=''){return `<div class="activity-item ${kind}"><span class="check">${icon}</span>${text}<time>${kind==='arrow'?'Now':'completed'}</time></div>`}
function controllerStep(icon,text,kind){return `<div class="controller-step ${kind}"><i>${icon}</i><span>${text}</span></div>`}
function feed(icon,title,detail,time){return `<div class="feed-row"><i class="${icon==='⚠'?'warn':''}">${icon}</i><div><b>${title}</b><span>${detail}</span></div><time>${time}</time></div>`}
function attention(id,type,amount,severity,confidence,kind){return `<button class="attention-row clickable" data-investigate="${id}"><div class="severity-dot ${kind}"></div><div><b>${id}</b><span>${type}</span></div><strong>${amount}</strong><em class="severity ${kind}">${severity}</em><small>${confidence}</small><span class="row-arrow">→</span></button>`}
function runRow(id,matched,rate){return `<button class="run-row"><span>${id}</span><b>${matched}</b><em>${rate}</em><span>→</span></button>`}
function smartRecord(id,amount,payment,order,settlement,confidence,kind,status){return `<button class="smart-record clickable" data-investigate="${id}" data-record-status="${status}" data-record-missing="${settlement==='Missing'}"><div class="record-main"><b>${id}</b><strong>${amount}</strong><span class="severity ${kind}">${kind==='critical'?'Critical':kind==='high'?'High':'Medium'}</span></div><div class="record-stage"><small>PAYMENT</small><b>${payment}</b></div><div class="record-arrow">→</div><div class="record-stage"><small>ORDER</small><b>${order}</b></div><div class="record-arrow">→</div><div class="record-stage ${settlement==='Missing'?'record-exception':''}"><small>SETTLEMENT</small><b>${settlement}</b></div><div class="record-confidence"><span>AI CONFIDENCE</span><b>${confidence}</b></div><span class="row-arrow">→</span></button>`}
function smartRecordFromData(record){const kind=record.severity==='Critical'?'critical':record.severity==='High'?'high':'medium';return smartRecord(record.id,money(record.payment.amount),record.payment.payment_status,record.order.order_status,record.settlement?money(record.settlement.settlement_amount):'Missing',record.confidence,kind,record.status)}
function auditRow(time,title,detail,kind){return `<div class="audit-row"><time>${time}</time><i class="${kind}">${kind==='warning'?'!':kind==='active'?'◉':'✓'}</i><div><b>${title}</b><span>${detail}</span></div></div>`}
function exceptionTable(id,amount,type,confidence,status,color){return `<tr class="clickable" data-investigate="${id}"><td>${id}</td><td>${amount}</td><td>${type}</td><td><span class="confidence">${confidence}</span></td><td><span class="status ${color}">${status}</span></td><td><button class="row-action">Investigate →</button></td></tr>`}
function reconciliationPage(){const data=window.ledgerPilotData;const examples=[data.records[138],data.records[132],data.records[120]];return `<div class="page"><div class="eyebrow">WORKSPACE / RECORDS</div><div class="workspace-heading"><div><h1 class="page-title">Reconciliation</h1><p class="page-subtitle">Understand every record before it becomes an exception.</p></div><div class="workspace-stat"><strong>${((data.summary.matched / data.summary.total) * 100).toFixed(1)}%</strong><span>matched</span></div></div><section class="card table-card"><div class="section-card"><div class="card-heading"><div><div class="card-title">${data.summary.total} records <span class="status green">RUN COMPLETE</span></div><div class="card-note">Payment → Order → Settlement · select a record for investigation</div></div><div class="toolbar"><input class="filter search-input" placeholder="⌕  Search ID" /><button class="filter active-filter">All</button><button class="filter">Matched</button><button class="filter">Exceptions</button><button class="filter">Missing</button></div></div></div><div class="smart-records">${examples.map(smartRecordFromData).join('')}</div></section></div>`}
function row(id,pay,order,settle,diff,status,color){return `<tr class="clickable" data-transaction="${id}"><td>${id}</td><td>${pay}</td><td>${order}</td><td>${settle}</td><td class="${diff!=='₹0'?'diff':''}">${diff}</td><td><span class="status ${color}">${status}</span></td></tr>`}
function investigationPage(){
  const id=investigationState?.id||'RZP-1022';
  const record=matchedRecords.find(item=>item.id===id);
  const expected=record?record.payment.amount:8200;
  const actual=record?.settlement?record.settlement.settlement_amount:null;
  const difference=record?.difference;
  const title=record?.pattern==='missing_settlement'?'Missing settlement':record?.pattern==='duplicate'?'Duplicate transaction':record?.status==='Matched'?'Matched transaction':'Settlement mismatch';
  const confidence=investigationState?.confidence!=null?`${Math.round((investigationState.confidence>1?investigationState.confidence:investigationState.confidence*100))}%`:(record?.confidence||'96%');
  const assessment=investigationState?.assessment||'“The ₹244 difference is consistent with the expected processing fee and applicable tax.”';
  const evidence=(investigationState?.evidence||[]).slice(0,6);
  const evidenceHtml=evidence.length?evidence.map(item=>`<div><label>${(item.field||'EVIDENCE').toUpperCase()}</label><span>${item.label||item.value}</span></div>`).join(''):`<div><label>PAYMENT ID</label><span>${record?.payment?.payment_id||'pay_RZP1022'}</span></div><div><label>SETTLEMENT ID</label><span>${record?.settlement?.settlement_id||'Missing'}</span></div><div><label>TRANSACTION AMOUNT</label><span>${money(expected)}</span></div><div><label>SETTLEMENT AMOUNT</label><span>${actual==null?'Missing':money(actual)}</span></div>`;
  return `<div class="page"><div class="eyebrow">EXCEPTION / AI REVIEW</div><h1 class="page-title">Exception Investigation</h1><p class="page-subtitle">Evidence-led explanations for every financial exception.</p><div class="investigation-grid"><section class="card case-card"><div class="case-id">EXCEPTION #${id}</div><h2 class="case-title">${title}</h2><div class="amount-grid"><div class="amount"><label>EXPECTED</label><b>${money(expected)}</b></div><div class="amount"><label>ACTUAL</label><b>${actual==null?'Missing':money(actual)}</b></div><div class="amount negative"><label>DIFFERENCE</label><b>${difference==null?'—':money(Math.abs(difference))}</b></div></div><div class="step-list">${activity('✓','Transaction identified')}${activity('✓','Settlement record located')}${activity('✓','Payment reference verified')}${activity('✓','Fee structure checked')}${activity('✓','Difference calculated')}</div></section><section class="card ai-card"><div class="ai-kicker">AI ASSESSMENT</div><div class="assessment">“${assessment.replace(/^“|”$/g,'')}”</div><div class="confidence"><span>CONFIDENCE</span><strong>${confidence}</strong><div class="progress"><i></i></div></div><div class="evidence">${evidenceHtml}</div><div class="action-label">RECOMMENDED ACTION</div><div class="recommend"><i></i>${investigationState?.recommended_action||'Mark as legitimate deduction'}</div><div class="button-row"><button class="btn btn-primary" id="resolve-btn">Resolve Exception</button><button class="btn btn-secondary" id="escalate-btn">Escalate to Finance</button></div></section></div></div>`}
function exceptionsPage(){return `<div class="page"><div class="eyebrow">WORKSPACE / ATTENTION QUEUE</div><h1 class="page-title">Exception Center</h1><p class="page-subtitle">Prioritize anomalies and move the queue toward resolution.</p><div class="summary">${summary('7','Open','exceptions')}${summary('1','Critical','exceptions')}${summary('3','Needs Review','exceptions')}${summary('3','Explainable','exceptions')}</div><div class="exception-toolbar"><span>7 exceptions</span><button class="filter">Sort: Severity⌄</button><button class="filter">All types⌄</button><button class="filter">All statuses⌄</button></div><div class="exception-cards">${exceptionCard('RZP-1047','Missing settlement','₹12,500','Payment was successfully captured, but no corresponding settlement record was found.','91%','orange')}${exceptionCard('RZP-1031','Settlement mismatch','₹550','Settlement is lower than the expected value after an unrecognized adjustment.','84%','yellow')}${exceptionCard('RZP-1018','Duplicate payment','₹1,800','Two payment captures reference the same order within a 30 second window.','97%','green')}</div></div>`}
function summary(v,l,page){return `<div class="card summary-card clickable-card" data-page-link="${page}"><strong>${v}</strong><span>${l}</span><span class="card-arrow">↗</span></div>`}
function exceptionCard(id,issue,price,desc,confidence,color,state){const stateLabel=state==='on_hold'?'ON HOLD':state==='escalated'?'ESCALATED':state==='approved'?'APPROVED':state==='resolved'?'RESOLVED':color==='orange'?'OPEN':'REVIEW';return `<div class="card exception-card"><div class="card-top"><span class="status ${state==='on_hold'||state==='escalated'?'orange':'green'}">${stateLabel}</span></div><h3>${id}</h3><div class="issue">${issue}</div><div class="price">${price}</div><p>AI Assessment: ${desc}</p><div class="confidence-line"><span>CONFIDENCE</span><b>${confidence}</b></div><div class="exception-actions"><button class="btn btn-secondary investigate-btn" data-investigate="${id}">Investigate →</button><button class="btn btn-secondary hold-exception" data-exception-id="${id}" ${state==='on_hold'?'disabled':''}>${state==='on_hold'?'On Hold':'Hold'}</button><button class="btn btn-primary resolve-exception" data-exception-id="${id}">Resolve</button></div></div>`}
function overviewCard(record){const kind=record.status==='Matched'?'matched':record.status==='Needs Review'?'fuzzy':'exception';const label=record.status==='Matched'?'MATCHED':record.status==='Needs Review'?'NEEDS REVIEW':record.severity.toUpperCase();const issue=record.status==='Matched'?'Payment · Order · Settlement verified':record.pattern==='missing_settlement'?'Missing settlement':record.pattern==='duplicate'?'Duplicate transaction':record.pattern==='fuzzy'?'Customer reference similar':'Amount mismatch';return `<button class="data-card ${kind}" data-investigate="${record.id}"><div class="data-card-top"><span class="card-type">${kind==='matched'?'TRANSACTION':kind==='fuzzy'?'FUZZY MATCH':'EXCEPTION'}</span><span class="status ${kind==='matched'?'green':kind==='fuzzy'?'yellow':'orange'}">${label}</span></div><b class="data-card-id">${record.id}</b><strong class="data-card-amount">${money(record.payment.amount)}</strong><span class="data-card-issue">${issue}</span><div class="data-card-foot"><span>${record.status==='Matched'?'Payment ✓ · Order ✓ · Settlement ✓':`${record.confidence} confidence`}</span><em>Investigate →</em></div></button>`}
function agentsChips(){const agents=workspaceState.agents.length?workspaceState.agents:['controller','reconciliation','investigation','pattern','resolution'].map(a=>({id:a,name:a[0].toUpperCase()+a.slice(1)}));return agents.map(a=>`<span class="agent-chip"><i></i>${a.name}</span>`).join('')}
function overviewPage(){const data=window.ledgerPilotData;const metrics=dashboardMetrics();const open=data.summary.open??data.summary.exceptions;const records=data.records.filter(r=>r.resolution!=='resolve');const cards=[...records.filter(r=>r.status==='Exception').slice(0,3),...records.filter(r=>r.status==='Matched').slice(0,2)].map(overviewCard).join('');const matched=data.summary.matched;const total=data.summary.total;const rate=((matched/total)*100).toFixed(1);const recentEvents=workspaceState.activity.slice(0,4);const recentExceptions=records.filter(r=>r.status!=='Matched').slice(0,4);const recentRuns=workspaceState.runs.slice(0,3);
const capturedStr=moneyShort(metrics.captured);
const settledStr=moneyShort(metrics.settled);
const exceptionValue=moneyShort(Math.max(0,metrics.captured-metrics.settled));
const coveragePct=metrics.coverage;
const heldValue=moneyShort(data.records.filter(r=>r.resolution==='hold').reduce((s,r)=>s+(r.payment?.amount||0),0));
const prevRate=workspaceState.runs.length>1?(workspaceState.runs[1]?.summary?.matchRate??null):null;
const rateDelta=prevRate!=null?(rate-prevRate).toFixed(1):null;
const rateTrend=rateDelta==null?'↑ 2.1% from last run':rateDelta>=0?`↑ +${rateDelta}% from last run`:`↓ ${Math.abs(rateDelta)}% from last run`;
return `<div class="page overview-page"><div class="hero-kicker">CLARIO / FINANCE CONTROL CENTER <span>${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span></div><div class="compact-hero"><div><div class="eyebrow">FINANCE CONTROL CENTER</div><h1>Your finances,<br><em>in sync.</em></h1><p>${total} records · ${rate}% match rate · ${open} exceptions</p></div><div class="compact-ai"><span class="ai-orb">✦</span><div><b>AI CONTROLLER</b><span>● Active · ${open} exceptions in focus</span></div></div><button class="hero-cta" id="hero-run">Run Reconciliation <b>→</b></button></div><div class="ask-clario-wrap"><form class="ask-clario-bar" id="overview-ask"><span class="ai-orb">✦</span><input id="overview-ask-input" placeholder="Ask Clario anything… 'what needs my attention?', 'why did the match rate drop?', 'show critical exceptions'" autocomplete="off"/><button type="submit">Ask <b>→</b></button></form><div class="agents-strip"><span>AI agents online</span>${agentsChips()}</div></div><section class="compact-summary"><div class="health-summary"><strong>${rate}%</strong><span>Reconciliation Health</span><em>${rateTrend}</em><i><b style="width:${rate}%"></b></i></div><div><strong>${settledStr}</strong><span>Value Reconciled</span><em>${coveragePct}% settlement coverage</em></div><div><strong>${open}</strong><span>Open Exceptions</span><em class="summary-alert">Needs attention</em></div><div><strong>${matched} / ${total}</strong><span>Records Matched</span><em>Current run</em></div></section><section class="data-card-section"><div class="section-head"><div><div class="eyebrow">LIVE OPERATIONS</div><h2>Live Reconciliation</h2></div><button data-page-link="reconciliation">View all records →</button></div><div class="data-card-grid">${cards}<div class="data-card insight-card"><div class="data-card-top"><span class="card-type">AI INSIGHT</span><span class="status green">PATTERN DETECTED</span></div><b class="insight-title">Recurring pattern detected</b><strong class="insight-amount">${data.records.filter(r=>r.difference===244).length} transactions</strong><span class="data-card-issue">₹244 common variance</span><div class="data-card-foot"><span>Fee-related exception cluster</span><em>Review pattern →</em></div></div></div></section><section class="health-modules"><div class="health-module health-ring-card"><div class="eyebrow">RECONCILIATION HEALTH</div><div class="health-ring-visual"><div><strong>${rate}%</strong><span>HEALTHY</span></div></div><div class="health-details"><b>${matched} matched</b><b>${data.summary.exceptions} exceptions</b><b>${data.summary.fuzzy} under review</b></div><span class="health-trend">${rateTrend}</span></div><div class="health-module value-module"><div class="eyebrow">VALUE RECONCILED</div><strong class="value-total">${settledStr}</strong><div class="value-track"><i></i></div><div class="value-footer"><span>${capturedStr} captured</span><b>${coveragePct}% coverage</b></div><div class="coverage-signal"><div class="coverage-heading"><span>SETTLEMENT COVERAGE</span><b>${coveragePct}%</b></div><div class="coverage-blocks"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><small>${heldValue} held in exception review</small></div></div></section><section class="money-flow-panel card"><div class="section-head"><div><div class="eyebrow">MONEY FLOW</div><h2>Where value moved</h2></div><span class="card-note">CURRENT RUN</span></div><div class="money-flow"><div><small>CAPTURED</small><b>${capturedStr}</b></div><i>↓</i><div><small>ORDERED</small><b>${moneyShort(data.records.reduce((s,r)=>s+(r.order?.order_amount||0),0))}</b></div><i>↓</i><div class="money-settled"><small>SETTLED</small><b>${settledStr}</b></div><i>↓</i><div class="money-exception"><small>EXCEPTIONS</small><b>${exceptionValue}</b></div></div></section><div class="cockpit-grid"><section class="flow-panel"><div class="section-intro"><div><div class="eyebrow">SIGNATURE SYSTEM</div><h2>Reconciliation Flow</h2><p>From payments to a perfectly reconciled record.</p></div><span class="flow-note">AI cross-checks data across all sources</span></div><div class="flow-map"><div class="flow-node"><span class="node-icon">↗</span><small>PAYMENTS</small><b>${total}</b><em>records</em></div><div class="flow-line"><i></i><span>normalized</span></div><div class="flow-node"><span class="node-icon">◫</span><small>ORDERS</small><b>${total}</b><em>verified</em></div><div class="flow-line"><i></i><span>matched</span></div><div class="flow-node success-node"><span class="node-icon">✓</span><small>SETTLEMENTS</small><b>${matched}</b><em>matched</em></div><div class="exception-branch"><div class="branch-line"></div><div class="flow-node exception-node"><span class="node-icon">!</span><small>EXCEPTIONS</small><b>${data.summary.exceptions}</b><em>detected</em></div></div></div><div class="flow-footer"><span><i class="legend-dot"></i>Exact match</span><span><i class="legend-dot coral"></i>Needs investigation</span><button data-page-link="reconciliation">Explore all records →</button></div></section><section class="controller-panel"><div class="controller-top"><div><div class="eyebrow">AI CONTROLLER</div><h2>Operational intelligence</h2></div><span class="live-pill"><i></i> ACTIVE</span></div><div class="controller-task"><small>CURRENT TASK</small><b>${recentEvents[0]?.title||'Ready'}</b><span>${recentEvents[0]?.detail||'Awaiting reconciliation run'}</span></div><div class="controller-steps">${controllerStep('✓','Payment records loaded','done')}${controllerStep('✓','Settlement matching complete','done')}${controllerStep(open>0?'◉':'✓',open>0?`${open} exceptions flagged`:'All exceptions resolved',open>0?'current':'done')}${controllerStep('○','Preparing AI recommendations','')}${controllerStep('○','Audit trail updated','')}</div><p class="controller-foot">Finding the why behind every mismatch.</p></section></div><div class="lower-grid"><section class="activity-panel"><div class="section-head"><div><div class="eyebrow">LIVE LOG</div><h2>Recent Activity</h2></div><button data-page-link="activity">View all →</button></div><div class="activity-feed">${recentEvents.length?recentEvents.map(e=>`<div class="feed-row"><i class="${e.kind==='warning'?'warn':''}">${e.kind==='warning'?'⚠':e.kind==='active'?'◉':'✓'}</i><div><b>${e.title}</b><span>${e.detail||''}</span></div><time>${new Date(e.time||Date.now()).toLocaleTimeString()}</time></div>`).join(''):feed('✓','No activity yet','Run reconciliation to start','—')}</div></section><section class="attention-panel"><div class="section-head"><div><div class="eyebrow">REVIEW QUEUE</div><h2>Exceptions needing attention</h2></div><button data-page-link="exceptions">See all →</button></div><div class="exception-feed">${recentExceptions.length?recentExceptions.map(r=>attention(r.id,r.pattern==='missing_settlement'?'Missing settlement':r.pattern==='duplicate'?'Duplicate transaction':'Amount mismatch',money(r.payment.amount),r.severity||'Medium',r.confidence||'—',r.severity==='Critical'?'critical':r.severity==='High'?'high':'medium')).join(''):attention('—','No open exceptions','—','—','—','medium')}</div></section></div><section class="runs-panel"><div class="section-head"><div><div class="eyebrow">HISTORY</div><h2>Recent Runs</h2></div><button data-page-link="reports">Run history →</button></div><div class="run-list">${recentRuns.length?recentRuns.map(r=>runRow(r.runId,`${r.summary?.matched??'—'} / ${r.summary?.total??'—'} matched`,`${r.summary?.matchRate??'—'}%`)).join(''):runRow('No runs yet','—','—')}</div></section><section class="card section-card page-links-card"><div class="section-head"><div><div class="eyebrow">WORKSPACE</div><h2>Navigate Clario</h2></div></div><div class="page-links">${[
  ['reconciliation','≡','Reconciliation','Reconcile payments, orders and settlements over time'],
  ['transactions','▦','Transactions','Browse and search every financial record'],
  ['exceptions','△','Exception Center','Exception Center with ' + open + ' open cases'],
  ['activity','✦','AI Activity','Review what Clario has processed and why'],
  ['audit','◎','Audit Trail','Every action and decision, logged for control'],
  ['reports','◫','Reports','Operational summaries and resolution mix'],
  ['settings','⚙','Settings','Manage sources, thresholds and preferences']
].map(([p,icon,label,desc])=>`<button class="page-link-card" data-page-link="${p}"><span class="page-link-icon">${icon}</span><div><b>${label}</b><small>${desc}</small></div><span class="row-arrow">→</span></button>`).join('')}</div></section></div>`}
function liveExceptionsPage(){const data=window.ledgerPilotData;const records=data.records.filter(r=>r.status!=='Matched'&&r.resolution!=='resolve');return `<div class="page"><div class="eyebrow">WORKSPACE / ATTENTION QUEUE</div><h1 class="page-title">Exception Center</h1><p class="page-subtitle">Prioritize anomalies and move the queue toward resolution.</p><div class="summary">${summary(String(records.length),'Open','exceptions')}${summary(String(records.filter(r=>r.severity==='Critical').length),'Critical','exceptions')}${summary(String(records.filter(r=>r.status==='Needs Review').length),'Needs Review','exceptions')}${summary(String(records.filter(r=>r.confidence.replace('%','')>=90).length),'Explainable','exceptions')}</div><div class="exception-toolbar"><span>${records.length} exceptions</span><button class="filter">Sort: Severity⌄</button><button class="filter">All types⌄</button><button class="filter">All statuses⌄</button></div><div class="exception-cards">${records.slice(0,6).map(record=>exceptionCard(record.id,record.pattern==='missing_settlement'?'Missing settlement':record.pattern==='duplicate'?'Duplicate transaction':record.pattern==='fuzzy'?'Fuzzy match':'Amount mismatch',money(record.payment.amount),record.reasons[0]||'Review transaction evidence.',record.confidence,record.severity==='Critical'?'orange':record.status==='Needs Review'?'yellow':'green',record.state)).join('')}</div><section class="card exception-ask-card"><div><div class="eyebrow">CONTEXTUAL AI</div><h2>Ask about this queue</h2><p>Use a transaction card to open its full investigation, or ask Clario which exception needs attention first.</p></div><button class="btn btn-secondary" id="exception-ask">Ask Clario</button></section></div>`}
function activityChecklist(event){const text=`${event.title}: ${event.detail||''}`.trim();const id=(text.match(/RZP-\d+/i)||[])[0]||'';return `<div class="activity-check ${event.kind==='warning'?'warn':''}"><label><input type="checkbox" ${event.kind==='done'?'checked':''} /><span class="check-mark">${event.kind==='warning'?'!':event.kind==='active'?'◉':'✓'}</span><span class="activity-copy"><b>${event.title}</b><small>${event.detail||'Clario controller event'}</small></span><time>${new Date(event.time||Date.now()).toLocaleTimeString()}</time></label><div class="activity-actions"><button class="activity-ask" data-ask="${text}">Ask Clario</button>${id?`<button class="activity-investigate" data-investigate="${id}">Investigate</button>`:''}<button class="activity-report" data-report="${text}">Report</button></div></div>`}
function liveAuditPage(){const events=workspaceState.audit;const rows=(events.length?events:[{time:new Date().toISOString(),title:'No events yet',detail:'Run reconciliation to create an audit trail.',kind:'active'}]).map(event=>`<div class="audit-row" data-title="${String((event.title||'')+' '+(event.detail||'')).replace(/"/g,'&quot;')}" data-kind="${event.kind||'done'}"><time>${new Date(event.time).toLocaleTimeString()}</time><i class="${event.kind||'done'}">${(event.kind||'done')==='warning'?'!':(event.kind||'done')==='active'?'◉':'✓'}</i><div><b>${event.title}</b><span>${event.detail||''}</span></div></div>`).join('');return `<div class="page"><div class="eyebrow">INSIGHTS / CONTROL LOG</div><h1 class="page-title">Audit Trail</h1><p class="page-subtitle">Every agent action, evidence source, and finance decision in one place.</p><section class="card section-card audit-card"><div class="card-heading"><div><div class="card-title">Control log <span id="audit-count" class="audit-count">${events.length} events</span></div><div class="card-note">Filter by kind or search the log</div></div><button id="audit-export" class="btn btn-secondary">Export CSV</button></div><div class="audit-toolbar"><input id="audit-search" class="filter search-input" placeholder="Search title or detail..." /><button class="filter audit-filter active-filter" data-kind="all">All</button><button class="filter audit-filter" data-kind="done">Done</button><button class="filter audit-filter" data-kind="warn">Warnings</button><button class="filter audit-filter" data-kind="active">Active</button></div><div class="audit-panel" id="audit-events">${rows}</div></section></div>`}
function liveActivityPage(){const events=workspaceState.activity.length?workspaceState.activity:workspaceState.audit;const agents=workspaceState.agents;const agentCards=agents.map(a=>`<div class="agent-card"><span class="agent-dot"></span><div><b>${a.name}</b><small>${a.role}</small></div><strong>${a.executions||0} runs</strong><em>${a.lastAt?new Date(a.lastAt).toLocaleTimeString():'idle'}</em></div>`).join('');return `<div class="page"><div class="eyebrow">WORKSPACE / AUTOMATION</div><h1 class="page-title">AI Agent Activity</h1><p class="page-subtitle">Check off completed work, ask Clario about an event, investigate a record, or generate a report.</p>${agentCards?`<div class="agents-grid"><div class="agents-heading"><div class="eyebrow">AGENTS ONLINE</div><h2>Clario agent fleet</h2></div>${agentCards}</div>`:''}<section class="card section-card"><div class="card-heading"><div><div class="card-title">Live Clario activity</div><div class="card-note">${events.length} auditable events · Mistral controller connected when configured</div></div><span class="status green">CONNECTED</span></div><div class="activity-checklist">${(events.length?events:[{title:'No agent activity yet',detail:'Run reconciliation to start the controller.',kind:'active'}]).map(activityChecklist).join('')}</div></section></div>`}
function liveSettingsPage(){const s=workspaceState.settings||{rules:{},ai:{},notifications:{}};const n=(label,desc,group,key,suffix='')=>`<div class="setting-row"><div><strong>${label}</strong><span>${desc}</span></div><div class="setting-input"><input type="number" data-number="${group}.${key}" value="${s[group]?.[key]??''}" /><em>${suffix}</em></div></div>`;const t=(label,desc,group,key)=>`<div class="setting-row"><div><strong>${label}</strong><span>${desc}</span></div><button class="toggle ${s[group]?.[key]?'on':''}" data-toggle="${group}.${key}" aria-pressed="${s[group]?.[key]||false}"><i></i></button></div>`;return `<div class="page"><div class="eyebrow">WORKSPACE / CONFIGURATION</div><h1 class="page-title">Settings</h1><p class="page-subtitle">Manage reconciliation rules, AI policies and notifications.</p><section class="card section-card settings-card"><div class="settings-heading"><div class="eyebrow">RECONCILIATION RULES</div><h2>Matching thresholds</h2></div>${n('Amount tolerance','Max accepted variance between payment and settlement','rules','amountTolerance','₹')}${n('Timestamp tolerance','Max clock drift for fuzzy matches','rules','timestampToleranceMinutes','min')}${n('Fuzzy match threshold','Similarity score that still counts as a match','rules','fuzzyMatchThreshold','%')}${n('Auto-resolution threshold','Minimum confidence for automatic resolution','rules','autoResolutionThreshold','%')}</section><section class="card section-card settings-card"><div class="settings-heading"><div class="eyebrow">AI CONTROLLER</div><h2>Agent policies</h2></div>${t('AI investigation','Let the agent run evidence-based investigations','ai','investigation')}${t('Pattern detection','Monitor recurring exceptions across runs','ai','patternDetection')}${t('Auto-resolution','Resolve high-confidence exceptions without human approval','ai','autoResolution')}${t('Human approval','Require a finance user to approve escalations','ai','humanApproval')}</section><section class="card section-card settings-card"><div class="settings-heading"><div class="eyebrow">NOTIFICATIONS</div><h2>Alerts</h2></div>${t('Critical exceptions','Notify when a critical exception is detected','notifications','critical')}${t('Failed reconciliation','Notify when a run fails','notifications','failedReconciliation')}${t('Recurring patterns','Notify when a pattern repeats','notifications','recurringPatterns')}${t('Daily report','Email the daily operational report','notifications','dailyReport')}</section><section class="card section-card settings-card"><div class="settings-heading"><div class="eyebrow">SECURITY & STATUS</div><h2>Session and services</h2></div><div class="setting-row static-row"><div><strong>Session</strong><span>Demo session · ${localStorage.getItem(TOKEN_KEY)?'authenticated':'anonymous'}</span></div><span class="status green">ACTIVE</span></div><div class="setting-row static-row"><div><strong>Role</strong><span>Finance admin</span></div><span class="status green">FULL</span></div><div class="setting-row static-row"><div><strong>Database</strong><span>${workspaceState.health?.database==='connected'?'MongoDB connected':'Process-local demo state'}</span></div><span class="status ${workspaceState.health?.database==='connected'?'green':'yellow'}">${workspaceState.health?.database||'demo'}</span></div><div class="setting-row static-row"><div><strong>AI provider</strong><span>${workspaceState.health?.mistral?'Mistral connected':'Deterministic fallback (no API key)'}</span></div><span class="status ${workspaceState.health?.mistral?'green':'yellow'}">${workspaceState.health?.mistral?'LIVE':'FALLBACK'}</span></div></section></div>`}
function liveReportsPage(){
  const fallback=window.ledgerPilotData.summary;
  const r=workspaceState.reports||{};
  const metrics=r.metrics||{matchRate:`${((fallback.matched/fallback.total)*100).toFixed(1)}%`,autoResolutionRate:'0%',recoveredValue:'₹0',openExceptions:fallback.open??fallback.exceptions};
  const prev=r.comparison?.previous,curr=r.comparison?.current;
  const delta=(prev&&curr)?(curr.matchRate-prev.matchRate):null;
  const strDelta=delta==null?'—':`${delta>=0?'↑ +':'↓ '}${Math.abs(delta).toFixed(1)}%`;
  const aging=r.aging||{};
  const agingOrder=['< 24 hours','1-3 days','3-7 days','7+ days'];
  const agingMax=Math.max(...agingOrder.map(t=>aging[t]||0),1);
  const agingRows=agingOrder.filter(t=>aging[t]).map(t=>`<div class="aging-row"><span>${t}</span><i><b style="width:${Math.round((aging[t]||0)/agingMax*100)}%"></b></i><strong>${aging[t]}</strong></div>`).join('');
  const severity=r.severity||{};
  const severityRows=(['Critical','High','Medium'].filter(s=>severity[s])).map(s=>`<div class="breakdown-row"><span><i class="legend-dot ${s==='Critical'?'coral':s==='High'?'orange':'yellow'}"></i>${s}</span><b>${severity[s]}</b></div>`).join('');
  const types=Object.entries(r.byType||{});
  const typeRows=types.map(([key,val])=>`<div class="type-row"><span><i class="legend-dot"></i>${key.replace(/_/g,' ')}</span><b>${val.count}</b><em>${money(val.impact||0)}</em></div>`).join('');
  const status=r.statusBreakdown||{};
  const statusRows=[['Open',status.open],['Auto-resolved',status.resolved],['Escalated',status.escalated],['On hold',status.onHold]].map(([label,val])=>`<div class="breakdown-row"><span><i class="legend-dot"></i>${label}</span><b>${val}</b></div>`).join('');
  const recurringRows=(r.recurring||[]).slice(0,4).map(p=>`<div class="recurring-row"><div class="recurring-head"><b>${p.pattern.replace(/_/g,' ')}</b><span>${p.count} occurrences</span></div><i><b style="width:${Math.min(100,p.count*14)}%"></b></i></div>`).join('');
  const rz=r.risk||{};const rStats=rz.stats||{};
  const riskTiers=[['High',rStats.high||0,'#ff571a'],['Medium',rStats.medium||0,'#ff8a3d'],['Low',rStats.low||0,'#27b87c']];
  const riskMax=Math.max(...riskTiers.map(t=>t[1]),1);
  const riskBreakdownRows=riskTiers.map(([label,val,color])=>`<div class="risk-tier-row"><span>${label}</span><i><b style="width:${Math.round(val/riskMax*100)}%;background:${color}"></b></i><strong>${val}</strong></div>`).join('');
  const riskSignalRows=(rz.topSignals||[]).map(s=>`<div class="risk-signal-row"><i class="legend-dot"></i><b>${s.label}</b><strong>${s.count}</strong></div>`).join('');
  const trend=rz.trend||[];
  const trendMax=Math.max(...trend.flatMap(t=>[t.high||0,t.medium||0]),1);
  const trendBars=trend.map(t=>`<div class="trend-col"><span>${t.high||0}<em>h</em>/${t.medium||0}<em>m</em></span><div class="trend-bars"><i style="height:${Math.round((t.high||0)/trendMax*100)}%"></i><b style="height:${Math.round((t.medium||0)/trendMax*100)}%"></b></div><small>${t.week}</small></div>`).join('');
  const root=rz.rootCause;
  const rootHtml=root?`<div class="root-cause"><div class="root-cause-pct">${root.share??root.pct}%</div><p>of flagged cases are tied to <b>${root.pattern}</b> — ${root.count} occurrences.</p><div class="root-cause-meta"><span>Financial impact <b>${money(root.financial_impact||0)}</b></span></div><p>${root.advice}</p><em class="root-cause-rec">Recommendation: ${root.recommendation}</em></div>`:'<p>No root cause identified yet.</p>';
  const flaggedRows=(rz.flagged||[]).map(f=>`<tr class="clickable" data-investigate="${f.id}"><td><b>${f.id}</b></td><td><span class="risk-badge ${f.tier.toLowerCase()}">${f.score}</span></td><td><span class="status ${f.tier==='High'?'orange':f.tier==='Medium'?'yellow':'green'}">${f.tier}</span></td><td>${f.reason}</td><td>${money(f.impact)}</td><td><span class="status ${f.action==='Hold'?'orange':'green'}">${f.action}</span></td><td><button class="row-action">Open →</button></td></tr>`).join('');
  return `<div class="page reports-page"><div class="eyebrow">WORKSPACE / INSIGHTS</div><h1 class="page-title">Reports</h1><p class="page-subtitle">Operational summaries built from your reconciliation history.</p><div class="metric-strip">${stat(money(metrics.reconciledValue||0),'Reconciled Value','Matched payment value','','reports')}${stat(`${metrics.matchRate??0}%`,'Match Rate','Current run','','reports')}${stat(String(metrics.openExceptions??metrics.exceptions??0),'Total Exceptions','Needs attention','','exceptions')}${stat(money(metrics.atRiskValue||0),'At Risk Value','High + medium cases','','reports')}</div><section class="card section-card report-compare"><div class="section-head"><div><div class="eyebrow">RUN COMPARISON</div><h2>This run vs previous</h2></div><span class="status ${delta>=0?'green':'orange'}">${strDelta} match rate</span></div><table class="compare-table"><thead><tr><th></th><th>Previous run</th><th>Current run</th></tr></thead><tbody><tr><td>Records</td><td>${prev?.total??'—'}</td><td>${curr?.total??'—'}</td></tr><tr><td>Matched</td><td>${prev?.matched??'—'}</td><td>${curr?.matched??'—'}</td></tr><tr><td>Exceptions</td><td>${prev?.exceptions??'—'}</td><td>${curr?.exceptions??'—'}</td></tr><tr class="highlight"><td>Match rate</td><td>${prev?.matchRate!=null?prev.matchRate+'%':'—'}</td><td><b>${curr?.matchRate!=null?curr.matchRate+'%':'—'}</b></td></tr></tbody></table></section><section class="card section-card risk-center"><div class="section-head"><div><div class="eyebrow">FRAUD / RISK INTELLIGENCE</div><h2>Financial control layer</h2></div><span class="status ${rStats.high>0?'orange':'green'}">${rStats.high>0?`${rStats.high} HIGH RISK`:'RISK CLEAR'}</span></div><div class="risk-metrics">${stat(String(rStats.high||0),'High Risk','From risk engine','','exceptions')}${stat(money(rStats.atRiskValue||0),'At Risk Value','High + medium cases','','reports')}${stat(String(rStats.holds||0),'On Hold','Transactions blocked','','reports')}${stat(String(rStats.medium||0),'Medium Risk','Needs finance review','','reports')}</div><div class="risk-grid"><section class="risk-block"><div class="eyebrow">RISK BREAKDOWN</div>${riskBreakdownRows}</section><section class="risk-block"><div class="eyebrow">TOP RISK SIGNALS</div>${riskSignalRows||'<p class="muted">No material risk signals.</p>'}</section><section class="risk-block"><div class="eyebrow">RISK TREND</div><div class="trend-chart">${trendBars}</div><p class="risk-trend-note">High/medium per reconciliation run · stored risk snapshots</p></section><section class="risk-block"><div class="eyebrow">ROOT CAUSE INSIGHT</div>${rootHtml}</section></div></section><section class="card section-card flagged-card"><div class="section-head"><div><div class="eyebrow">FLAGGED TRANSACTIONS</div><h2>Risk cases awaiting action</h2></div><span class="card-note">${rz.flaggedTotal||0} flagged · click a row to open its AI case report</span></div><table class="flagged-table"><thead><tr><th>Transaction</th><th>Risk</th><th>Tier</th><th>Reason</th><th>Impact</th><th>Action</th><th></th></tr></thead><tbody>${flaggedRows||'<tr><td colspan="7" class="muted">No flagged transactions right now.</td></tr>'}</tbody></table></section><div class="reports-grid reports-grid-full"><section class="card section-card report-breakdown"><div class="eyebrow">EXCEPTION ANALYSIS</div><h2>By severity</h2>${severityRows||'<p>No open exceptions.</p>'}</section><section class="card section-card report-breakdown"><div class="eyebrow">EXCEPTION AGING</div><h2>How long open</h2>${agingRows||'<p>No open exceptions.</p>'}</section><section class="card section-card report-breakdown"><div class="eyebrow">FINANCIAL IMPACT</div><h2>By exception type</h2>${typeRows||'<p>No open exceptions.</p>'}</section><section class="card section-card report-breakdown"><div class="eyebrow">STATUS MIX</div><h2>Resolution status</h2>${statusRows}</section></div><section class="card section-card report-recurring"><div class="eyebrow">RECURRING PATTERNS</div><h2>What repeats across runs</h2>${recurringRows||'<p>No recurring patterns yet.</p>'}</section><section class="card investigation-chat-card report-chat-card"><div class="inv-chat-head"><div><div class="eyebrow">REPORT ANALYST</div><h2>Ask about this report</h2></div><span class="status green">EVIDENCE-BACKED</span></div>  <div class="report-quick-prompts"><button class="report-prompt" data-prompt="Why did high-risk transactions increase?">Why did high-risk increase?</button><button class="report-prompt" data-prompt="Which issue has the biggest financial impact?">Biggest impact?</button><button class="report-prompt" data-prompt="What should I investigate first?">Investigate first</button></div><div class="inv-chat-messages" id="report-chat-messages"><div class="chat-msg assistant"><div class="chat-bubble">I can explain this report. Ask why the match rate moved, which exception type costs the most, or how this run compares with the previous one.</div></div></div><div class="chat-composer inv-chat-composer"><input id="report-chat-input" placeholder="Ask the analyst..." autocomplete="off"/><button id="report-chat-send">Ask</button></div></section></div>`
}
function liveReportsPageOld(){const fallback=window.ledgerPilotData.summary;const metrics=workspaceState.reports?.metrics||{matchRate:`${((fallback.matched/fallback.total)*100).toFixed(1)}%`,autoResolutionRate:'0%',recoveredValue:'₹0',openExceptions:fallback.open??fallback.exceptions};return `<div class="page reports-page"><div class="eyebrow">WORKSPACE / INSIGHTS</div><h1 class="page-title">Reports</h1><p class="page-subtitle">Operational summaries built from your reconciliation history.</p><div class="metric-strip">${stat(money(metrics.reconciledValue||0),'Reconciled Value','Matched payment value','','reports')}${stat(`${metrics.matchRate??0}%`,'Match Rate','Current run','','reports')}${stat(String(metrics.openExceptions??metrics.exceptions??0),'Total Exceptions','Needs attention','','exceptions')}${stat(money(metrics.atRiskValue||0),'At Risk Value','High + medium cases','','reports')}</div><div class="reports-grid"><section class="card section-card report-breakdown"><div class="eyebrow">LIVE REPORT</div><h2>Resolution overview</h2><div class="breakdown-row"><span><i class="legend-dot"></i>Match rate</span><b>${metrics.matchRate}</b></div><div class="breakdown-row"><span><i class="legend-dot coral"></i>Open exceptions</span><b>${metrics.openExceptions}</b></div><p>Metrics refresh from the reconciliation API after every action.</p></section></div></div>`}
function liveReconciliationPage(){const data=window.ledgerPilotData;const records=matchedRecords;return `<div class="page"><div class="eyebrow">WORKSPACE / RECORDS</div><div class="workspace-heading"><div><h1 class="page-title">Reconciliation</h1><p class="page-subtitle">Understand every record before it becomes an exception.</p></div><div class="workspace-stat"><strong>${((data.summary.matched / data.summary.total) * 100).toFixed(1)}%</strong><span>matched</span></div></div><section class="card table-card"><div class="section-card"><div class="card-heading"><div><div class="card-title">${data.summary.total} records <span class="status green">RUN COMPLETE</span></div><div class="card-note">Payment → Order → Settlement · select a record for investigation</div></div><div class="toolbar"><input class="filter search-input" placeholder="⌕  Search ID" /><button class="filter active-filter">All</button><button class="filter">Matched</button><button class="filter">Exceptions</button><button class="filter">Missing</button></div></div></div><div class="smart-records">${records.map(smartRecordFromData).join('')}</div></section></div>`}
function liveInvestigationPage(){
  if (!investigationState) return `<div class="page"><h2>No active investigation</h2></div>`;
  const record = matchedRecords.find(item => item.id === investigationState.id);
  if (!record) return `<div class="page"><h2>Transaction unavailable</h2><p class="page-subtitle">Refresh the reconciliation data and try again.</p></div>`;
  const riskM=record.risk||{score:0,tier:'Low',signals:[],recommendation:'continue'};
  const riskRingClass=riskM.tier==='High'?'high':riskM.tier==='Medium'?'medium':'low';
  const riskSigHtml=(riskM.signals||[]).map(s=>`<div class="risk-signal"><span class="${s.kind==='critical'?'sig-crit':s.kind==='risk'?'sig-risk':'sig-info'}">${s.kind==='critical'?'!':s.kind==='risk'?'+':'·'}</span><div><b>${s.label}</b><small>${s.detail}</small></div><em>+${s.points}</em></div>`).join('');
  const humanAction=record.resolution||null;
  const humanLabel=humanAction==='hold'?'On hold':humanAction==='escalate'?'Escalated':humanAction==='approve'?'Approved':humanAction==='resolve'?'Resolved':null;
  const diff = record.difference !== null ? money(Math.abs(record.difference)) : '—';
  const scoreRows=(riskM.breakdown||[]).map(b=>`<div class="risk-break-row"><span>${b.label}</span><em>${b.points?`+${b.points}`:'0'}</em></div>`).join('');
  const assessment=investigationState.assessment||investigationState.reason||'The deterministic risk engine has evaluated settlement, duplicate, timing and historical signals.';
  const recommendation=riskM.recommendation==='hold'?'Place on hold':riskM.recommendation==='review'?'Human review':'Continue processing';
  return `<div class="page"><div class="eyebrow">EXCEPTION / AI REVIEW</div><h1 class="page-title">Exception Investigation</h1><p class="page-subtitle">Evidence-led explanations with deterministic risk scoring — never a fraud probability.</p><div class="investigation-grid investigation-grid-refined"><section class="card case-card case-card-refined"><div class="case-card-head"><div><div class="case-id">EXCEPTION #${record.id}</div><h2 class="case-title">${record.pattern==='missing_settlement'?'Missing settlement':record.pattern==='duplicate'?'Duplicate transaction':'Amount mismatch'}</h2></div><span class="status ${riskRingClass==='high'?'orange':riskRingClass==='medium'?'yellow':'green'}">${record.state?.replace('_',' ')||'review'}</span></div><div class="amount-grid"><div class="amount"><label>EXPECTED</label><b>${money(record.payment.amount)}</b></div><div class="amount"><label>ACTUAL</label><b>${record.settlement?money(record.settlement.settlement_amount):'Missing'}</b></div><div class="amount negative"><label>DIFFERENCE</label><b>${diff}</b></div></div><div class="trace-card"><div class="eyebrow">CONTROL TRACE</div><div class="step-list">${activity('✓','Transaction and order verified')}${activity(record.settlement?'✓':'!','Settlement record '+(record.settlement?'located':'missing'))}${activity('✓','Deterministic risk rules evaluated')}${activity('✓','Evidence saved to audit trail')}</div></div></section><section class="card ai-card ai-card-refined"><div class="ai-kicker">AI ASSESSMENT</div><div class="assessment">“${assessment}”</div><div class="assessment-meta"><span>AI confidence</span><b>${investigationState.confidence || record.confidence || '—'}</b><span>Evidence-backed</span></div><div class="risk-score-row"><div class="risk-ring ${riskRingClass}">${riskM.score||'–'}</div><div class="risk-score-copy"><div class="eyebrow">AI RISK SCORE</div><b>${riskM.score} / 100 <span class="risk-tier ${riskRingClass}">${riskM.tier} RISK</span></b><small>Risk from settlement, duplicate, timing and historical signals.</small></div></div><div class="risk-signals">${riskSigHtml||'<p class="muted">No material risk signals.</p>'}</div><div class="risk-breakdown"><div class="eyebrow">TRACEABLE SCORE BREAKDOWN</div>${scoreRows}<div class="risk-break-row risk-break-total"><span>Risk score</span><b>${riskM.score} / 100</b></div></div><div class="decision-panel"><div class="decision-ai"><div class="rubric-row"><div class="eyebrow">AI RECOMMENDATION</div><b>${recommendation}</b></div><span>Recommendation informs review; it cannot override policy.</span></div><div class="decision-human"><div class="rubric-row"><div class="eyebrow">POLICY DECISION</div><b>${riskM.recommendation==='continue'?'Continue allowed':'Human approval required'}</b></div><div class="rubric-row"><div class="eyebrow">HUMAN DECISION</div>${humanLabel?`<span class="status ${humanAction==='hold'?'orange':humanAction==='escalate'?'yellow':'green'}">${humanLabel}</span><small>Recorded in the audit trail</small>`:`<span>Pending finance review</span>`}</div></div></div><div class="button-row action-row-refined"><button class="btn btn-primary" id="resolve-btn" data-investigation-id="${record.id}">Resolve</button><button class="btn btn-secondary" id="hold-btn" data-investigation-id="${record.id}">Place on hold</button><button class="btn btn-secondary" id="escalate-btn" data-investigation-id="${record.id}">Escalate</button>${humanLabel?'':`<button class="btn btn-secondary" id="approve-btn" data-investigation-id="${record.id}">Approve</button>`}</div></section></div><section class="card investigation-chat-card"><div class="inv-chat-head"><div><div class="eyebrow">AI INVESTIGATION</div><h2>Ask about <b>${record.id}</b></h2></div><span class="status green">CONTEXT-AWARE</span></div><div class="inv-chat-messages" id="inv-chat-messages"><div class="chat-msg assistant"><div class="chat-bubble">I have current transaction, evidence and risk context. Ask “why is the risk score ${riskM.score}?” for the calculation.</div></div></div><div class="chat-composer inv-chat-composer"><input id="inv-chat-input" placeholder="Ask about this investigation..." autocomplete="off"/><button id="inv-chat-send">Ask</button></div></section><section class="card section-card risk-timeline-card"><div class="section-head"><div><div class="eyebrow">RISK TIMELINE</div><h2>What happened with ${record.id}</h2></div><span class="card-note">System, risk engine, AI and human events</span></div><div class="risk-timeline" id="risk-timeline"><div class="loading">Loading timeline...</div></div></section></div>`;
}
function render(page='overview'){
  currentPage=page;
  document.querySelector('.drawer')?.remove();
  const data=pages[page]||pages.overview;
  const content=document.querySelector('#page-content');
  content.classList.remove('page-transition');
  void content.offsetWidth;
  
  // Update Navbar Dynamic Values
  const exceptionCount = matchedRecords.filter(r => r.status !== 'Matched' && r.resolution !== 'resolve').length;
  const exceptionTab = document.querySelector('.nav-item[data-page="exceptions"] em');
  if (exceptionTab) exceptionTab.textContent = exceptionCount;
  
  // Update Topbar Latest Run ID
  const latestRunId = workspaceState.runs.length ? workspaceState.runs[0].runId : 'No runs yet';
  const runIdEl = document.querySelector('.run-id');
  if (runIdEl) runIdEl.textContent = latestRunId;
  const chipStatus = document.querySelector('#chip-status');
  if (chipStatus) chipStatus.textContent = latestRunId === 'No runs yet' ? 'Live · 94.5%' : `Latest: ${latestRunId}`;

  content.innerHTML=page==='overview'?overviewPage():page==='exceptions'?liveExceptionsPage():page==='activity'?liveActivityPage():page==='audit'?liveAuditPage():page==='reports'?liveReportsPage():(page==='reconciliation'||page==='transactions')?liveReconciliationPage():page==='investigation'?liveInvestigationPage():page==='settings'?liveSettingsPage():data.html;
  const assistantBar=document.querySelector('#assistant-bar');
  if(assistantBar) assistantBar.hidden=page!=='overview';
  const globalChat=document.querySelector('#chat-panel');
  if(globalChat && page!=='overview') globalChat.hidden=true;
  content.classList.add('page-transition');
  document.querySelector('#crumb-page').textContent=data.label;
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  bindPageEvents();
  if (page === 'investigation' && investigationState) setTimeout(() => loadRiskTimeline(investigationState.id), 0);
}
async function loadRiskTimeline(id){
  const el=document.querySelector('#risk-timeline');
  if(!el)return;
  el.innerHTML='<div class="loading">Loading timeline...</div>';
  try{
    const {timeline}=await api(`/exceptions/${id}/timeline`);
    el.innerHTML=timeline.map(step=>`<div class="timeline-row ${step.kind}"><div class="timeline-time">${step.time}</div><div class="timeline-node"></div><div class="timeline-copy"><b>${step.title}</b><small>${step.detail}</small></div></div>`).join('');
  }catch(error){el.innerHTML='<div class="muted">Timeline unavailable right now.</div>'}
}
function bindPageEvents(){document.querySelectorAll('[data-page-link]').forEach(b=>b.onclick=(event)=>{event.stopPropagation();render(b.dataset.pageLink)});const heroRun=document.querySelector('#hero-run');if(heroRun)heroRun.onclick=()=>document.querySelector('#run-reconciliation').click();document.querySelectorAll('[data-transaction],[data-investigate]').forEach(b=>b.onclick=()=>openDrawer(b.dataset.transaction||b.dataset.investigate));document.querySelectorAll('.resolve-exception').forEach(b=>b.onclick=async()=>{const id=b.dataset.exceptionId;b.disabled=true;b.textContent='Resolving…';try{await api(`/exceptions/${id}/resolve`,{method:'POST'});await hydrateData();await hydrateWorkspace();toast(`${id} resolved and added to the audit trail`);render(currentPage)}catch(error){b.disabled=false;b.textContent='Resolve';toast(error.message)}});const records=document.querySelectorAll('.smart-record');const search=document.querySelector('.search-input');const applyRecordFilter=(filter)=>{const query=search?.value.trim().toLowerCase()||'';records.forEach(row=>{const textMatch=!query||row.textContent.toLowerCase().includes(query);const filterMatch=filter==='All'||(filter==='Missing'&&row.dataset.recordMissing==='true')||(filter==='Exceptions'&&row.dataset.recordStatus!=='Matched')||(filter==='Matched'&&row.dataset.recordStatus==='Matched');row.hidden=!(textMatch&&filterMatch)})};if(search)search.oninput=()=>applyRecordFilter(document.querySelector('.active-filter')?.textContent.trim()||'All');document.querySelectorAll('.filter:not(.search-input)').forEach(b=>b.onclick=()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active-filter'));b.classList.add('active-filter');applyRecordFilter(b.textContent.trim());toast(`${b.textContent.trim()} filter applied`)});bindHoldButtons();bindPageChats()}
function bindHoldButtons(){
  document.querySelectorAll('.hold-exception').forEach(b=>b.onclick=async()=>{const id=b.dataset.exceptionId;b.disabled=true;b.textContent='Holding…';try{await api(`/exceptions/${id}/hold`,{method:'POST'});await hydrateData();await hydrateWorkspace();toast(`${id} placed on hold — automatic actions blocked`);render(currentPage)}catch(error){b.disabled=false;b.textContent='Hold';toast(error.message)}});
}
function bindPageChats(){
  if(currentPage==='overview'){
    const form=document.querySelector('#overview-ask');
    if(form)form.addEventListener('submit',event=>{event.preventDefault();const value=form.querySelector('input')?.value||'';if(!value.trim())return;askClario(value,{open:true})});
  }
  if(currentPage==='investigation'&&investigationState){
    const container=document.querySelector('#inv-chat-messages');
    const input=document.querySelector('#inv-chat-input');
    const send=document.querySelector('#inv-chat-send');
    const ask=()=>{const value=input?.value.trim();if(!value)return;askClario(value,{open:false,container,context:{id:investigationState.id}});if(input)input.focus()};
    if(send)send.onclick=ask;
    if(input)input.addEventListener('keydown',event=>{if(event.key==='Enter')ask()});
  }
  if(currentPage==='reports'){
    const container=document.querySelector('#report-chat-messages');
    const input=document.querySelector('#report-chat-input');
    const send=document.querySelector('#report-chat-send');
    const reportContext={page:'reports',report:workspaceState.reports};
    const ask=(value=input?.value.trim())=>{if(!value)return;askClario(value,{open:false,container,context:reportContext});if(input)input.focus()};
    if(send)send.onclick=ask;
    if(input)input.addEventListener('keydown',event=>{if(event.key==='Enter')ask()});
    document.querySelectorAll('.report-prompt').forEach(button=>button.onclick=()=>ask(button.dataset.prompt));
  }
  if(currentPage==='exceptions'){
    const askButton=document.querySelector('#exception-ask');
    if(askButton) askButton.onclick=()=>{const panel=document.querySelector('#chat-panel');if(panel){panel.hidden=false;const input=panel.querySelector('#chat-input');if(input){input.value='Which exception should I investigate first?';input.focus()}}};
  }
  if(currentPage==='audit')bindAuditFilters();
  if(currentPage==='settings')bindSettings();
}
function bindAuditFilters(){
  const container=document.querySelector('#audit-events');
  if(!container)return;
  const input=document.querySelector('#audit-search');
  const renderAudit=()=>{
    const query=(input?.value||'').toLowerCase();
    const kind=document.querySelector('.audit-filter.active-filter')?.dataset.kind||'all';
    const rows=Array.from(container.querySelectorAll('[data-title]'));
    rows.forEach(row=>{
      const text=row.getAttribute('data-title').toLowerCase();
      const rowKind=row.getAttribute('data-kind');
      const kindMatch=kind==='all'||(kind==='warn'&&rowKind==='warning')||(kind==='done'&&rowKind==='done')||(kind==='active'&&rowKind==='active');
      row.hidden=!kindMatch||(query&&!text.includes(query));
    });
    const visible=rows.filter(row=>!row.hidden).length;
    const count=container.parentElement.querySelector('#audit-count');
    if(count)count.textContent=`${visible} of ${rows.length} events`;
  };
  if(input)input.oninput=renderAudit;
  container.parentElement.querySelectorAll('.audit-filter').forEach(b=>b.onclick=()=>{container.parentElement.querySelectorAll('.audit-filter').forEach(x=>x.classList.remove('active-filter'));b.classList.add('active-filter');renderAudit()});
  const exportBtn=document.querySelector('#audit-export');
  if(exportBtn)exportBtn.onclick=()=>{
    const events=workspaceState.audit;
    const csv=[['time','title','detail','kind','actor'],...events.map(e=>[e.time||'',e.title||'',e.detail||'',e.kind||'',e.actor||''])].map(row=>row.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='clario-audit-trail.csv';a.click();
    URL.revokeObjectURL(a.href);
    toast('Audit trail exported as CSV');
  };
  renderAudit();
}
function bindSettings(){
  const save=(group,key,value)=>api('/settings',{method:'PUT',body:JSON.stringify({[group]:{[key]:value}})}).then(payload=>{workspaceState.settings=payload;return hydrateWorkspace().catch(()=>null)});
  document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=async()=>{const[group,key]=b.dataset.toggle.split('.');const next=!b.classList.contains('on');b.classList.toggle('on',next);b.setAttribute('aria-pressed',String(next));try{await save(group,key,next);toast('Setting updated');render(currentPage)}catch(error){b.classList.toggle('on',!next);b.setAttribute('aria-pressed',String(!next));toast(error.message)}});
  document.querySelectorAll('[data-number]').forEach(input=>input.addEventListener('change',async()=>{const[group,key]=input.dataset.number.split('.');try{await save(group,key,Number(input.value));toast('Setting updated')}catch(error){toast(error.message)}}));
}
function openDrawer(id){
  document.querySelector('.drawer')?.remove();
  const record=matchedRecords.find(item=>item.id===id);
  if(!record){toast('Record not found');return;}
  const exception=record.status==='Exception'||record.status==='Needs Review';
  const title=record.pattern==='missing_settlement'?'Missing settlement':record.pattern==='duplicate'?'Duplicate transaction':record.pattern==='exact'?'Matched transaction':'Amount mismatch';
  const stateClass=record.state==='on_hold'||record.state==='escalated'?'orange':exception?'orange':'green';
  const stateLabel=record.state==='on_hold'?'ON HOLD':record.state==='escalated'?'ESCALATED':record.state==='approved'?'APPROVED':record.state==='resolved'?'RESOLVED':exception?'EXCEPTION':'MATCHED';
  const riskHtml=record.risk?`<div class="drawer-section"><label>RISK SCORE</label><div class="risk-score-row mini"><div class="risk-ring ${record.risk.tier==='High'?'high':record.risk.tier==='Medium'?'medium':'low'}">${record.risk.score}</div><div class="risk-score-copy"><b>${record.risk.tier} RISK · ${record.risk.score}/100</b><small>Engine recommends ${record.risk.recommendation}</small></div></div><div class="risk-signals">${(record.risk.signals||[]).slice(0,4).map(s=>`<div class="risk-signal"><span class="${s.kind==='critical'?'sig-crit':s.kind==='risk'?'sig-risk':'sig-info'}">${s.kind==='critical'?'!':s.kind==='risk'?'+':'·'}</span><div><b>${s.label}</b><small>${s.detail}</small></div><em>+${s.points}</em></div>`).join('')}</div></div>`:'';
  const d=document.createElement('aside');
  d.className='drawer';
  d.innerHTML=`
    <button class="drawer-close" aria-label="Close">×</button>
    <div class="eyebrow">TRANSACTION DETAIL</div>
    <div class="drawer-id">${id}</div>
    <h2>${title}</h2>
    <div class="relationship">
      <div><i>₹</i><span>Payment<strong>${money(record.payment.amount)}</strong></span></div>
      <b>→</b>
      <div><i>O</i><span>Order<strong>${record.order?.order_id||'—'}</strong></span></div>
      <b>→</b>
      <div><i>S</i><span>Settlement<strong>${record.settlement?money(record.settlement.settlement_amount):'Missing'}</strong></span></div>
    </div>
    <div class="drawer-section">
      <label>DIFFERENCE</label>
      <p class="drawer-amount">${record.difference===null||record.difference===undefined?'—':money(Math.abs(record.difference))}</p>
      <span class="status ${stateClass}">${stateLabel}</span>
    </div>
    <div class="drawer-section">
      <label>MATCHING EVIDENCE</label>
      <div class="evidence-list">
        ${(record.reasons||['Payment reference verified']).map(reason=>`<span>${reason}<b>Verified</b></span>`).join('')}
        <span>AI confidence <b>${record.confidence||'—'}</b></span>
      </div>
    </div>
    ${riskHtml}
    <div class="drawer-actions">
      <button class="btn btn-primary" id="drawer-investigate" style="width:100%">Run AI Investigation</button>
      <button class="btn btn-secondary" id="drawer-hold" style="width:100%;margin-top:10px" ${record.state==='on_hold'?'disabled':''}>
        ${record.state==='on_hold'?'Already on hold':'Place on Hold'}
      </button>
      <button class="btn btn-primary" id="drawer-approve" style="width:100%;margin-top:10px" ${record.state==='approved'||record.state==='resolved'?'disabled':''}>Approve</button>
    </div>`;
  document.body.appendChild(d);
  d.querySelector('.drawer-close').onclick=()=>d.remove();
  d.querySelector('#drawer-hold').onclick=async()=>{
    const b=d.querySelector('#drawer-hold');
    if(b.disabled)return;
    b.disabled=true;b.textContent='Holding...';
    try{await api(`/exceptions/${id}/hold`,{method:'POST'});await hydrateData();await hydrateWorkspace();d.remove();render(currentPage);toast(`${id} placed on hold`)}
    catch(error){b.disabled=false;b.textContent='Place on Hold';toast(error.message)}
  };
  d.querySelector('#drawer-approve').onclick=async()=>{
    const b=d.querySelector('#drawer-approve');
    if(b.disabled)return;
    b.disabled=true;b.textContent='Approving…';
    try{await api(`/exceptions/${id}/approve`,{method:'POST'});await hydrateData();await hydrateWorkspace();d.remove();render(currentPage);toast(`${id} approved — human decision recorded`)}
    catch(error){b.disabled=false;b.textContent='Approve';toast(error.message)}
  };
  d.querySelector('#drawer-investigate').onclick=async()=>{
    const button=d.querySelector('#drawer-investigate');
    button.disabled=true;button.textContent='Investigating…';
    try{const result=await api(`/exceptions/${id}/investigate`,{method:'POST'});investigationState={id,...result.investigation};await hydrateWorkspace();d.remove();render('investigation');toast('Evidence collected and recommendation generated')}
    catch(error){button.disabled=false;button.textContent='Run AI Investigation';toast(error.message)}
  };
}
function toast(message){const t=document.createElement('div');t.className='toast';t.innerHTML=`<span>✓</span>${message}`;document.body.appendChild(t);setTimeout(()=>t.classList.add('show'),10);setTimeout(()=>t.remove(),3200)}
document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',async()=>{const page=b.dataset.page;try{if(['reports','audit','activity'].includes(page))await hydrateWorkspace();if(page==='transactions'){const payload=await api('/transactions?limit=200');matchedRecords=payload.records;window.ledgerPilotData.records=payload.records;}}catch(error){toast('Using the latest available workspace data')}render(page)}));
async function startReconciliation(){const button=document.querySelector('#run-reconciliation');if(button?.disabled)return;button?.setAttribute('disabled','disabled');let run;try{run=await api('/reconciliation/run',{method:'POST'});await hydrateData();await hydrateWorkspace()}catch(error){toast(`Reconciliation failed: ${error.message}`);button?.removeAttribute('disabled');return}const modal=document.createElement('div');modal.className='modal-backdrop';modal.innerHTML=`<div class="run-console"><div class="run-console-main"><div class="eyebrow">RECONCILIATION RUN</div><h2>${run.runId}</h2><p>Processing finance records...</p><div class="console-flow">${['IMPORT','NORMALIZE','MATCH','INVESTIGATE','RESOLVE'].map((x,i)=>`<div class="${i===0?'current':''}"><i>${i===0?'◉':'○'}</i><b>${x}</b><span>${i===0?`${run.summary.total} records`:i===1?'standardizing sources':i===2?'matching transactions':i===3?`${run.summary.exceptions} exceptions detected`:'awaiting decisions'}</span></div>`).join('')}</div><div class="run-counts"><b>${run.summary.total} <small>records</small></b><b>${run.summary.matched} <small>matched</small></b><b>${run.summary.exceptions} <small>exceptions</small></b></div></div><aside class="run-agent"><div class="eyebrow">CLARIO AGENT</div><h3>Analyzing reconciliation</h3><p>Evidence is being indexed for review.</p><div class="agent-steps">${controllerStep('✓','Records loaded','done')}${controllerStep('✓','Records matched','done')}${controllerStep('→','Reviewing exceptions','current')}${controllerStep('○','Preparing recommendations','')}</div><span class="status green">AUDIT LOG ENABLED</span></aside></div>`;document.body.appendChild(modal);let i=0;const steps=modal.querySelectorAll('.console-flow>div');const timer=setInterval(()=>{if(i>0){steps[i-1].className='done';steps[i-1].querySelector('i').textContent='✓'}if(i<steps.length){steps[i].className='current';steps[i].querySelector('i').textContent='◉';i++}else{clearInterval(timer);setTimeout(()=>{modal.remove();button?.removeAttribute('disabled');render('overview');toast(`Run ${run.runId} complete · audit trail updated`)},650)}},800)}
document.querySelector('#run-reconciliation').onclick=startReconciliation;
const AUTH_KEY='clario.authenticated';
function showLogin(){document.querySelector('.app-shell').hidden=true;document.querySelector('.assistant-bar').hidden=true;const chat=document.querySelector('#chat-panel');if(chat)chat.hidden=true;document.querySelector('#auth-screen').hidden=false;const loginCard=document.querySelector('#login-card');const signupCard=document.querySelector('#signup-card');if(loginCard)loginCard.hidden=false;if(signupCard)signupCard.hidden=true;document.querySelector('#login-email').focus()}
async function showApp(){document.querySelector('#auth-screen').hidden=true;document.querySelector('.app-shell').hidden=false;document.querySelector('.assistant-bar').hidden=false;try{await hydrateData();await hydrateWorkspace()}catch(error){console.warn('Clario workspace data unavailable; using local data.',error.message)}render('overview')}
async function authenticate(email,password){const result=await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});localStorage.setItem(TOKEN_KEY,result.token);localStorage.setItem(AUTH_KEY,'true');return true}
async function register(name,email,password){const result=await api('/auth/register',{method:'POST',body:JSON.stringify({name,email,password})});localStorage.setItem(TOKEN_KEY,result.token);localStorage.setItem(AUTH_KEY,'true');return true}
function showAuthCard(card){document.querySelector('#login-card').hidden=card!=='login';document.querySelector('#signup-card').hidden=card!=='signup'}
document.querySelector('#go-signup').onclick=()=>{showAuthCard('signup');setTimeout(()=>document.querySelector('#signup-name')?.focus(),0)};
document.querySelector('#go-login').onclick=()=>{showAuthCard('login');setTimeout(()=>document.querySelector('#login-email')?.focus(),0)};
document.querySelector('#signup-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const name=document.querySelector('#signup-name').value;
  const email=document.querySelector('#signup-email').value;
  const password=document.querySelector('#signup-password').value;
  const confirm=document.querySelector('#signup-confirm').value;
  const error=document.querySelector('#signup-error');
  if(password!==confirm){error.textContent='Passwords do not match.';return}
  try{error.textContent='';await register(name,email,password);await hydrateData();showApp();toast(`Welcome, ${name.split(' ')[0]||'there'}! Your Clario workspace is ready`)}
  catch(apiError){error.textContent=apiError.message||'Unable to create your account.';console.error(apiError)}
});
document.querySelector('#login-form').addEventListener('submit',async event=>{event.preventDefault();const email=document.querySelector('#login-email').value;const password=document.querySelector('#login-password').value;const error=document.querySelector('#login-error');try{await authenticate(email,password);error.textContent='';await hydrateData();showApp();toast('Signed in to Clario')}catch(apiError){error.textContent='Invalid Clario credentials or unavailable backend.';console.error(apiError)}});
document.querySelector('#forgot-password').onclick=()=>toast('Password recovery will be connected to your finance identity provider.');
document.querySelector('.show-password').onclick=()=>{const input=document.querySelector('#login-password');input.type=input.type==='password'?'text':'password'};
document.querySelector('#contact-admin').onclick=event=>{event.preventDefault();toast('Contact your Clario workspace administrator to request access.')};
document.querySelector('#google-signin').onclick=()=>toast('Google sign-in will be connected to your Clario identity provider.');
document.querySelector('#logout-button').onclick = async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) {}
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(TOKEN_KEY);
  showLogin();
  toast('You have been signed out');
};
async function boot() {
  if (localStorage.getItem(TOKEN_KEY)) {
    try {
      await api('/me');
      showApp();
    } catch (e) {
      showLogin();
    }
  } else {
    showLogin();
  }
}
boot();
document.addEventListener('pointerdown', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  button.classList.remove('press-feedback');
  void button.offsetWidth;
  button.classList.add('press-feedback');
  setTimeout(() => button.classList.remove('press-feedback'), 260);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    document.querySelector('.drawer')?.remove();
    document.querySelector('.modal-backdrop')?.remove();
    const chat=document.querySelector('#chat-panel');
    if(chat&&!chat.hidden){chat.hidden=true;return}
  }
});
document.addEventListener('click',async event=>{const target=event.target.closest('#resolve-btn,#escalate-btn,#hold-btn,#approve-btn');if(!target)return;const action=target.id==='resolve-btn'?'resolve':target.id==='hold-btn'?'hold':target.id==='approve-btn'?'approve':'escalate';const id=target.dataset.investigationId||'RZP-1022';try{await api(`/exceptions/${id}/${action}`,{method:'POST'});await hydrateData();await hydrateWorkspace();toast(action==='resolve'?'Exception resolved and audit trail updated':action==='hold'?`${id} placed on hold — automatic actions blocked`:action==='approve'?`${id} approved — human decision recorded in audit`:'Exception escalated for finance review');render(currentPage)}catch(error){toast(error.message)}});
document.querySelector('.search-trigger').onclick=()=>{if(currentPage!=='reconciliation'&&currentPage!=='transactions')render('reconciliation');setTimeout(()=>{const input=document.querySelector('.search-input');input?.focus();input?.scrollIntoView({behavior:'smooth',block:'center'})},0)};
document.querySelector('.bell').onclick=()=>toast('No new Clario notifications');
function openChat(){
  const panel=document.querySelector('#chat-panel');
  if(panel.hidden){panel.hidden=false;requestAnimationFrame(()=>document.querySelector('#chat-input')?.focus())}
}
function closeChat(){const panel=document.querySelector('#chat-panel');if(panel)panel.hidden=true}
function appendChatMessage(role,text,container){
  const messages=container||document.querySelector('#chat-messages');
  if(!messages)return;
  const wrap=document.createElement('div');
  wrap.className=`chat-msg ${role}`;
  const bubble=document.createElement('div');
  bubble.className='chat-bubble';
  bubble.textContent=text||'';
  wrap.appendChild(bubble);
  messages.appendChild(wrap);
  messages.scrollTop=messages.scrollHeight;
  return bubble;
}
function chatTyping(on,container){
  const messages=container||document.querySelector('#chat-messages');
  if(!messages)return;
  const id=container?'local-typing':'chat-typing';
  let typing=messages.querySelector('#'+id);
  if(on&&!typing){typing=document.createElement('div');typing.id=id;typing.className='chat-msg assistant';typing.innerHTML='<div class="chat-bubble typing"><i></i><i></i><i></i></div>';messages.appendChild(typing);messages.scrollTop=messages.scrollHeight}
  if(!on&&typing)typing.remove();
}
async function askClario(messages,{open=true,context={},container=null}={}){
  const sourceInput=document.querySelector('.assistant-bar input');
  const chatInput=document.querySelector('#chat-input');
  const localInput=container?container.querySelector('.chat-composer input'):null;
  const message=(typeof messages==='string'?messages:'').trim()||(sourceInput?.value||'').trim()||(chatInput?.value||'').trim()||(localInput?.value||'').trim();
  if(!message)return;
  if(sourceInput)sourceInput.value='';
  if(chatInput)chatInput.value='';
  if(localInput)localInput.value='';
  if(open)openChat();
  appendChatMessage('user',message,container);
  chatTyping(true,container);
  try{
    const result=await api('/ai/controller',{method:'POST',body:JSON.stringify({message,context})});
    chatTyping(false,container);
    appendChatMessage('assistant',result.response||'No response from Clario.',container);
    await hydrateData();
    await hydrateWorkspace();
    if(container)return;
    if(result.investigation){
      const id=(message.match(/RZP-\d+/i)||[investigationState?.id])[0];
      investigationState={id:id&&String(id).toUpperCase(),...result.investigation};
      render('investigation');
    }else if(currentPage==='activity'||currentPage==='audit'||currentPage==='overview'||currentPage==='reports'){
      render(currentPage);
    }
  }catch(error){
    chatTyping(false);
    appendChatMessage('assistant',`Something went wrong: ${error.message}`);
  }
}
document.querySelector('.assistant-bar').addEventListener('click',event=>{
  if(event.target.closest('button')){askClario();return}
  openChat();
});
document.querySelector('.assistant-bar input').addEventListener('keydown',event=>{if(event.key==='Enter')askClario()});
document.querySelector('#assistant-send').onclick=()=>askClario();
document.querySelector('#chat-send').onclick=()=>askClario();
document.querySelector('#chat-input').addEventListener('keydown',event=>{if(event.key==='Enter')askClario()});
document.querySelector('#chat-close').onclick=closeChat;
document.addEventListener('click',event=>{
  const ask=event.target.closest('.activity-ask');
  if(ask){askClario(ask.dataset.ask);return}
  const report=event.target.closest('.activity-report');
  if(report){askClario(`Create a concise report about: ${report.dataset.report}`);return}
  const check=event.target.closest('.activity-check input');
  if(check){check.closest('.activity-check')?.classList.toggle('checked',check.checked)}
});
