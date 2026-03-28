# GP Fund I — LP Model

A React financial modeling app for GP/LP fund simulation with a PostgreSQL-backed marina acquisition pipeline CRM.

## Architecture

- **Frontend**: React (single `App.jsx`), Vite dev server on port 5000
- **Backend**: Express API on port 3001 (proxied via Vite)
- **Database**: PostgreSQL (via `DATABASE_URL`)
- **Marina data**: `public/data/Main.json` (5,521 marina records) or `marina_database` DB table

## Tabs

| Tab | Description |
|-----|-------------|
| Overview | Fund return summary — IRR, MOIC, waterfall, G&A |
| Deals | Per-asset underwriting sliders |
| Waterfall | LP/GP waterfall distribution |
| Fund CF | Fund-level cash flows |
| G&A Model | Hiring plan, overhead, partner salaries |
| GP Partners | Partner-level economics |
| Sensitivity | Sensitivity analysis |
| Targets | Marina database CRM (5,521 records) — filters, map, pipeline stages |
| Pipeline | Kanban board by pipeline stage — deal tracker |

## Key Features

### Fund Model
- LP/GP waterfall with preferred return and carry
- 30-asset portfolio underwriting
- Sensitivity analysis
- Scenario save/load (PostgreSQL)

### Marina CRM (Targets tab)
- 5,521 marina acquisition targets from `public/data/Main.json`
- 6-stage pipeline: Watchlist → Under Review → LOI Sent → Due Diligence → Closed → Passed
- Acquisition score (0–100) client-side scoring
- Map view with stage-colored markers + heatmap mode (ADR/RevPAR/Score)
- PDF tearsheet export (ESRI aerial tile + stats + notes)
- Nearby comps panel (same region, top 5 by score)
- Outreach tracker (contact log per marina)
- Activity timeline (auto-logged stage changes, notes, outreach)

### Pipeline Tracker (Pipeline tab)
- Kanban board organized by the 6 pipeline stages
- Summary strip: count + total slips per stage
- Card details: name, location, slips, score, notes excerpt, last activity, outreach count
- Inline stage-change dropdown on each card
- Detail drawer (right panel): full stats, hotel market, notes, stage-change buttons
- API: `GET /api/pipeline` returns enriched join of marina_interest + marina data + outreach/activity counts

## Database Tables

| Table | Purpose |
|-------|---------|
| `scenarios` | Saved fund model scenarios (JSONB) |
| `marina_database` | Uploaded marina dataset (key='main') |
| `marina_interest` | Pipeline stage per marina (marina_id PK, status, notes) |
| `marina_outreach` | Contact log entries per marina |
| `marina_activity` | Auto-logged activity timeline |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scenarios` | List all scenarios |
| POST | `/api/scenarios/:name` | Save scenario |
| GET | `/api/marinas` | Get marina dataset |
| POST | `/api/marinas` | Upload marina dataset |
| GET | `/api/marina-interest` | All staged marinas |
| POST | `/api/marina-interest/:id` | Set stage / save notes |
| DELETE | `/api/marina-interest/:id` | Clear stage |
| GET | `/api/pipeline` | Enriched pipeline data (join of interest + marina details + outreach/activity) |
| GET | `/api/marina-outreach/:id` | Outreach log for a marina |
| POST | `/api/marina-outreach/:id` | Add outreach entry |
| DELETE | `/api/marina-outreach/:id/:entryId` | Delete outreach entry |
| GET | `/api/marina-activity/:id` | Activity timeline for a marina |

## Design System

- **Fonts**: DM Serif Display (headings), DM Sans (body), JetBrains Mono (numbers)
- **Palette**: Navy `#0A2342`, BG `#FAFAF8`, Accent `#00D4FF`, Gold `#D4AF37`
- **Theme**: Light, clean, professional GP fund aesthetic
