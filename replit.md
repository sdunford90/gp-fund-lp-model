# GP Fund I — LP Model

A financial modeling React application for General Partners (GPs) and Limited Partners (LPs) to simulate and analyze fund performance.

## Features

- **Overview Dashboard**: Fund return summary with LP IRR, MOIC, proceeds, and GP economics
- **Asset Modeling**: 8-asset portfolio with individual asset performance tracking (global/scenario scope)
- **Waterfall Distribution**: Preferred returns, catch-up, and promote calculations
- **Fund Cash Flow**: Multi-year fund cash flow analysis with disposition proceeds breakdown (gross sale, debt repaid, selling costs, net to equity)
- **G&A Model**: Personnel hiring plan, salaries, and operational overhead (global/scenario scope)
- **GP Partners**: Per-partner economics and co-investment tracking
- **Sensitivity Analysis**: Scenario planning with parameter sweeps
- **Scenarios**: Save/load scenarios to PostgreSQL database
- **Global vs Scenario Scope**: All items (assets, hires, expenses) can be marked global (shared across scenarios) or scenario-specific

## Tech Stack

- **Frontend**: React 18 + Vite 5 + Recharts
- **Backend**: Express.js API server (port 3001)
- **Database**: PostgreSQL (Replit built-in)
- **Styling**: Inline CSS (dark theme, #0D1B2A background)
- **Runtime**: Node.js 20

## Project Structure

```
/
├── index.html         # HTML entry point
├── main.jsx           # React bootstrap
├── App.jsx            # Main app - all logic and UI
├── server/
│   └── index.js       # Express API server (scenarios CRUD, globals)
├── vite.config.js     # Vite config (port 5000, proxy /api to :3001)
├── package.json       # Dependencies (type: module)
└── replit.nix         # Nix environment (do not edit)
```

## Database Schema

- **scenarios**: id, name (unique), data (JSONB), created_at, updated_at
- **global_items**: id, type, data (JSONB), created_at, updated_at

## API Endpoints

- `GET /api/scenarios` - List all scenarios
- `POST /api/scenarios` - Create/update scenario (upsert by name)
- `DELETE /api/scenarios/:name` - Delete scenario
- `GET /api/globals` - Get all global items grouped by type
- `POST /api/globals` - Add a global item
- `PUT /api/globals/:id` - Update a global item
- `DELETE /api/globals/:id` - Delete a global item
- `PUT /api/globals/propagate/:type` - Propagate global item changes to all saved scenarios

## Running

The app runs via the "Start application" workflow which starts both the Express API (port 3001) and Vite dev server (port 5000). Vite proxies `/api` requests to Express.

## Architecture Notes

- `App.jsx` contains: DEFAULT assumptions, `run(a)` financial calc function, all React components
- Financial calculations include IRR, MOIC, waterfall distributions, asset-level returns
- State management via React `useState`, persistence via PostgreSQL
- All item types (assets, hires, overhead, oneTime) support `scope` field: "global" or "scenario"
- Global items propagate changes across all saved scenarios
- Scenario items only affect the current scenario
