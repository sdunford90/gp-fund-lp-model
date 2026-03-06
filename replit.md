# GP Fund I — LP Model

A financial modeling single-page React application for General Partners (GPs) and Limited Partners (LPs) to simulate and analyze fund performance.

## Features

- **Overview Dashboard**: Fund return summary with LP IRR, MOIC, proceeds, and GP economics
- **Asset Modeling**: 8-asset portfolio with individual asset performance tracking
- **Waterfall Distribution**: Preferred returns, catch-up, and promote calculations
- **Fund Cash Flow**: Multi-year fund cash flow analysis
- **G&A Model**: Personnel hiring plan, salaries, and operational overhead
- **GP Partners**: Per-partner economics and co-investment tracking
- **Sensitivity Analysis**: Scenario planning with parameter sweeps
- **Scenarios**: Save/load scenarios to localStorage

## Tech Stack

- **Framework**: React 18
- **Build Tool**: Vite 5
- **Charts**: Recharts
- **Styling**: Inline CSS (dark theme, #0D1B2A background)
- **Runtime**: Node.js 20

## Project Structure

```
/
├── index.html        # HTML entry point
├── main.jsx          # React bootstrap
├── App.jsx           # Main app - all logic and UI (large file)
├── vite.config.js    # Vite config (port 5000, host 0.0.0.0)
├── package.json      # Dependencies
└── replit.nix        # Nix environment (do not edit)
```

## Running

The app runs via the "Start application" workflow on port 5000. npm must be referenced by full nix store path since it is not in the default shell PATH:

```
PATH=/nix/store/1lagpgadaybvs1n2312gysg2phjk89y8-nodejs-20.20.0-wrapped/bin:$PATH npm install && PATH=/nix/store/1lagpgadaybvs1n2312gysg2phjk89y8-nodejs-20.20.0-wrapped/bin:$PATH npm run dev
```

## Architecture Notes

- `App.jsx` contains everything: the `DEFAULT` assumptions object, the `run(a)` financial calculation function, and all React components
- Financial calculations include IRR, MOIC, waterfall distributions, asset-level returns
- State management via React `useState`, persistence via `localStorage`
