# Clario — AI Finance Controller

> Automated reconciliation · AI-powered exception investigation · Deterministic risk intelligence · Human-in-the-loop audit

Clario is a full-stack finance operations platform built for a hackathon demo. It reconciles payments, orders and settlements, flags exceptions, scores risk deterministically, and routes every decision through a multi-agent AI architecture backed by a human audit trail.

---

## Features

| Area | What Clario does |
|---|---|
| **Reconciliation** | Import → Normalize → Match → Exception detection across payments, orders and settlements |
| **Exception Investigation** | Evidence-based AI investigation per transaction; chatbot context-aware to the open case |
| **Risk Intelligence** | Deterministic rule-based risk scoring (not a fraud probability); velocity, duplicate, settlement and timing signals |
| **Human-in-the-Loop** | Approve / Resolve / Escalate / Hold with policy validation and full audit trail |
| **AI Controller** | Natural-language global chatbot that routes commands to the correct agent or answers conversationally |
| **Reports** | Match rate, auto-resolution, recovered value, risk breakdown, flagged transactions, run comparison, root-cause |
| **Reports Chatbot** | Analyst chatbot embedded in the reports page; answers using live report data |
| **Audit Trail** | Every system, AI and human event logged with actor, timestamp, kind and detail |
| **AI Activity** | Transparent log of every agent tool execution |

---

## Architecture

```
Browser (index.html + app.js + styles.css)
         │  fetch /api/*
         ▼
Node HTTP Server (server.js  /  api/index.js for Vercel)
         │
         ├── db.js          — MongoDB persistence layer
         ├── ai/
         │    ├── index.js         — public AI interface
         │    ├── runtime.js       — dependency injection for agents
         │    ├── mistral.js       — Mistral AI client (native fetch, JSON mode)
         │    ├── langgraph.js     — lightweight StateGraph runner
         │    ├── risk.js          — deterministic risk engine
         │    ├── policy.js        — action policy engine
         │    ├── state.js         — agent state factory
         │    ├── agents/
         │    │    ├── controller.js         — routes requests + chat responses
         │    │    ├── reconciliation_agent.js
         │    │    ├── investigation_agent.js
         │    │    ├── pattern_agent.js
         │    │    └── resolution_agent.js
         │    └── tools/
         │         ├── finance_tools.js      — records, matching, metrics
         │         ├── investigation_tools.js — evidence, related tx, history
         │         ├── pattern_tools.js      — pattern detection + persistence
         │         └── action_tools.js       — actions, audit, activity
         └── finance-data.js  — seed data (150 transactions, 8 merchants)
```

### AI Agent Architecture

```
User prompt
    │
    ▼
AI Controller (controller.js)
    │  classifies intent via Mistral (with deterministic fallback)
    ├──▶ Reconciliation Agent  → normalize · match · detect exceptions · persist run
    ├──▶ Investigation Agent   → evidence · related tx · pattern · confidence → save
    ├──▶ Pattern Agent         → group · score · persist recurring patterns
    ├──▶ Resolution Agent      → policy check → execute action → audit
    └──▶ Query / Chat          → page context response (overview / reports / audit / activity)
                                 OR investigation chatbot (context-aware to open case)
```

Every agent step records an AI Activity event and a deterministic audit entry. The LLM (Mistral) generates narrative assessments; it never invents scores, amounts or actions — those come from the rule-based engine.

### Risk Engine

Risk is **deterministic** — the same inputs always produce the same score.

| Signal | Points | Trigger |
|---|---|---|
| Missing settlement | 78 | No settlement record exists |
| Duplicate payment | 54 | Same order captured twice |
| Refund mismatch | 34 | Refund not reflected in settlement |
| Amount anomaly | 10–28 | Variance vs expected amount |
| Unusual settlement timing | 20 | Settlement date outside SLA |
| Velocity anomaly | 18–26 | Multiple payments from same account within 90s |
| Merchant frequency anomaly | 12–22 | Amount far above merchant median |
| Historical recurrence | 8–12 | 3+ similar open cases |

Score tiers: **High ≥ 75 → hold** · **Medium ≥ 50 → review** · **Low < 50 → continue**

---

## Tech Stack

- **Frontend** — vanilla JS, HTML5, CSS3 (no framework, no build step)
- **Backend** — Node.js `http.createServer` (no Express dependency)
- **Database** — MongoDB (Atlas or local); fully optional — runs in demo mode without it
- **AI** — Mistral AI via native `fetch` (Node 18+); optional — deterministic fallback when key absent
- **Agent orchestration** — custom `StateGraph` (langgraph-style, local implementation)

---

## Local Setup

### Prerequisites

- Node.js **18+**
- MongoDB Atlas cluster (optional — app works in demo mode without it)
- Mistral API key (optional — deterministic fallback active without it)

### 1. Clone and install

```bash
git clone https://github.com/your-username/clario.git
cd clario
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — fill in MONGODB_URI and/or MISTRAL_API_KEY
```

### 3. Run

```bash
npm start
# or
node server.js
```

Open **http://localhost:3001** in your browser.

### 4. Login

```
Email:    demo@clario.ai
Password: ClarioDemo123!
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | Optional | MongoDB Atlas connection string. Without it, all state is in-memory (lost on restart). |
| `MONGODB_DB` | Optional | Database name. Default: `ledgerpilot` |
| `MISTRAL_API_KEY` | Optional | Mistral AI key for narrative assessments. Without it, the system uses deterministic fallbacks. |
| `MISTRAL_MODEL` | Optional | Mistral model ID. Default: `mistral-small-2506` |
| `CLARIO_SESSION_SECRET` | Recommended | Secret used to sign serverless login sessions. Set a long random value in production. |
| `PORT` | Optional | Server port. Default: `3001` |

See `.env.example` for the full template.

---

## Demo Flow

The recommended presentation sequence:

1. Open **http://localhost:3001** → Login with demo credentials
2. **Overview** — live match rate, exceptions, money flow from real data
3. Ask Clario: *"What needs my attention?"*
4. **Run Reconciliation** (header button or say *"Run reconciliation"*)
5. Watch the run console: IMPORT → NORMALIZE → MATCH → INVESTIGATE → RESOLVE
6. Dashboard updates with real metrics
7. Open **RZP-1047** (missing settlement, High risk)
8. Click **Run AI Investigation** in the drawer
9. Open **Exception Investigation** page
10. Ask the chatbot: *"Why is the risk score high?"*
11. Ask: *"Show me the evidence."*
12. Ask: *"What happens if I approve this?"*
13. Click **Place on Hold** → verify status changes to ON HOLD
14. Open **AI Activity** → see all agent/tool steps logged
15. Open **Audit Trail** → see human decision with actor name
16. Open **Reports** → risk breakdown, flagged transactions, root cause
17. Ask the Reports chatbot: *"Why are high-risk transactions increasing?"*

---

## API Overview

All API routes require `Authorization: Bearer <token>` except auth endpoints.

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Login; returns `{ token, user }` |
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/logout` | Invalidate session |
| GET | `/api/health` | Service health + DB/Mistral status |
| GET | `/api/dashboard` | Summary + recent activity + recurring patterns |
| GET | `/api/reconciliation` | All records annotated with risk + state |
| POST | `/api/reconciliation/run` | Run full reconciliation pipeline |
| GET | `/api/reconciliation/runs` | List all runs |
| GET | `/api/transactions` | Paginated + filterable transaction list |
| POST | `/api/exceptions/:id/investigate` | Run AI investigation for exception |
| GET | `/api/exceptions/:id/investigation` | Retrieve saved investigation |
| GET | `/api/exceptions/:id/timeline` | Risk timeline for exception |
| POST | `/api/exceptions/:id/hold` | Place transaction on hold |
| POST | `/api/exceptions/:id/resolve` | Resolve exception (policy-checked) |
| POST | `/api/exceptions/:id/escalate` | Escalate to finance |
| POST | `/api/exceptions/:id/approve` | Approve exception |
| GET | `/api/audit` | Full audit trail |
| GET | `/api/ai/activity` | AI agent activity log |
| GET | `/api/ai/agents` | Agent fleet status + execution counts |
| POST | `/api/ai/controller` | AI Controller (chat + command routing) |
| GET | `/api/reports` | Full report data |
| GET | `/api/reports/csv` | Export report as CSV |
| GET | `/api/settings` | Get reconciliation + AI settings |
| PUT | `/api/settings` | Update settings |

---

## MongoDB Setup

1. Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Create a database user with read/write access
3. Copy the connection string and set `MONGODB_URI` in `.env`
4. The app creates all collections and indexes automatically on first start
5. Seed data (150 transactions) is inserted once when the `records` collection is empty

Collections: `records` · `actions` · `audit` · `activity` · `investigations` · `runs` · `patterns` · `risk_snapshots`

---

## Vercel Deployment

> **Note:** This project uses a custom Node HTTP server. Vercel's serverless adapter is in `api/index.js`.

### Steps

1. Push the repo to GitHub (make sure `.env` is not committed)

2. Import the project in the [Vercel dashboard](https://vercel.com/new)

3. Set environment variables in **Settings → Environment Variables**:
   - `MONGODB_URI`
   - `MONGODB_DB` (optional, default `ledgerpilot`)
   - `MISTRAL_API_KEY` (optional)
   - `MISTRAL_MODEL` (optional)

4. Vercel build settings:
   - **Framework Preset:** Other
   - **Build Command:** `npm run build` (no-op — prints a message)
   - **Output Directory:** `.` (project root)
   - **Install Command:** `npm install`

5. Deploy. The `vercel.json` routes:
   - `/api/*` → serverless function at `api/index.js`
   - `*.html`, `*.css`, `*.js` → static files
   - All other paths → `index.html` (SPA fallback)

6. After deploy, open the Vercel URL — the demo credentials work identically.

### Deployment checklist

- Confirm `MONGODB_URI` uses a production Atlas user with access from Vercel.
- Add `MONGODB_DB`, `MISTRAL_API_KEY`, and `MISTRAL_MODEL` in Vercel.
- Never paste API keys into source code, README files, browser code, or Git history.
- Verify `GET https://<your-domain>/api/health` reports the expected database and AI status.
- Test login, reconciliation, an exception investigation, and a Reports question after deployment.
- Keep the Mistral key optional if deterministic fallback mode is acceptable for the demo.

### Vercel CLI deployment

```bash
npm install
npx vercel login
npx vercel
npx vercel --prod
```

Select the repository root as the project directory. Configure secrets with the Vercel
dashboard or `vercel env add`; do not upload `.env`.

### Alternative: Deploy backend separately

If you prefer more control (or need a persistent WebSocket/long-running process):

- **Backend** → [Railway](https://railway.app) or [Render](https://render.com): `npm start`
- **Frontend** → Vercel static site pointing to the backend URL

In that case, update `API_BASE` in `app.js` or set it from an environment variable at build time.

---

## Known Limitations

- Sessions are in-memory. A cold Vercel start loses active login sessions (users re-authenticate).
- Without `MONGODB_URI`, all data is lost on server restart.
- The demo account (`demo@clario.ai`) is the only pre-configured user; others can register in-session.
- Registration accounts are held in memory in the current demo implementation and are not durable across cold starts.

---

*Built for the Clario AI Finance Controller hackathon demo.*
