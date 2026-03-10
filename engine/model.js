// ── FINANCIAL ENGINE ─────────────────────────────────────────────────────────
// Extracted from App.jsx so it can be used by both frontend and backend (Node).
// Pure functions — no React, no DOM, no side effects.

// ── MATH ────────────────────────────────────────────────────────────────────
export function pmt(r, n, pv) {
  return r === 0 ? pv / n : (pv * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

export function fvLoan(r, n, pmt, pv) {
  return pv * Math.pow(1 + r, n) - pmt * (Math.pow(1 + r, n) - 1) / r;
}

export function irr(cfs, g = 0.1) {
  let r = g;
  for (let i = 0; i < 300; i++) {
    let v = 0, d = 0;
    cfs.forEach((c, t) => { v += c / Math.pow(1 + r, t); d -= t * c / Math.pow(1 + r, t + 1); });
    if (Math.abs(d) < 1e-12) break;
    const nr = r - v / d;
    if (Math.abs(nr - r) < 1e-9) return nr;
    r = nr;
  }
  return r;
}

export function totalLPForIRR(targetIRR, lpCapital, annualInterim, N) {
  if (targetIRR <= -0.99) return Infinity;
  let pvInterim = 0;
  for (let y = 1; y < N; y++) pvInterim += annualInterim / Math.pow(1 + targetIRR, y);
  const terminal = (lpCapital - pvInterim) * Math.pow(1 + targetIRR, N);
  return annualInterim * (N - 1) + terminal;
}

// ── DEFAULTS ────────────────────────────────────────────────────────────────
export const DEF_PROMOTE_TIERS = [
  { irrHurdle: null, moicHurdle: null, lpSplit: 0.80, gpSplit: 0.20 },
];

export const MULTI_TIER_PRESET = [
  { irrHurdle: 0.16, moicHurdle: 1.80, lpSplit: 0.80, gpSplit: 0.20 },
  { irrHurdle: 0.19, moicHurdle: 2.25, lpSplit: 0.70, gpSplit: 0.30 },
  { irrHurdle: null, moicHurdle: null, lpSplit: 0.60, gpSplit: 0.40 },
];

export const DEFAULT_ASSUMPTIONS = {
  fundTerm: 7, debtPct: 0.60, interestRate: 0.065, amortYears: 25,
  exitCapRate: 0.075, saleCosts: 0.02, carry: 0.20, prefReturn: 0.07,
  gpPct: 0.02, amFee: 0.01, pmFee: 0.06, benefitsRate: 0.22, salaryGrowth: 0.03,
  partners: 3, compoundPref: false, catchUp: false,
  refiEnabled: false, refiMonth: 36, refiLTV: 0.70, refiRate: 0.065, refiCosts: 0.01,
};

// ── RUN MODEL ───────────────────────────────────────────────────────────────
export function run(a) {
  const {
    assets = [], hires = [], overhead = [], fundTerm, debtPct, interestRate, amortYears,
    exitCapRate, saleCosts, carry, prefReturn, gpPct, amFee, pmFee,
    benefitsRate, salaryGrowth, partners, partnerSalaries = [], oneTime = [],
    compoundPref = false, catchUp = false, promoteTiers = DEF_PROMOTE_TIERS,
    refiEnabled = false, refiMonth = 36, refiLTV = 0.70, refiRate = 0.065, refiCosts = 0.01
  } = a;
  const MO = fundTerm * 12;

  // G&A monthly
  const gaMonthly = Array.from({ length: MO }, (_, i) => {
    const mo = i + 1, yr = Math.floor(i / 12);
    let sal = 0;
    hires.forEach(h => {
      if (mo >= h.start) {
        const y = Math.floor((mo - h.start) / 12);
        sal += (h.salary * Math.pow(1 + salaryGrowth, y) / 12) * h.alloc;
      }
    });
    let partnerSal = 0;
    (partnerSalaries || []).forEach(p => {
      if (mo >= p.start) {
        const y = Math.floor((mo - p.start) / 12);
        partnerSal += (p.salary * Math.pow(1 + salaryGrowth, y) / 12);
      }
    });
    sal += partnerSal;
    const ben = sal * benefitsRate;
    let fix = 0;
    overhead.forEach(o => {
      if (mo < o.start) return;
      if (o.end && o.end > 0 && mo > o.end) return;
      let base = o.annual;
      if (o.ramps) {
        const props = assets.filter(x => x.startMonth <= mo).length;
        base = props * 250 * 12;
      }
      const ramp = o.rampMo && o.rampMo > 1 ? Math.min(1, (mo - o.start + 1) / o.rampMo) : 1;
      const annualGrown = base * Math.pow(1 + o.growth, yr);
      fix += (annualGrown / 12) * ramp;
    });
    let oneTimeHit = 0;
    (oneTime || []).forEach(e => { if (e.month === mo) oneTimeHit += e.amount; });
    return {
      mo, sal, partnerSal, ben, personnel: sal + ben, fix, oneTimeHit,
      total: sal + ben + fix + oneTimeHit, partnerSalCost: partnerSal * (1 + benefitsRate)
    };
  });

  // Asset calcs
  const refiYr = refiEnabled ? refiMonth / 12 : null;
  const assetR = assets.map(asset => {
    const eq = asset.price * (1 - debtPct), debt = asset.price * debtPct;
    const annDS = pmt(interestRate, amortYears, debt);
    const margin = asset.noiMargin || 0.525;
    const noi = Array.from({ length: fundTerm + 1 }, (_, y) =>
      y === 0 ? 0 : asset.price * asset.cap * Math.pow(1 + asset.growth, y - 1));
    const egi = noi.map(n => margin > 0 ? n / margin : n);

    let refiProceeds = 0, newDebt = 0, newAnnDS = 0, refiYearIdx = 0;
    const assetRefiEligible = refiEnabled && asset.startMonth < refiMonth;
    if (assetRefiEligible) {
      refiYearIdx = Math.ceil((refiMonth - asset.startMonth) / 12);
      const yrsHeld = (refiMonth - asset.startMonth) / 12;
      const refiNOI = asset.price * asset.cap * Math.pow(1 + asset.growth, yrsHeld);
      const appraisedVal = refiNOI / exitCapRate;
      newDebt = appraisedVal * refiLTV;
      const yrsFromAcq = (refiMonth - asset.startMonth) / 12;
      const oldLB = Math.abs(fvLoan(interestRate, Math.round(yrsFromAcq), annDS, debt));
      refiProceeds = newDebt - oldLB - appraisedVal * refiCosts;
      if (refiProceeds < 0) refiProceeds = 0;
      newAnnDS = pmt(refiRate, amortYears, newDebt);
    }

    const ecf = noi.map((n, y) => {
      if (y === 0) return -eq;
      const ds = assetRefiEligible && y >= refiYearIdx ? newAnnDS : annDS;
      return n - ds - egi[y] * pmFee;
    });
    if (assetRefiEligible && refiYearIdx <= fundTerm) {
      ecf[refiYearIdx] = (ecf[refiYearIdx] || 0) + refiProceeds;
    }

    const exitNOI = noi[fundTerm];
    const exitVal = exitNOI / exitCapRate;
    const exitLB = assetRefiEligible
      ? Math.abs(fvLoan(refiRate, fundTerm - Math.round((refiMonth - asset.startMonth) / 12), newAnnDS, newDebt))
      : Math.abs(fvLoan(interestRate, fundTerm, annDS, debt));
    const saleNet = exitVal - exitLB - exitVal * saleCosts;
    ecf[fundTerm] += saleNet;
    const eqIRR = irr(ecf);
    const moic = ecf.slice(1).reduce((s, v) => s + v, 0) / eq;
    return {
      ...asset, eq, debt, annDS, noi, saleNet, exitVal, lb: exitLB, irr: eqIRR, moic,
      refiProceeds, newDebt, newAnnDS, assetRefiEligible
    };
  });

  // Monthly portfolio
  const totEqDep = assets.reduce((s, x) => s + x.price * (1 - debtPct), 0);
  const totGPIn = totEqDep * gpPct, totLPIn = totEqDep * (1 - gpPct);
  const totRefiProceeds = assetR.reduce((s, x) => s + (x.refiProceeds || 0), 0);

  const monthly = Array.from({ length: MO }, (_, i) => {
    const mo = i + 1;
    let noi = 0, egi = 0, invEq = 0, ds = 0;
    assets.forEach((x, ai) => {
      if (mo < x.startMonth) return;
      const yrs = (mo - x.startMonth) / 12;
      const moNoi = x.price * x.cap * Math.pow(1 + x.growth, yrs) / 12;
      const margin = x.noiMargin || 0.525;
      noi += moNoi;
      egi += margin > 0 ? moNoi / margin : moNoi;
      invEq += x.price * (1 - debtPct);
      const ar = assetR[ai];
      if (ar.assetRefiEligible && mo >= refiMonth) {
        ds += Math.abs(ar.newAnnDS) / 12;
      } else {
        ds += Math.abs(pmt(interestRate, amortYears, x.price * debtPct)) / 12;
      }
    });
    const amFeeM = invEq * amFee / 12;
    const pmFeeM = egi * pmFee;
    const netOpCF = noi - ds - pmFeeM - amFeeM;
    const lpCall = assets.reduce((s, x) => x.startMonth === mo ? s + x.price * (1 - debtPct) * (1 - gpPct) : s, 0);
    const gpCall = assets.reduce((s, x) => x.startMonth === mo ? s + x.price * (1 - debtPct) * gpPct : s, 0);
    const refiDist = refiEnabled && mo === refiMonth ? totRefiProceeds : 0;
    const lpRefiDist = refiDist * (1 - gpPct);
    const gpRefiDist = refiDist * gpPct;
    return {
      mo, noi, invEq, ds, amFeeM, pmFeeM, netOpCF, lpCall, gpCall,
      refiDist, lpRefiDist, gpRefiDist,
      ga: gaMonthly[i].total
    };
  });

  // Totals
  const totLPCalled = monthly.reduce((s, x) => s + x.lpCall, 0);
  const totGPCalled = monthly.reduce((s, x) => s + x.gpCall, 0);
  const totSaleProc = assetR.reduce((s, x) => s + x.saleNet, 0);
  const totExitVal = assetR.reduce((s, x) => s + x.exitVal, 0);
  const totDebtRepaid = assetR.reduce((s, x) => s + x.lb, 0);
  const totSellingCosts = assetR.reduce((s, x) => s + x.exitVal * saleCosts, 0);
  const totOpCF = monthly.reduce((s, x) => s + Math.max(0, x.netOpCF), 0);
  const totNetOpCF = monthly.reduce((s, x) => s + x.netOpCF, 0);
  const totAMFee = monthly.reduce((s, x) => s + x.amFeeM, 0);
  const totPMFee = monthly.reduce((s, x) => s + x.pmFeeM, 0);
  const totFees = totAMFee + totPMFee;
  const totGA = gaMonthly.reduce((s, x) => s + x.total, 0);
  const totPartnerSal = gaMonthly.reduce((s, x) => s + (x.partnerSalCost || 0), 0);

  const totGAShortfall = Math.max(0, totGA - totAMFee - totPMFee);
  const lpActualCapital = totLPCalled + totGAShortfall;
  const gpActualCapital = totGPCalled;

  const totRefiLP = monthly.reduce((s, x) => s + (x.lpRefiDist || 0), 0);
  const totRefiGP = monthly.reduce((s, x) => s + (x.gpRefiDist || 0), 0);
  const totRefi = totRefiLP + totRefiGP;

  // WATERFALL
  const pool = totSaleProc + totOpCF;
  let rem = pool;

  const lpROC = Math.min(lpActualCapital, rem); rem -= lpROC;
  const gpROC = Math.min(gpActualCapital, rem); rem -= gpROC;

  const lpPrefDue = compoundPref
    ? lpActualCapital * (Math.pow(1 + prefReturn, fundTerm) - 1)
    : lpActualCapital * prefReturn * fundTerm;
  const lpPref = Math.min(lpPrefDue, rem); rem -= lpPref;

  let gpCatchUp = 0;
  if (catchUp) {
    const cuAmt = Math.min(rem, (carry * lpPref) / (1 - carry));
    gpCatchUp = cuAmt;
    rem -= cuAmt;
  }

  const annualInterimLP = (totOpCF * (1 - gpPct)) / (fundTerm);

  let lpDistTotal = lpROC + lpPref;
  let gpPromote = gpCatchUp;
  let lpResid = 0;

  const tierResults = [];
  for (const tier of promoteTiers) {
    if (rem <= 0) { tierResults.push({ ...tier, lp: 0, gp: 0 }); continue; }
    if (tier.irrHurdle == null && tier.moicHurdle == null) {
      const lpAmt = rem * tier.lpSplit;
      const gpAmt = rem * tier.gpSplit;
      lpDistTotal += lpAmt;
      gpPromote += gpAmt;
      lpResid += lpAmt;
      tierResults.push({ ...tier, lp: lpAmt, gp: gpAmt });
      rem = 0;
    } else {
      let lpTarget = Infinity;
      if (tier.moicHurdle != null) lpTarget = Math.min(lpTarget, tier.moicHurdle * lpActualCapital);
      if (tier.irrHurdle != null) {
        const lpForIRR = totalLPForIRR(tier.irrHurdle, lpActualCapital, annualInterimLP, fundTerm);
        if (isFinite(lpForIRR) && lpForIRR > 0) lpTarget = Math.min(lpTarget, lpForIRR);
      }
      const lpNeeded = Math.max(0, lpTarget - lpDistTotal);
      const tierTotalNeeded = tier.lpSplit > 0 ? lpNeeded / tier.lpSplit : 0;
      const tierActual = Math.min(rem, tierTotalNeeded);
      const lpAmt = tierActual * tier.lpSplit;
      const gpAmt = tierActual * tier.gpSplit;
      lpDistTotal += lpAmt;
      gpPromote += gpAmt;
      lpResid += lpAmt;
      tierResults.push({ ...tier, lp: lpAmt, gp: gpAmt });
      rem -= tierActual;
    }
  }

  const lpTotal = lpROC + lpPref + lpResid + totRefiLP;
  const gpFundTotal = gpROC + gpPromote + totRefiGP;
  const lpMOIC = lpTotal / Math.max(1, lpActualCapital);

  // LP IRR
  const lpCF = Array(fundTerm + 1).fill(0);
  lpCF[0] = -lpActualCapital;
  for (let y = 1; y < fundTerm; y++) lpCF[y] = annualInterimLP;
  lpCF[fundTerm] = (lpROC + lpPref + lpResid) - annualInterimLP * (fundTerm - 1);
  if (refiEnabled && totRefiLP > 0) {
    const refiYrIdx = Math.min(fundTerm, Math.ceil(refiMonth / 12));
    lpCF[refiYrIdx] += totRefiLP;
  }
  const lpIRR = irr(lpCF);

  // GP Entity cash flow
  const gpEntity = monthly.map((m, i) => {
    const fees = m.amFeeM + m.pmFeeM;
    const opDist = Math.max(0, m.netOpCF) * gpPct;
    const coInvest = -m.gpCall;
    const ga = -gaMonthly[i].total;
    const refiGP = m.gpRefiDist || 0;
    const net = fees + opDist + coInvest + ga + refiGP;
    return { mo: m.mo, fees, opDist, coInvest, ga, refiGP, net, promote: 0, shortfallROC: 0 };
  });
  gpEntity[MO - 1].promote = gpPromote;
  gpEntity[MO - 1].net += gpPromote;

  let gpCum = 0;
  const gpCumData = gpEntity.map(x => { gpCum += x.net; return { mo: x.mo, cum: gpCum }; });
  const gpNetTotal = gpCumData[MO - 1].cum;
  const gpBreakeven = gpCumData.find(x => x.cum >= 0)?.mo ?? null;

  // Per-partner
  const promPP = gpPromote / partners;
  const opDrawsTotal = gpEntity.reduce((s, x) => s + Math.max(0, x.net - (x.promote || 0) - (x.shortfallROC || 0)), 0);
  const drawsPP = opDrawsTotal / partners;
  const rocPP = gpROC / partners;
  const coInvPP = totGPCalled / partners;
  const totalPP = promPP + drawsPP + rocPP;
  const netPP = totalPP - coInvPP;

  const partnerMonthly = gpEntity.map(x => ({
    mo: x.mo,
    draw: Math.max(0, x.net - (x.promote || 0)) / partners,
    promote: (x.promote || 0) / partners,
  }));
  let pCum = 0;
  const partnerCum = partnerMonthly.map(x => { pCum += x.draw + x.promote; return { mo: x.mo, cum: pCum }; });

  // Charts
  const noiChart = Array.from({ length: fundTerm }, (_, y) => {
    const s = y * 12, e = (y + 1) * 12;
    return { year: `Yr ${y + 1}`, noi: monthly.slice(s, e).reduce((t, x) => t + x.noi, 0) };
  });

  const fundCFAnnual = Array.from({ length: fundTerm }, (_, y) => {
    const s = y * 12, e = (y + 1) * 12;
    const slice = monthly.slice(s, e);
    return {
      year: `Yr ${y + 1}`,
      lpCalls: -slice.reduce((t, x) => t + x.lpCall, 0),
      opCF: slice.reduce((t, x) => t + x.netOpCF, 0),
      noi: slice.reduce((t, x) => t + x.noi, 0),
      refiDist: slice.reduce((t, x) => t + (x.refiDist || 0), 0),
    };
  });

  const deplCurve = monthly.map(m => ({
    mo: m.mo,
    lp: assets.filter(x => x.startMonth <= m.mo).reduce((s, x) => s + x.price * (1 - debtPct) * (1 - gpPct), 0),
  }));

  const gaChart = gaMonthly.map(x => ({ mo: x.mo, personnel: x.personnel, fix: x.fix }));

  const C = { gold: "#C9A84C" };

  return {
    assetR, lpIRR, lpMOIC, lpROC, lpPref, lpResid, lpTotal,
    gpROC, gpPromote, gpCatchUp, gpFundTotal, tierResults,
    totEqDep, totLPIn, totLPCalled, totGPCalled, totGPIn,
    totGAShortfall, lpActualCapital, gpActualCapital,
    totSaleProc, totExitVal, totDebtRepaid, totSellingCosts,
    totOpCF, totNetOpCF, pool, totAMFee, totPMFee, totFees, totGA,
    totRefi, totRefiLP, totRefiGP,
    gpEntity, gpCumData, gpNetTotal, gpBreakeven,
    promPP, drawsPP, rocPP, coInvPP, totalPP, netPP,
    partnerMonthly, partnerCum,
    totPartnerSal,
    monthly, noiChart, fundCFAnnual, deplCurve, gaMonthly, gaChart,
    waterfall: [
      { name: "LP Capital", value: lpROC, fill: "#2980B9" },
      { name: "LP Pref", value: lpPref, fill: "#1A5276" },
      ...(totRefiLP > 0 ? [{ name: "LP Refi", value: totRefiLP, fill: "#48C9B0" }] : []),
      ...tierResults.map((t, i) => ({ name: `LP T${i + 4}`, value: t.lp, fill: ["#5DADE2", "#3498DB", "#2471A3"][i] || "#5DADE2" })),
      { name: "GP Co-inv", value: gpROC, fill: "#8B7536" },
      ...(gpCatchUp > 0 ? [{ name: "GP Catch-up", value: gpCatchUp, fill: "#A08040" }] : []),
      ...(totRefiGP > 0 ? [{ name: "GP Refi", value: totRefiGP, fill: "#A08040" }] : []),
      ...tierResults.map((t, i) => ({ name: `GP T${i + 4}`, value: t.gp, fill: [C.gold, "#D4AF37", "#B8860B"][i] || C.gold })),
    ],
  };
}

// ── DEAL ANALYZER ───────────────────────────────────────────────────────────
// Takes uploaded deal financials + fund assumptions → returns full analysis.
// Supports multi-year historical data (T12s, rent rolls, operating statements).

export function analyzeDeal(deal, fundAssumptions = {}) {
  const assumptions = { ...DEFAULT_ASSUMPTIONS, ...fundAssumptions };

  // Build asset from deal financials
  const financials = deal.financials || [];

  // Sort by period to get chronological order
  const sorted = [...financials].sort((a, b) => {
    const da = a.period_start || a.year || 0;
    const db = b.period_start || b.year || 0;
    return da < db ? -1 : da > db ? 1 : 0;
  });

  // Extract NOI history for growth trend analysis
  const noiHistory = sorted
    .filter(f => f.parsed && f.parsed.noi != null)
    .map(f => ({
      year: f.year || new Date(f.period_start).getFullYear(),
      noi: f.parsed.noi,
      revenue: f.parsed.revenue || f.parsed.egi || 0,
      expenses: f.parsed.expenses || 0,
      occupancy: f.parsed.occupancy,
      units: f.parsed.units,
    }));

  // Compute trailing averages
  const latestFinancial = sorted[sorted.length - 1]?.parsed || {};
  const noi = latestFinancial.noi || 0;
  const price = deal.price || (noi / (assumptions.exitCapRate || 0.075));
  const capRate = price > 0 ? noi / price : 0;

  // Compute historical NOI growth (CAGR across available years)
  let noiGrowth = assumptions.exitCapRate > 0 ? 0.03 : 0.03; // default 3%
  if (noiHistory.length >= 2) {
    const first = noiHistory[0];
    const last = noiHistory[noiHistory.length - 1];
    const years = last.year - first.year;
    if (years > 0 && first.noi > 0 && last.noi > 0) {
      noiGrowth = Math.pow(last.noi / first.noi, 1 / years) - 1;
    }
  }

  // NOI margin from latest
  const noiMargin = latestFinancial.revenue > 0
    ? noi / latestFinancial.revenue
    : latestFinancial.noi_margin || 0.525;

  // Build the asset for the model
  const asset = {
    name: deal.name || "Uploaded Deal",
    price: price,
    cap: capRate,
    growth: noiGrowth,
    startMonth: deal.startMonth || 1,
    noiMargin: noiMargin,
    scope: "scenario",
  };

  // Run the full model with this single asset
  const modelInput = {
    ...assumptions,
    assets: [asset],
    hires: assumptions.hires || [],
    overhead: assumptions.overhead || [],
    oneTime: assumptions.oneTime || [],
    partnerSalaries: assumptions.partnerSalaries || [],
    promoteTiers: assumptions.promoteTiers || DEF_PROMOTE_TIERS,
  };

  const result = run(modelInput);

  // Build historical analysis
  const historicalAnalysis = {
    yearsOfData: noiHistory.length,
    noiHistory,
    noiCAGR: noiGrowth,
    avgOccupancy: noiHistory.length > 0
      ? noiHistory.filter(h => h.occupancy).reduce((s, h) => s + h.occupancy, 0) /
        noiHistory.filter(h => h.occupancy).length || null
      : null,
    revenueGrowth: null,
    expenseGrowth: null,
  };

  // Revenue CAGR
  const revHistory = noiHistory.filter(h => h.revenue > 0);
  if (revHistory.length >= 2) {
    const first = revHistory[0], last = revHistory[revHistory.length - 1];
    const years = last.year - first.year;
    if (years > 0) historicalAnalysis.revenueGrowth = Math.pow(last.revenue / first.revenue, 1 / years) - 1;
  }

  // Expense CAGR
  const expHistory = noiHistory.filter(h => h.expenses > 0);
  if (expHistory.length >= 2) {
    const first = expHistory[0], last = expHistory[expHistory.length - 1];
    const years = last.year - first.year;
    if (years > 0) historicalAnalysis.expenseGrowth = Math.pow(last.expenses / first.expenses, 1 / years) - 1;
  }

  return {
    deal: {
      ...deal,
      computedPrice: price,
      computedCapRate: capRate,
      computedNOIGrowth: noiGrowth,
      computedNOIMargin: noiMargin,
    },
    asset,
    historicalAnalysis,
    modelResult: {
      lpIRR: result.lpIRR,
      lpMOIC: result.lpMOIC,
      lpROC: result.lpROC,
      lpPref: result.lpPref,
      lpResid: result.lpResid,
      lpTotal: result.lpTotal,
      gpPromote: result.gpPromote,
      gpFundTotal: result.gpFundTotal,
      tierResults: result.tierResults,
      totSaleProc: result.totSaleProc,
      totExitVal: result.totExitVal,
      totOpCF: result.totOpCF,
      pool: result.pool,
      assetR: result.assetR,
    },
    // Sensitivity grid: LP IRR across exit cap × NOI growth
    sensitivity: buildSensitivityGrid(asset, assumptions),
  };
}

// ── SENSITIVITY GRID ────────────────────────────────────────────────────────
function buildSensitivityGrid(asset, assumptions) {
  const exitCaps = [0.055, 0.060, 0.065, 0.070, 0.075, 0.080, 0.085, 0.090];
  const growthRates = [0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08];
  const grid = [];

  for (const ec of exitCaps) {
    const row = { exitCap: ec, values: {} };
    for (const gr of growthRates) {
      const testAsset = { ...asset, growth: gr };
      const input = {
        ...assumptions,
        exitCapRate: ec,
        assets: [testAsset],
        hires: assumptions.hires || [],
        overhead: assumptions.overhead || [],
        oneTime: assumptions.oneTime || [],
        partnerSalaries: assumptions.partnerSalaries || [],
        promoteTiers: assumptions.promoteTiers || DEF_PROMOTE_TIERS,
      };
      const r = run(input);
      row.values[gr] = { lpIRR: r.lpIRR, lpMOIC: r.lpMOIC, gpPromote: r.gpPromote };
    }
    grid.push(row);
  }

  return { exitCaps, growthRates, grid };
}

// ── DEAL COMPARISON ─────────────────────────────────────────────────────────
export function compareDeals(deals, fundAssumptions = {}) {
  return deals.map(deal => analyzeDeal(deal, fundAssumptions));
}
