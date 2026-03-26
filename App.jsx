import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, AreaChart, Area, ComposedChart } from "recharts";

const C = {
  navy:"#160D3C", dark:"#09060F", mid:"#261870",
  gold:"#FF5EAA", goldDim:"rgba(255,94,170,0.45)", goldFaint:"rgba(255,94,170,0.09)",
  white:"#FFFFFF", whDim:"rgba(255,255,255,0.55)", whFaint:"rgba(255,255,255,0.07)",
  green:"#00E5A0", greenL:"rgba(0,229,160,0.14)",
  red:"#FF5470",   redL:"rgba(255,84,112,0.14)",
  blue:"#4FC3F7",  blueL:"rgba(79,195,247,0.14)",
  border:"rgba(255,94,170,0.18)",
};

// ── DEFAULT STATE ─────────────────────────────────────────────────────────────
const EMPTY_ASSET_ARRAYS={slipTypes:[],strUnits:[],otherRevenue:[],mgmtFees:[],capexSchedule:[]};
const DEF_ASSETS = [
  {name:"Asset 1",price:15000000,cap:.070,growth:.07,startMonth:6, noiMargin:.525, scope:"global",...EMPTY_ASSET_ARRAYS},
  {name:"Asset 2",price:12000000,cap:.070,growth:.07,startMonth:9, noiMargin:.525, scope:"global",...EMPTY_ASSET_ARRAYS},
  {name:"Asset 3",price:18000000,cap:.075,growth:.06,startMonth:12,noiMargin:.525, scope:"global",...EMPTY_ASSET_ARRAYS},
  {name:"Asset 4",price:20000000,cap:.080,growth:.05,startMonth:15,noiMargin:.525, scope:"global",...EMPTY_ASSET_ARRAYS},
  {name:"Asset 5",price:16000000,cap:.082,growth:.05,startMonth:18,noiMargin:.525, scope:"global",...EMPTY_ASSET_ARRAYS},
  {name:"Asset 6",price:14000000,cap:.081,growth:.05,startMonth:21,noiMargin:.525, scope:"global",...EMPTY_ASSET_ARRAYS},
  {name:"Asset 7",price:14000000,cap:.075,growth:.05,startMonth:24,noiMargin:.525, scope:"global",...EMPTY_ASSET_ARRAYS},
  {name:"Asset 8",price:12000000,cap:.078,growth:.05,startMonth:27,noiMargin:.525, scope:"global",...EMPTY_ASSET_ARRAYS},
];

const DEF_HIRES = [
  {role:"HR Manager",               salary:95000, start:1,  alloc:1.00, scope:"global"},
  {role:"Controller",               salary:130000,start:7,  alloc:1.00, scope:"global"},
  {role:"Staff Accountant",         salary:75000, start:7,  alloc:1.00, scope:"global"},
  {role:"IT Manager (50% G&A)",     salary:55000, start:13, alloc:0.50, scope:"global"},
  {role:"Executive Assistant",      salary:65000, start:13, alloc:1.00, scope:"global"},
  {role:"Regional Ops Mgr #1",      salary:135000,start:15, alloc:1.00, scope:"scenario"},
  {role:"Acquisitions Analyst",     salary:80000, start:15, alloc:1.00, scope:"scenario"},
  {role:"Maint & Capital Coord.",   salary:72000, start:19, alloc:1.00, scope:"scenario"},
  {role:"Training & Standards(80%)",salary:64000, start:19, alloc:0.80, scope:"scenario"},
  {role:"Regional Ops Mgr #2",      salary:135000,start:21, alloc:1.00, scope:"scenario"},
];

const DEF_OVERHEAD = [
  // label, annual $, start, end (0=fund end), rampMo, growth/yr, ramps w/ deals
  {label:"Legal & Compliance",    annual:55000, start:1,  end:0, rampMo:6,  growth:.02, ramps:false, scope:"global"},
  {label:"Audit & Tax",           annual:42000, start:1,  end:0, rampMo:12, growth:.02, ramps:false, scope:"global"},
  {label:"D&O / EPLI Insurance",  annual:32000, start:1,  end:0, rampMo:3,  growth:.02, ramps:false, scope:"global"},
  {label:"Accounting Software",   annual:18000, start:1,  end:0, rampMo:3,  growth:.00, ramps:false, scope:"global"},
  {label:"Travel — Acquisitions", scope:"scenario", annual:45000, start:1, end:24, rampMo:6,  growth:.02, ramps:false},
  {label:"Travel — Operations",  scope:"scenario", annual:28000, start:6,  end:0, rampMo:12, growth:.02, ramps:false},
  {label:"Technology / Data Room", scope:"scenario",annual:15000, start:1,  end:0, rampMo:6,  growth:.00, ramps:false},
  {label:"Office / Utilities",  scope:"scenario",  annual:18000, start:3,  end:0, rampMo:6,  growth:.02, ramps:false},
  {label:"Marketing / Comms",  scope:"scenario",   annual:12000, start:6,  end:0, rampMo:9,  growth:.01, ramps:false},
  {label:"Contingency",  scope:"scenario",         annual:12000, start:1,  end:0, rampMo:1,  growth:.02, ramps:false},
  {label:"ASAP Platform",  scope:"scenario",       annual:3000,  start:6,  end:0, rampMo:1,  growth:.00, ramps:true },
];

// One-time / irregular expenses: hit in a specific month, no recurrence
const DEF_ONE_TIME = [
  {label:"Entity Setup & Formation",  amount:18000, month:1,  category:"Legal",  scope:"global"},
  {label:"Office Build-Out",          amount:35000, month:3,  category:"CapEx",  scope:"global"},
  {label:"HR / Payroll System Setup", amount:8000,  month:3,  category:"Tech",   scope:"global"},
  {label:"CRM / Software Onboarding", amount:12000, month:6,  category:"Tech",   scope:"scenario"},
  {label:"Fund Launch Marketing",     amount:15000, month:1,  category:"Marketing", scope:"scenario"},
  {label:"Year 2 Compliance Review",  amount:22000, month:13, category:"Legal",  scope:"global"},
];


const DEF_PARTNER_SALARIES = [
  {role:"Managing Partner / CEO",  salary:250000, start:1},
  {role:"Managing Partner / COO",  salary:220000, start:1},
  {role:"Managing Partner / CIO",  salary:220000, start:1},
];

// Multi-tier promote structure: each tier has optional IRR/MOIC hurdles and LP/GP splits
// Dual trigger: whichever threshold reached first advances to next tier
const DEF_PROMOTE_TIERS = [
  { irrHurdle: null, moicHurdle: null, lpSplit: 0.80, gpSplit: 0.20 },
];

// Preset: institutional multi-tier waterfall
const MULTI_TIER_PRESET = [
  { irrHurdle: 0.16, moicHurdle: 1.80, lpSplit: 0.80, gpSplit: 0.20 },
  { irrHurdle: 0.19, moicHurdle: 2.25, lpSplit: 0.70, gpSplit: 0.30 },
  { irrHurdle: null, moicHurdle: null, lpSplit: 0.60, gpSplit: 0.40 },
];

const DEFAULT = {
  fundTerm:7, debtPct:.60, interestRate:.065, amortYears:25,
  exitCapRate:.075, saleCosts:.02, carry:.20, prefReturn:.07,
  gpPct:0, amFee:0, pmFee:0, benefitsRate:.22, salaryGrowth:.03,
  partners:3, compoundPref:false, catchUp:false,
  // Refinancing: optional mid-hold refi to return capital to LP
  refiEnabled:false, refiMonth:36, refiLTV:.70, refiRate:.065, refiCosts:.01,
  assets:DEF_ASSETS, hires:DEF_HIRES, overhead:DEF_OVERHEAD, oneTime:DEF_ONE_TIME,
  partnerSalaries:DEF_PARTNER_SALARIES, promoteTiers:DEF_PROMOTE_TIERS,
};

// ── MATH ──────────────────────────────────────────────────────────────────────
function pmt(r,n,pv){ return r===0?pv/n:(pv*r*Math.pow(1+r,n))/(Math.pow(1+r,n)-1); }
function fvLoan(r,n,pmt,pv){ return pv*Math.pow(1+r,n)-pmt*(Math.pow(1+r,n)-1)/r; }
function irr(cfs,g=.1){
  let r=g;
  for(let i=0;i<300;i++){
    let v=0,d=0;
    cfs.forEach((c,t)=>{v+=c/Math.pow(1+r,t);d-=t*c/Math.pow(1+r,t+1);});
    if(Math.abs(d)<1e-12)break;
    const nr=r-v/d;
    if(Math.abs(nr-r)<1e-9)return nr;
    r=nr;
  }
  return r;
}

// Given a target IRR, compute total LP distributions needed across the fund life.
// Uses the annual approximation: Year 0 = -lpCapital, Years 1..N-1 = annualInterim, Year N = terminal.
function totalLPForIRR(targetIRR, lpCapital, annualInterim, N) {
  if (targetIRR <= -0.99) return Infinity;
  let pvInterim = 0;
  for (let y = 1; y < N; y++) pvInterim += annualInterim / Math.pow(1 + targetIRR, y);
  const terminal = (lpCapital - pvInterim) * Math.pow(1 + targetIRR, N);
  return annualInterim * (N - 1) + terminal;
}

// ── PER-ASSET BOTTOMS-UP REVENUE HELPERS ─────────────────────────────────────
function computeAssetGrossRevenue(asset, y){
  let gr=0;
  (asset.slipTypes||[]).forEach(s=>{
    if(!(s.count>0))return;
    const occ=s.occupancy!=null?s.occupancy:.85;
    const g=s.growth!=null?s.growth:(asset.growth||.03);
    const gf=y>1?Math.pow(1+g,y-1):1;
    gr+=(s.count||0)*(s.rate||0)*12*occ*gf;
  });
  (asset.strUnits||[]).forEach(s=>{
    if(!(s.units>0))return;
    const occ=s.occupancy!=null?s.occupancy:.65;
    const g=s.growth!=null?s.growth:(asset.growth||.03);
    const gf=y>1?Math.pow(1+g,y-1):1;
    gr+=(s.units||0)*(s.adr||0)*365*occ*gf;
  });
  (asset.otherRevenue||[]).forEach(o=>{
    const g=o.growth!=null?o.growth:(asset.growth||.03);
    const gf=y>1?Math.pow(1+g,y-1):1;
    gr+=(o.annual||0)*gf;
  });
  return gr;
}
function computeMgmtFees(asset, grossRevenue){
  return (asset.mgmtFees||[]).reduce((s,f2)=>{
    return s+(f2.type==="pct"?grossRevenue*(f2.amount||0):(f2.amount||0));
  },0);
}
function hasRevenueRows(asset){
  return (asset.slipTypes||[]).some(s=>s.count>0)||
         (asset.strUnits||[]).some(s=>s.units>0)||
         (asset.otherRevenue||[]).some(o=>o.annual>0);
}

// ── MODEL ─────────────────────────────────────────────────────────────────────
function run(a){
  const {assets,hires,overhead,fundTerm,debtPct,interestRate,amortYears,
    exitCapRate,saleCosts,carry,prefReturn,gpPct,amFee,pmFee,
    benefitsRate,salaryGrowth,partners,partnerSalaries,oneTime=[],
    compoundPref=false,catchUp=false,promoteTiers=DEF_PROMOTE_TIERS,
    refiEnabled=false,refiMonth=36,refiLTV=.70,refiRate=.065,refiCosts=.01}=a;
  const MO=fundTerm*12;

  // G&A monthly
  const gaMonthly=Array.from({length:MO},(_,i)=>{
    const mo=i+1,yr=Math.floor(i/12);
    let sal=0;
    hires.forEach(h=>{
      if(mo>=h.start){
        const y=Math.floor((mo-h.start)/12);
        sal+=(h.salary*Math.pow(1+salaryGrowth,y)/12)*h.alloc;
      }
    });
    // Partner base salaries (separate from promote/draws)
    let partnerSal=0;
    (partnerSalaries||[]).forEach(p=>{
      if(mo>=p.start){
        const y=Math.floor((mo-p.start)/12);
        partnerSal+=(p.salary*Math.pow(1+salaryGrowth,y)/12);
      }
    });
    sal+=partnerSal;
    const ben=sal*benefitsRate;
    let fix=0;
    overhead.forEach(o=>{
      if(mo<o.start) return;
      if(o.end&&o.end>0&&mo>o.end) return;
      let base=o.annual;
      if(o.ramps){
        const props=assets.filter(x=>x.startMonth<=mo).length;
        base=props*250*12;
      }
      // Ramp: linear scale from 0 to full run-rate over rampMo months from start
      const ramp=o.rampMo&&o.rampMo>1 ? Math.min(1,(mo-o.start+1)/o.rampMo) : 1;
      const annualGrown=base*Math.pow(1+o.growth,yr);
      fix+=(annualGrown/12)*ramp;
    });
    // One-time expenses: hit in their specific month only
    let oneTimeHit=0;
    (oneTime||[]).forEach(e=>{ if(e.month===mo) oneTimeHit+=e.amount; });
    return{mo,sal,partnerSal,ben,personnel:sal+ben,fix,oneTimeHit,
      total:sal+ben+fix+oneTimeHit,partnerSalCost:partnerSal*(1+benefitsRate)};
  });

  // Asset calcs
  const refiYr=refiEnabled?refiMonth/12:null; // fractional year of refi
  const assetR=assets.map(asset=>{
    const eq=asset.price*(1-debtPct),debt=asset.price*debtPct;
    const annDS=pmt(interestRate,amortYears,debt);
    const margin=asset.noiMargin||.525;

    // Bottoms-up NOI: use revenue rows if any are defined, else cap-rate fallback
    const useBottomsUp=hasRevenueRows(asset);
    let noi,egi,grossRevYr1;
    if(useBottomsUp){
      const grossRev=Array.from({length:fundTerm+1},(_,y)=>y===0?0:computeAssetGrossRevenue(asset,y));
      grossRevYr1=grossRev[1]||0;
      const mgmtFeeArr=grossRev.map(gr=>computeMgmtFees(asset,gr));
      noi=grossRev.map((gr,y)=>y===0?0:gr*margin-mgmtFeeArr[y]);
      egi=grossRev; // EGI = gross revenue (before mgmt fees and NOI margin)
    }else{
      // Cap-rate fallback: NOI_base = price×cap×growth^(y-1); subtract mgmt fees if defined
      const noiBase=Array.from({length:fundTerm+1},(_,y)=>y===0?0:asset.price*asset.cap*Math.pow(1+asset.growth,y-1));
      egi=noiBase.map(n=>margin>0?n/margin:n);  // EGI proxy for PM fee and mgmt-fee-pct calc
      grossRevYr1=egi[1]||0;
      const mgmtFeeArr=egi.map(gr=>computeMgmtFees(asset,gr));
      noi=noiBase.map((n,y)=>y===0?0:n-mgmtFeeArr[y]);
    }

    // Refinancing: if enabled and asset was acquired before refiMonth
    let refiProceeds=0, newDebt=0, newAnnDS=0, refiYearIdx=0;
    const assetRefiEligible=refiEnabled&&asset.startMonth<refiMonth;
    if(assetRefiEligible){
      refiYearIdx=Math.ceil((refiMonth-asset.startMonth)/12);
      // Use the computed NOI array (already includes mgmt fees) for refi valuation
      const refiNOI=noi[Math.min(refiYearIdx,fundTerm)]||0;
      const appraisedVal=refiNOI/exitCapRate;
      newDebt=appraisedVal*refiLTV;
      const yrsFromAcq=(refiMonth-asset.startMonth)/12;
      const oldLB=Math.abs(fvLoan(interestRate,Math.round(yrsFromAcq),annDS,debt));
      refiProceeds=newDebt-oldLB-appraisedVal*refiCosts;
      if(refiProceeds<0)refiProceeds=0;
      newAnnDS=pmt(refiRate,amortYears,newDebt);
    }

    const ecf=noi.map((n,y)=>{
      if(y===0)return -eq;
      const ds=assetRefiEligible&&y>=refiYearIdx?newAnnDS:annDS;
      return n-ds-egi[y]*pmFee;
    });
    // Add refi cash-out proceeds in refi year
    if(assetRefiEligible&&refiYearIdx<=fundTerm){
      ecf[refiYearIdx]=(ecf[refiYearIdx]||0)+refiProceeds;
    }
    // CapEx: deduct from levered ECF in the specified hold year
    (asset.capexSchedule||[]).forEach(cx=>{
      const yr=Math.round(cx.year||1);
      if(yr>=1&&yr<=fundTerm) ecf[yr]=(ecf[yr]||0)-(cx.amount||0);
    });

    const exitNOI=noi[fundTerm];
    const exitVal=exitNOI/exitCapRate;
    const exitLB=assetRefiEligible
      ? Math.abs(fvLoan(refiRate,fundTerm-Math.round((refiMonth-asset.startMonth)/12),newAnnDS,newDebt))
      : Math.abs(fvLoan(interestRate,fundTerm,annDS,debt));
    const saleNet=exitVal-exitLB-exitVal*saleCosts;
    ecf[fundTerm]+=saleNet;
    const eqIRR=irr(ecf);
    const moic=ecf.slice(1).reduce((s,v)=>s+v,0)/eq;
    return{...asset,eq,debt,annDS,noi,egi,saleNet,exitVal,lb:exitLB,irr:eqIRR,moic,
      refiProceeds,newDebt,newAnnDS,assetRefiEligible,useBottomsUp,grossRevYr1};
  });

  // Monthly portfolio
  const totEqDep=assets.reduce((s,x)=>s+x.price*(1-debtPct),0);
  const totGPIn=totEqDep*gpPct,totLPIn=totEqDep*(1-gpPct);

  // Total refi proceeds across all eligible assets (distributed in refiMonth)
  const totRefiProceeds=assetR.reduce((s,x)=>s+(x.refiProceeds||0),0);

  const monthly=Array.from({length:MO},(_,i)=>{
    const mo=i+1;
    let noi=0,egi=0,invEq=0,ds=0;
    assets.forEach((x,ai)=>{
      if(mo<x.startMonth)return;
      const ar=assetR[ai];
      // Look up the annual NOI/EGI for this month's year (ar.noi already includes mgmt fees)
      const moFrac=mo-x.startMonth; // months elapsed since acquisition
      const yearIdx=Math.min(Math.floor(moFrac/12)+1,fundTerm);
      const moNoi=ar.noi[yearIdx]/12;
      const moEgi=ar.egi[yearIdx]/12;
      noi+=moNoi;
      egi+=moEgi;
      invEq+=x.price*(1-debtPct);
      // After refi: use new debt service
      if(ar.assetRefiEligible&&mo>=refiMonth){
        ds+=Math.abs(ar.newAnnDS)/12;
      }else{
        ds+=Math.abs(pmt(interestRate,amortYears,x.price*debtPct))/12;
      }
    });
    const amFeeM=invEq*amFee/12;
    const pmFeeM=egi*pmFee;
    const netOpCF=noi-ds-pmFeeM-amFeeM;
    const lpCall=assets.reduce((s,x)=>x.startMonth===mo?s+x.price*(1-debtPct)*(1-gpPct):s,0);
    const gpCall=assets.reduce((s,x)=>x.startMonth===mo?s+x.price*(1-debtPct)*gpPct:s,0);
    // Refi distribution in the refi month
    const refiDist=refiEnabled&&mo===refiMonth?totRefiProceeds:0;
    const lpRefiDist=refiDist*(1-gpPct);
    const gpRefiDist=refiDist*gpPct;
    return{mo,noi,invEq,ds,amFeeM,pmFeeM,netOpCF,lpCall,gpCall,
      refiDist,lpRefiDist,gpRefiDist,
      ga:gaMonthly[i].total};
  });

  // Totals — declare fees/GA first so shortfall calc can use them
  const totLPCalled=monthly.reduce((s,x)=>s+x.lpCall,0);
  const totGPCalled=monthly.reduce((s,x)=>s+x.gpCall,0);
  const totSaleProc=assetR.reduce((s,x)=>s+x.saleNet,0);
  const totExitVal=assetR.reduce((s,x)=>s+x.exitVal,0);
  const totDebtRepaid=assetR.reduce((s,x)=>s+x.lb,0);
  const totSellingCosts=assetR.reduce((s,x)=>s+x.exitVal*saleCosts,0);
  const totOpCF=monthly.reduce((s,x)=>s+Math.max(0,x.netOpCF),0);  // positive months only — for waterfall distributable pool
  const totNetOpCF=monthly.reduce((s,x)=>s+x.netOpCF,0);          // all months — for display
  const totAMFee=monthly.reduce((s,x)=>s+x.amFeeM,0);
  const totPMFee=monthly.reduce((s,x)=>s+x.pmFeeM,0);
  const totFees=totAMFee+totPMFee;
  const totGA=gaMonthly.reduce((s,x)=>s+x.total,0);
  const totPartnerSal=gaMonthly.reduce((s,x)=>s+(x.partnerSalCost||0),0);

  // G&A shortfall: LP funds the gap when G&A exceeds fee income.
  // Shortfall is an additional LP capital contribution — added to LP basis,
  // returned to LP first in Tier 1 ROC before pref or promote.
  const totGAShortfall = Math.max(0, totGA - totAMFee - totPMFee);
  const lpActualCapital = totLPCalled + totGAShortfall;
  const gpActualCapital = totGPCalled; // GP basis = equity co-invest only

  // Total refi distributions
  const totRefiLP=monthly.reduce((s,x)=>s+(x.lpRefiDist||0),0);
  const totRefiGP=monthly.reduce((s,x)=>s+(x.gpRefiDist||0),0);
  const totRefi=totRefiLP+totRefiGP;

  // WATERFALL — multi-tier with dual trigger (IRR + MOIC thresholds)
  // Refi proceeds go directly to LP/GP as return of capital — not through waterfall
  // They reduce the distributable pool but are counted toward LP total returns
  const pool=totSaleProc+totOpCF;
  let rem=pool;

  // Tier 1: LP gets back equity + funded shortfall; GP gets back equity only
  const lpROC=Math.min(lpActualCapital,rem); rem-=lpROC;
  const gpROC=Math.min(gpActualCapital,rem); rem-=gpROC;

  // Tier 2: LP preferred return — simple or compound
  const lpPrefDue = compoundPref
    ? lpActualCapital * (Math.pow(1+prefReturn, fundTerm) - 1)
    : lpActualCapital * prefReturn * fundTerm;
  const lpPref=Math.min(lpPrefDue,rem); rem-=lpPref;

  // Tier 3: GP catch-up (if enabled)
  // GP catches up to carry% using catch-up target derived from carry setting
  let gpCatchUp=0;
  if(catchUp){
    const cuAmt = Math.min(rem, (carry * lpPref) / (1 - carry));
    gpCatchUp = cuAmt;
    rem -= cuAmt;
  }

  // Interim LP distributions (for IRR threshold calculation)
  const annualInterimLP=(totOpCF*(1-gpPct))/(fundTerm);

  // Promote tiers — distribute remaining pool according to LP/GP splits
  // Dual trigger: advance to next tier when EITHER IRR or MOIC threshold is reached (whichever first)
  let lpDistTotal = lpROC + lpPref;  // LP waterfall total so far
  let gpPromote = gpCatchUp;
  let lpResid = 0;

  const tierResults = [];
  for (const tier of promoteTiers) {
    if (rem <= 0) {
      tierResults.push({ ...tier, lp: 0, gp: 0 });
      continue;
    }
    if (tier.irrHurdle == null && tier.moicHurdle == null) {
      // No hurdle — final tier, distribute everything remaining
      const lpAmt = rem * tier.lpSplit;
      const gpAmt = rem * tier.gpSplit;
      lpDistTotal += lpAmt;
      gpPromote += gpAmt;
      lpResid += lpAmt;
      tierResults.push({ ...tier, lp: lpAmt, gp: gpAmt });
      rem = 0;
    } else {
      // Dual trigger: find LP total at each threshold, take the minimum
      let lpTarget = Infinity;
      if (tier.moicHurdle != null) {
        lpTarget = Math.min(lpTarget, tier.moicHurdle * lpActualCapital);
      }
      if (tier.irrHurdle != null) {
        const lpForIRR = totalLPForIRR(tier.irrHurdle, lpActualCapital, annualInterimLP, fundTerm);
        if (isFinite(lpForIRR) && lpForIRR > 0) {
          lpTarget = Math.min(lpTarget, lpForIRR);
        }
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

  const lpTotal=lpROC+lpPref+lpResid+totRefiLP;  // include refi distributions
  const gpFundTotal=gpROC+gpPromote+totRefiGP;
  const lpMOIC=lpTotal/Math.max(1,lpActualCapital);

  // LP IRR — annual approximation, with refi distribution in its year
  const lpCF=Array(fundTerm+1).fill(0);
  lpCF[0]=-lpActualCapital;
  for(let y=1;y<fundTerm;y++)lpCF[y]=annualInterimLP;
  lpCF[fundTerm]=(lpROC+lpPref+lpResid)-annualInterimLP*(fundTerm-1);
  // Add refi LP distribution in the refi year
  if(refiEnabled&&totRefiLP>0){
    const refiYrIdx=Math.min(fundTerm,Math.ceil(refiMonth/12));
    lpCF[refiYrIdx]+=totRefiLP;
  }
  const lpIRR=irr(lpCF);

  // ── GP ENTITY cash flow (month by month)
  // GP earns: AM fees + PM fees (received as fee income from fund)
  // GP earns: promote at exit (month 84)
  // GP earns: shortfall ROC returned at exit (from waterfall tier 1)
  // GP spends: co-invest capital calls + G&A
  // Note: netOpCF is already net of AM+PM fees, so opDist here is GP's share of residual op CF
  const gpEntity=monthly.map((m,i)=>{
    const fees=m.amFeeM+m.pmFeeM;             // fee income paid to GP by fund each month
    const opDist=Math.max(0,m.netOpCF)*gpPct; // GP's pro-rata share of residual op CF
    const coInvest=-m.gpCall;                  // co-invest equity outflow at deal close
    const ga=-gaMonthly[i].total;              // G&A outflow (personnel + overhead + partner sals)
    const refiGP=m.gpRefiDist||0;             // GP share of refi cash-out
    const net=fees+opDist+coInvest+ga+refiGP;
    return{mo:m.mo,fees,opDist,coInvest,ga,refiGP,net,promote:0,shortfallROC:0};
  });
  // Month 84: promote + shortfall ROC returned from waterfall
  gpEntity[MO-1].promote=gpPromote;
  gpEntity[MO-1].net+=gpPromote;  // GP gets promote only; shortfall was LP capital, returned to LP in Tier 1

  // Cumulative GP position
  let gpCum=0;
  const gpCumData=gpEntity.map(x=>{gpCum+=x.net;return{mo:x.mo,cum:gpCum};});
  const gpNetTotal=gpCumData[MO-1].cum;
  const gpBreakeven=gpCumData.find(x=>x.cum>=0)?.mo??null;

  // Per-partner — capital at risk includes equity co-invest + funded G&A shortfall
  const promPP=gpPromote/partners;
  const opDrawsTotal=gpEntity.reduce((s,x)=>s+Math.max(0,x.net-(x.promote||0)-(x.shortfallROC||0)),0);
  const drawsPP=opDrawsTotal/partners;
  const rocPP=gpROC/partners;                        // includes shortfall recovery
  const coInvPP=totGPCalled/partners;                 // GP equity co-invest only
  const totalPP=promPP+drawsPP+rocPP;
  const netPP=totalPP-coInvPP;                        // net after all capital deployed

  // Monthly partner draw data
  const partnerMonthly=gpEntity.map(x=>({
    mo:x.mo,
    draw:Math.max(0,x.net-(x.promote||0))/partners,
    promote:(x.promote||0)/partners,
  }));
  let pCum=0;
  const partnerCum=partnerMonthly.map(x=>{pCum+=x.draw+x.promote;return{mo:x.mo,cum:pCum};});

  // Portfolio NOI chart — sums monthly NOI by year, respects asset close timing
  const noiChart=Array.from({length:fundTerm},(_,y)=>{
    const s=y*12,e=(y+1)*12;
    return{year:`Yr ${y+1}`,noi:monthly.slice(s,e).reduce((t,x)=>t+x.noi,0)};
  });

  // Fund CF by year
  const fundCFAnnual=Array.from({length:fundTerm},(_,y)=>{
    const s=y*12,e=(y+1)*12;
    const slice=monthly.slice(s,e);
    return{
      year:`Yr ${y+1}`,
      lpCalls:-slice.reduce((t,x)=>t+x.lpCall,0),
      opCF:slice.reduce((t,x)=>t+x.netOpCF,0),
      noi:slice.reduce((t,x)=>t+x.noi,0),
      refiDist:slice.reduce((t,x)=>t+(x.refiDist||0),0),
    };
  });

  // Deployment curve
  const deplCurve=monthly.map(m=>({
    mo:m.mo,
    lp:assets.filter(x=>x.startMonth<=m.mo).reduce((s,x)=>s+x.price*(1-debtPct)*(1-gpPct),0),
  }));

  // G&A breakdown
  const gaChart=gaMonthly.map(x=>({mo:x.mo,personnel:x.personnel,fix:x.fix}));

  return{
    assetR,lpIRR,lpMOIC,lpROC,lpPref,lpResid,lpTotal,
    gpROC,gpPromote,gpCatchUp,gpFundTotal,tierResults,
    totEqDep,totLPIn,totLPCalled,totGPCalled,totGPIn,
    totGAShortfall,lpActualCapital,gpActualCapital,
    totSaleProc,totExitVal,totDebtRepaid,totSellingCosts,
    totOpCF,totNetOpCF,pool,totAMFee,totPMFee,totFees,totGA,
    totRefi,totRefiLP,totRefiGP,
    gpEntity,gpCumData,gpNetTotal,gpBreakeven,
    promPP,drawsPP,rocPP,coInvPP,totalPP,netPP,
    partnerMonthly,partnerCum,
    totPartnerSal,
    monthly,noiChart,fundCFAnnual,deplCurve,gaMonthly,gaChart,
    waterfall:[
      {name:"LP Capital", value:lpROC,      fill:"#2980B9"},
      {name:"LP Pref",    value:lpPref,     fill:"#1A5276"},
      ...(totRefiLP>0?[{name:"LP Refi",value:totRefiLP,fill:"#48C9B0"}]:[]),
      ...tierResults.map((t,i)=>({name:`LP T${i+4}`,value:t.lp,fill:["#5DADE2","#3498DB","#2471A3"][i]||"#5DADE2"})),
      {name:"GP Co-inv",  value:gpROC,      fill:"#8B7536"},
      ...(gpCatchUp>0?[{name:"GP Catch-up",value:gpCatchUp,fill:"#A08040"}]:[]),
      ...(totRefiGP>0?[{name:"GP Refi",value:totRefiGP,fill:"#A08040"}]:[]),
      ...tierResults.map((t,i)=>({name:`GP T${i+4}`,value:t.gp,fill:[C.gold,"#D4AF37","#B8860B"][i]||C.gold})),
    ],
  };
}

// ── FORMATTERS ────────────────────────────────────────────────────────────────
const f={
  $:v=>v==null?"—":Math.abs(v)>=1e6?`$${(v/1e6).toFixed(1)}M`:`$${Math.round(v).toLocaleString()}`,
  p:v=>v==null?"—":`${(v*100).toFixed(1)}%`,
  x:v=>v==null?"—":`${v.toFixed(2)}x`,
};

// ── UI ATOMS ──────────────────────────────────────────────────────────────────
const KPI=({label,value,sub,gold})=>(
  <div style={{background:gold?C.gold:C.whFaint,border:`1px solid ${gold?C.gold:C.border}`,
    borderRadius:4,padding:"15px 17px",flex:1,minWidth:120}}>
    <div style={{fontSize:9,letterSpacing:"0.11em",textTransform:"uppercase",
      color:gold?C.navy:C.goldDim,marginBottom:5}}>{label}</div>
    <div style={{fontSize:21,fontWeight:700,color:gold?C.navy:C.white,
      fontFamily:"'Playfair Display',serif",lineHeight:1.1}}>{value}</div>
    {sub&&<div style={{fontSize:9,color:gold?"rgba(31,56,100,.5)":C.goldDim,marginTop:3}}>{sub}</div>}
  </div>
);

const Sli=({label,value,min,max,step,disp,onChange,sub})=>{
  const p=Math.min(100,Math.max(0,((value-min)/(max-min))*100));
  return(
    <div style={{marginBottom:15}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
        <span style={{fontSize:9,color:C.whDim,textTransform:"uppercase",letterSpacing:"0.07em"}}>{label}</span>
        <span style={{fontSize:11,color:C.gold,fontWeight:600}}>{disp(value)}</span>
      </div>
      <div style={{position:"relative",height:3,background:"rgba(255,255,255,0.07)",borderRadius:2}}>
        <div style={{position:"absolute",left:0,width:`${p}%`,height:"100%",background:C.gold,borderRadius:2}}/>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e=>onChange(Number(e.target.value))}
          style={{position:"absolute",top:-7,left:0,width:"100%",height:17,opacity:0,cursor:"pointer",margin:0,padding:0}}/>
      </div>
      {sub&&<div style={{fontSize:9,color:"rgba(255,94,170,.3)",marginTop:2}}>{sub}</div>}
    </div>
  );
};

// Compact colored slider for tables — painted track, no browser default styling
const MiniSlider=({value,min,max,step,onChange,color=C.gold,width=80})=>{
  const pct=Math.min(100,Math.max(0,((value-min)/(max-min))*100));
  return(
    <div style={{position:"relative",height:3,background:"rgba(255,255,255,0.07)",
      borderRadius:2,width,flexShrink:0}}>
      <div style={{position:"absolute",left:0,width:`${pct}%`,height:"100%",
        background:color,borderRadius:2,pointerEvents:"none"}}/>
      <div style={{position:"absolute",left:`calc(${pct}% - 6px)`,top:-4.5,
        width:12,height:12,borderRadius:"50%",background:color,
        pointerEvents:"none",boxShadow:"0 0 4px rgba(0,0,0,0.4)"}}/>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e=>onChange(Number(e.target.value))}
        style={{position:"absolute",top:-7,left:0,width:"100%",height:17,
          opacity:0,cursor:"pointer",margin:0,padding:0}}/>
    </div>
  );
};

const SHdr=({t})=>(
  <div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.gold,
    fontWeight:700,marginBottom:9,paddingBottom:5,borderBottom:`1px solid ${C.border}`}}>{t}</div>
);

const PHdr=({title,sub})=>(
  <div style={{marginBottom:20}}>
    <div style={{fontSize:19,fontWeight:700,color:C.white,fontFamily:"'Playfair Display',serif",marginBottom:2}}>{title}</div>
    {sub&&<div style={{fontSize:11,color:C.goldDim}}>{sub}</div>}
  </div>
);

const Card=({children,style={}})=>(
  <div style={{background:C.whFaint,border:`1px solid ${C.border}`,borderRadius:6,padding:"15px 18px",overflow:"hidden",...style}}>{children}</div>
);

const CT=({c})=>(
  <div style={{fontSize:9,color:C.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:11}}>{c}</div>
);

const TT=({active,payload,label})=>{
  if(!active||!payload?.length)return null;
  return(
    <div style={{background:"rgba(9,6,15,.97)",border:`1px solid ${C.gold}`,
      borderRadius:4,padding:"9px 13px",fontSize:11,fontFamily:"'DM Sans',sans-serif"}}>
      {label&&<div style={{color:C.gold,marginBottom:4,fontWeight:600}}>{label}</div>}
      {payload.map((p,i)=>(
        <div key={i} style={{color:p.color||C.white}}>
          {p.name}: {typeof p.value==="number"?f.$(p.value):p.value}
        </div>
      ))}
    </div>
  );
};

// ── TABS ──────────────────────────────────────────────────────────────────────
const TABS=["Overview","Assets","Waterfall","Fund CF","G&A Model","GP Partners","Sensitivity","Deals"];

// ── APP ───────────────────────────────────────────────────────────────────────
// ── API HELPERS ──────────────────────────────────────────────────────────────
const api = {
  async getScenarios() {
    const res = await fetch('/api/scenarios');
    return res.json();
  },
  async saveScenario(name, data) {
    const res = await fetch('/api/scenarios', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name, data })
    });
    return res.json();
  },
  async deleteScenario(name) {
    await fetch(`/api/scenarios/${encodeURIComponent(name)}`, { method: 'DELETE' });
  },
  async getGlobals() {
    const res = await fetch('/api/globals');
    return res.json();
  },
  async saveGlobals(type, items) {
    const res = await fetch('/api/globals/bulk', {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ type, items })
    });
    return res.json();
  }
};

function splitByScope(items) {
  return {
    global: (items||[]).filter(x => x.scope === "global"),
    scenario: (items||[]).filter(x => x.scope !== "global")
  };
}

function mergeGlobals(scenarioData, globals) {
  if (!globals) return scenarioData;
  const hasAnyGlobals = Object.values(globals).some(arr => arr && arr.length > 0);
  if (!hasAnyGlobals) return scenarioData;
  const merged = { ...scenarioData };
  for (const type of ["assets","hires","overhead","oneTime"]) {
    const scenItems = (scenarioData[type]||[]).filter(x => x.scope !== "global");
    const globalItems = (globals[type]||[]).map(x => ({...x, scope:"global"}));
    merged[type] = [...globalItems, ...scenItems];
  }
  return merged;
}

function GlobalAddModal({type, onConfirm, onClose}){
  const labels={assets:"Asset",hires:"Hire",overhead:"Overhead Item",oneTime:"One-Time Expense"};
  const nameLabel={assets:"Asset Name",hires:"Role / Title",overhead:"Line Item Name",oneTime:"Expense Description"};
  const [name,setName]=useState("");
  const inputRef=useRef(null);
  useEffect(()=>{if(inputRef.current)inputRef.current.focus();},[]);
  if(!type) return null;
  return(
    <div style={{position:"fixed",inset:0,zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",
      background:"rgba(0,0,0,.6)",backdropFilter:"blur(4px)"}}
      onClick={onClose}
      onKeyDown={e=>{if(e.key==="Escape")onClose();}}>
      <div style={{background:C.card,border:`1px solid ${C.gold}`,borderRadius:8,padding:"28px 32px",
        minWidth:340,maxWidth:420,boxShadow:"0 12px 40px rgba(0,0,0,.5)"}}
        onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:11,color:C.gold,fontWeight:700,textTransform:"uppercase",
          letterSpacing:".1em",marginBottom:4}}>Add Global {labels[type]}</div>
        <div style={{fontSize:10,color:C.goldDim,marginBottom:16}}>
          Global items are shared across all scenarios.
        </div>
        <label style={{fontSize:10,color:C.whDim,textTransform:"uppercase",letterSpacing:".06em",
          fontWeight:600,marginBottom:4,display:"block"}}>{nameLabel[type]}</label>
        <input ref={inputRef} value={name} onChange={e=>setName(e.target.value)}
          placeholder={`Enter ${(nameLabel[type]||"name").toLowerCase()}...`}
          onKeyDown={e=>{if(e.key==="Enter"&&name.trim()){e.preventDefault();onConfirm(name.trim());}}}
          style={{width:"100%",background:"rgba(255,255,255,.06)",border:`1px solid rgba(255,94,170,.3)`,
            borderRadius:4,padding:"10px 12px",color:C.white,fontSize:13,outline:"none",
            fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",marginBottom:18}}/>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={onClose}
            style={{padding:"7px 18px",background:"transparent",border:`1px solid rgba(255,255,255,.15)`,
              color:C.whDim,borderRadius:4,fontSize:11,cursor:"pointer"}}>Cancel</button>
          <button onClick={()=>{if(name.trim())onConfirm(name.trim());}}
            disabled={!name.trim()}
            style={{padding:"7px 18px",background:name.trim()?C.gold:"rgba(255,94,170,.3)",
              border:"none",color:C.navy,borderRadius:4,fontSize:11,fontWeight:700,
              cursor:name.trim()?"pointer":"not-allowed",letterSpacing:".04em"}}>
            Add &amp; Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Portal(){
  const [tab,setTab]=useState("Overview");
  const [a,setA]=useState(DEFAULT);
  const [scenarios,setScenarios]=useState({});
  const [globals,setGlobals]=useState({assets:[],hires:[],overhead:[],oneTime:[]});
  const [scenName,setScenName]=useState("Base Case");
  const [showScen,setShowScen]=useState(false);
  const [editingName,setEditingName]=useState(false);
  const [saving,setSaving]=useState(false);
  const [dbReady,setDbReady]=useState(false);
  const [globalModal,setGlobalModal]=useState(null);
  const [presenting,setPresenting]=useState(false);

  useEffect(()=>{
    Promise.all([api.getScenarios(), api.getGlobals()]).then(([rows, g])=>{
      const map={};
      if (Array.isArray(rows)) rows.forEach(r=>{ map[r.name]={...r.data,_savedAt:r.updated_at}; });
      setScenarios(map);
      if (g && typeof g === 'object') {
        const loadedGlobals = {
          assets: g.assets||[], hires: g.hires||[],
          overhead: g.overhead||[], oneTime: g.oneTime||[]
        };
        const hasAny = Object.values(loadedGlobals).some(arr => arr.length > 0);
        if (hasAny) {
          setGlobals(loadedGlobals);
          setA(prev => mergeGlobals(prev, loadedGlobals));
        }
      }
      setDbReady(true);
    }).catch(err=>{
      console.error('Failed to load from database:', err);
      setDbReady(true);
    });
  },[]);

  const persistGlobals = useCallback(async (newA) => {
    const state = newA || a;
    for (const type of ["assets","hires","overhead","oneTime"]) {
      const globalItems = (state[type]||[]).filter(x => x.scope === "global");
      const cleanItems = globalItems.map(({scope,...rest}) => rest);
      await api.saveGlobals(type, cleanItems).catch(e=>console.error('Global save failed:',e));
    }
    const newGlobals = {};
    for (const type of ["assets","hires","overhead","oneTime"]) {
      newGlobals[type] = (state[type]||[]).filter(x => x.scope === "global").map(({scope,...rest}) => rest);
    }
    setGlobals(newGlobals);
  }, [a]);

  const saveScenario=useCallback(async()=>{
    setSaving(true);
    try{
      await persistGlobals(a);
      const scenarioOnly = {...a};
      for (const type of ["assets","hires","overhead","oneTime"]) {
        scenarioOnly[type] = (a[type]||[]).filter(x => x.scope !== "global");
      }
      await api.saveScenario(scenName, scenarioOnly);
      setScenarios(prev=>({...prev,[scenName]:{...scenarioOnly,_savedAt:new Date().toLocaleString()}}));
    }catch(e){console.error('Save failed:',e);}
    setSaving(false);
  },[scenName,a,persistGlobals]);

  const loadScenario=useCallback((name)=>{
    const s=scenarios[name]; if(!s) return;
    const {_savedAt,...rest}=s;
    const base = {...DEFAULT,...rest};
    for (const type of ["assets","hires","overhead","oneTime"]) {
      if (!base[type] || base[type].length === 0) base[type] = DEFAULT[type];
    }
    setA(mergeGlobals(base, globals));
    setScenName(name); setShowScen(false);
  },[scenarios,globals]);

  const deleteScenario=useCallback(async(name)=>{
    await api.deleteScenario(name);
    setScenarios(prev=>{const u={...prev}; delete u[name]; return u;});
  },[]);

  const duplicateScenario=useCallback(async(name)=>{
    const newName=name+" (copy)";
    const {_savedAt,...data}=scenarios[name]||{};
    await api.saveScenario(newName,data);
    setScenarios(prev=>({...prev,[newName]:{...data,_savedAt:new Date().toLocaleString()}}));
  },[scenarios]);

  const set=useCallback((k,v)=>setA(p=>({...p,[k]:v})),[]);

  const setAsset=useCallback((i,k,v)=>setA(p=>({...p,assets:p.assets.map((x,j)=>j===i?{...x,[k]:v}:x)})),[]);
  const addAsset=useCallback((scope="scenario",name)=>setA(p=>({...p,assets:[...p.assets,{
    name:name||"Asset "+(p.assets.length+1),price:12000000,cap:.075,growth:.05,
    noiMargin:.525,startMonth:Math.min(36,(p.assets.length+1)*3+3),scope,
    slipTypes:[],strUnits:[],otherRevenue:[],mgmtFees:[],capexSchedule:[]}]})),[]);
  const removeAsset=useCallback((i)=>setA(p=>({...p,assets:p.assets.filter((_,j)=>j!==i)})),[]);

  const setHire=useCallback((i,k,v)=>setA(p=>({...p,hires:p.hires.map((x,j)=>j===i?{...x,[k]:v}:x)})),[]);
  const addHire=useCallback((scope="scenario",name)=>setA(p=>({...p,hires:[...p.hires,{role:name||"New Hire",salary:75000,start:12,alloc:1.00,scope}]})),[]);
  const removeHire=useCallback((i)=>setA(p=>({...p,hires:p.hires.filter((_,j)=>j!==i)})),[]);

  const setOhead=useCallback((i,k,v)=>setA(p=>({...p,overhead:p.overhead.map((x,j)=>j===i?{...x,[k]:v}:x)})),[]);
  const addOhead=useCallback((scope="scenario",name)=>setA(p=>({...p,overhead:[...p.overhead,
    {label:name||"New Line Item",annual:10000,start:1,end:0,rampMo:3,growth:.02,ramps:false,scope}]})),[]);
  const removeOhead=useCallback((i)=>setA(p=>({...p,overhead:p.overhead.filter((_,j)=>j!==i)})),[]);

  const setPartnerSal=useCallback((i,k,v)=>setA(p=>({...p,partnerSalaries:p.partnerSalaries.map((x,j)=>j===i?{...x,[k]:v}:x)})),[]);

  const setOneTime=useCallback((i,k,v)=>setA(p=>({...p,oneTime:p.oneTime.map((x,j)=>j===i?{...x,[k]:v}:x)})),[]);
  const addOneTime=useCallback((scope="scenario",name)=>setA(p=>({...p,oneTime:[...p.oneTime,
    {label:name||"New Expense",amount:5000,month:1,category:"Other",scope}]})),[]);
  const removeOneTime=useCallback((i)=>setA(p=>({...p,oneTime:p.oneTime.filter((_,j)=>j!==i)})),[]);

  // Promote tier management
  const setTier=useCallback((i,k,v)=>setA(p=>({...p,promoteTiers:(p.promoteTiers||DEF_PROMOTE_TIERS).map((x,j)=>j===i?{...x,[k]:v}:x)})),[]);
  const addTier=useCallback(()=>setA(p=>({...p,promoteTiers:[...(p.promoteTiers||DEF_PROMOTE_TIERS),
    {irrHurdle:null,moicHurdle:null,lpSplit:0.60,gpSplit:0.40}]})),[]);
  const removeTier=useCallback((i)=>setA(p=>({...p,promoteTiers:(p.promoteTiers||DEF_PROMOTE_TIERS).filter((_,j)=>j!==i)})),[]);
  const setTierPreset=useCallback((preset)=>setA(p=>({...p,promoteTiers:preset})),[]);

  const pendingGlobalSaveRef=useRef(false);
  const addGlobalWithModal=useCallback((type)=>{
    setGlobalModal(type);
  },[]);

  const confirmGlobalAdd=useCallback((name)=>{
    const type=globalModal;
    setA(prev=>{
      const updated={...prev};
      if(type==="assets") updated.assets=[...prev.assets,{name,price:12000000,cap:.075,growth:.05,noiMargin:.525,startMonth:Math.min(36,(prev.assets.length+1)*3+3),scope:"global",...EMPTY_ASSET_ARRAYS}];
      else if(type==="hires") updated.hires=[...prev.hires,{role:name,salary:75000,start:12,alloc:1.00,scope:"global"}];
      else if(type==="overhead") updated.overhead=[...prev.overhead,{label:name,annual:10000,start:1,end:0,rampMo:3,growth:.02,ramps:false,scope:"global"}];
      else if(type==="oneTime") updated.oneTime=[...prev.oneTime,{label:name,amount:5000,month:1,category:"Other",scope:"global"}];
      pendingGlobalSaveRef.current=true;
      return updated;
    });
    setGlobalModal(null);
  },[globalModal]);

  useEffect(()=>{
    if(pendingGlobalSaveRef.current){
      pendingGlobalSaveRef.current=false;
      persistGlobals(a);
    }
  },[a,persistGlobals]);

  const m=useMemo(()=>{try{return run(a);}catch(e){console.error(e);return null;}},[a]);

  return(
    <div style={{minHeight:"100vh",background:C.dark,fontFamily:"'DM Sans',sans-serif",color:C.white}}>
      {globalModal && <GlobalAddModal type={globalModal} onConfirm={confirmGlobalAdd} onClose={()=>setGlobalModal(null)}/>}
      {/* NAV */}
      <div style={{background:"rgba(9,6,15,.97)",backdropFilter:"blur(12px)",
        borderBottom:`1px solid rgba(255,94,170,.2)`,padding:"0 24px",
        display:"flex",alignItems:"center",justifyContent:"space-between",
        height:58,position:"sticky",top:0,zIndex:100,gap:16}}>

        {/* Logo */}
        <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
          <div style={{width:32,height:32,background:C.gold,borderRadius:4,
            display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <span style={{fontSize:12,fontWeight:900,color:C.navy,fontFamily:"'Playfair Display',serif"}}>F1</span>
          </div>
          <div>
            <div style={{fontSize:14,fontWeight:800,color:C.white,letterSpacing:"0.03em",lineHeight:1.2}}>GP Fund I</div>
            <div style={{fontSize:10,color:C.gold,letterSpacing:"0.08em",textTransform:"uppercase",lineHeight:1}}>LP Model</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:1,flex:1,justifyContent:"center",overflowX:"auto",
          scrollbarWidth:"none",msOverflowStyle:"none"}}>
          {TABS.map(t=>{
            const icons={"Overview":"◈","Assets":"⬡","Waterfall":"▽","Fund CF":"⟳","G&A Model":"≡","GP Partners":"◉","Sensitivity":"⊞"};
            const active=tab===t;
            return(
              <button key={t} onClick={()=>setTab(t)} style={{
                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                gap:2,padding:"6px 14px",cursor:"pointer",border:"none",
                borderBottom:active?`2px solid ${C.gold}`:"2px solid transparent",
                borderTop:"2px solid transparent",
                background:active?"rgba(255,94,170,.1)":"transparent",
                transition:"background .15s",
                minWidth:72,whiteSpace:"nowrap",flexShrink:0}}>
                <span style={{fontSize:15,color:active?C.gold:"rgba(255,94,170,.5)",lineHeight:1}}>
                  {icons[t]||"·"}
                </span>
                <span style={{fontSize:11,fontWeight:active?800:600,letterSpacing:"0.05em",
                  textTransform:"uppercase",color:active?C.gold:C.white,lineHeight:1}}>
                  {t}
                </span>
              </button>
            );
          })}
        </div>

        {/* Badge */}
        <div style={{flexShrink:0,fontSize:8,color:"rgba(255,94,170,.3)",
          letterSpacing:"0.08em",textTransform:"uppercase",textAlign:"right",lineHeight:1.6}}>
          CONFIDENTIAL<br/>DRAFT
        </div>
      </div>

      {/* SCENARIO BAR */}
      <div style={{background:"rgba(255,94,170,.07)",borderBottom:"1px solid rgba(255,94,170,.15)",
        padding:"0 24px",display:"flex",alignItems:"center",gap:8,height:38,position:"sticky",top:58,zIndex:99}}>
        <span style={{fontSize:9,color:C.goldDim,textTransform:"uppercase",letterSpacing:".1em",flexShrink:0}}>Scenario:</span>
        {editingName
          ? <input autoFocus value={scenName} onChange={e=>setScenName(e.target.value)}
              onBlur={()=>setEditingName(false)} onKeyDown={e=>e.key==="Enter"&&setEditingName(false)}
              style={{background:"transparent",border:"none",borderBottom:`1px solid ${C.gold}`,
                color:C.white,fontSize:11,fontWeight:700,outline:"none",width:140,padding:"1px 0"}}/>
          : <span onClick={()=>setEditingName(true)} style={{fontSize:11,fontWeight:700,color:C.white,
              cursor:"pointer",borderBottom:"1px dashed rgba(255,94,170,.3)",paddingBottom:1,minWidth:80}}>
              {scenName}
            </span>
        }
        <button onClick={saveScenario} disabled={saving} style={{background:saving?"rgba(255,94,170,0.5)":C.gold,color:C.navy,border:"none",
          borderRadius:3,padding:"3px 10px",fontSize:9,fontWeight:800,letterSpacing:".07em",
          textTransform:"uppercase",cursor:saving?"wait":"pointer",flexShrink:0}}>{saving?"Saving...":"Save"}</button>
        <button onClick={()=>setPresenting(true)} style={{background:"transparent",
          color:C.gold,border:`1px solid ${C.gold}`,borderRadius:3,
          padding:"3px 10px",fontSize:9,fontWeight:800,letterSpacing:".07em",
          textTransform:"uppercase",cursor:"pointer",flexShrink:0}}>Presentation</button>
        <div style={{position:"relative"}}>
          <button onClick={()=>setShowScen(v=>!v)} style={{background:"transparent",
            color:C.goldDim,border:`1px solid rgba(255,94,170,.25)`,borderRadius:3,
            padding:"3px 10px",fontSize:9,fontWeight:700,letterSpacing:".07em",
            textTransform:"uppercase",cursor:"pointer",flexShrink:0}}>
            Load ▾ {Object.keys(scenarios).length>0&&`(${Object.keys(scenarios).length})`}
          </button>
          {showScen&&(
            <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,
              background:C.dark,border:`1px solid ${C.border}`,borderRadius:5,
              zIndex:200,minWidth:280,boxShadow:"0 8px 24px rgba(0,0,0,0.5)"}}>
              {Object.keys(scenarios).length===0
                ? <div style={{padding:"12px 14px",color:C.whDim,fontSize:10}}>No saved scenarios yet.</div>
                : Object.entries(scenarios).map(([name,s])=>(
                    <div key={name} style={{display:"flex",alignItems:"center",gap:6,
                      padding:"8px 12px",borderBottom:"1px solid rgba(255,255,255,.05)",
                      background:name===scenName?"rgba(255,94,170,.08)":"transparent"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:11,fontWeight:600,color:name===scenName?C.gold:C.white,
                          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</div>
                        <div style={{fontSize:8,color:C.whDim}}>{s._savedAt||""}</div>
                      </div>
                      <button onClick={()=>loadScenario(name)}
                        style={{background:"rgba(255,94,170,.15)",color:C.gold,border:"none",
                          borderRadius:3,padding:"2px 8px",fontSize:9,cursor:"pointer",flexShrink:0}}>Load</button>
                      <button onClick={()=>duplicateScenario(name)}
                        style={{background:"rgba(41,128,185,.15)",color:"#5DADE2",border:"none",
                          borderRadius:3,padding:"2px 8px",fontSize:9,cursor:"pointer",flexShrink:0}}>Copy</button>
                      <button onClick={()=>deleteScenario(name)}
                        style={{background:"rgba(192,57,43,.15)",color:C.red,border:"none",
                          borderRadius:3,padding:"2px 8px",fontSize:9,cursor:"pointer",flexShrink:0}}>✕</button>
                    </div>
                  ))
              }
              <div style={{padding:"8px 12px",borderTop:`1px solid ${C.border}`}}>
                <button onClick={()=>{resetToDefault&&setA(DEFAULT);setScenName("Base Case");setShowScen(false);}}
                  style={{background:"transparent",color:C.whDim,border:`1px solid rgba(255,255,255,.1)`,
                    borderRadius:3,padding:"3px 10px",fontSize:9,cursor:"pointer",width:"100%"}}>
                  Reset to Defaults
                </button>
              </div>
            </div>
          )}
        </div>
        <div style={{flex:1}}/>
        {Object.keys(scenarios).length>0&&(
          <div style={{display:"flex",gap:4,overflowX:"auto",scrollbarWidth:"none"}}>
            {Object.keys(scenarios).map(name=>(
              <button key={name} onClick={()=>loadScenario(name)} style={{
                background:name===scenName?"rgba(255,94,170,.2)":"rgba(255,255,255,.04)",
                color:name===scenName?C.gold:C.whDim,
                border:`1px solid ${name===scenName?"rgba(255,94,170,.4)":"rgba(255,255,255,.08)"}`,
                borderRadius:3,padding:"2px 10px",fontSize:9,fontWeight:600,
                cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {presenting&&m&&<PresentationView m={m} a={a} scenName={scenName} onClose={()=>setPresenting(false)}/>}
      {!presenting&&<div style={{display:"flex"}}>
        {/* SIDEBAR */}
        <div style={{width:262,flexShrink:0,background:"rgba(31,56,100,.1)",
          borderRight:`1px solid ${C.border}`,padding:"18px 14px",
          height:"calc(100vh - 52px)",overflowY:"auto",position:"sticky",top:52}}>

          <SHdr t="Fund Structure"/>
          <Sli label="Exit Cap Rate"  value={a.exitCapRate}  min={.055} max={.12}  step={.005} disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>set("exitCapRate",v)}  sub="All 8 exits"/>
          <Sli label="Interest Rate"  value={a.interestRate} min={.04}  max={.10}  step={.005} disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>set("interestRate",v)}/>
          <Sli label="LTV (Debt %)"   value={a.debtPct}      min={.40}  max={.75}  step={.05}  disp={v=>`${(v*100).toFixed(0)}%`} onChange={v=>set("debtPct",v)}/>
          <Sli label="Hold Period"    value={a.fundTerm}     min={5}    max={10}   step={1}    disp={v=>`${v} yrs`}               onChange={v=>set("fundTerm",v)}/>

          <div style={{height:1,background:C.border,margin:"12px 0"}}/>
          <SHdr t="Fees & Carry"/>
          <Sli label="AM Fee"         value={a.amFee}        min={0}    max={.02}  step={.0025} disp={v=>`${(v*100).toFixed(2)}%`} onChange={v=>set("amFee",v)} sub="% invested capital/yr"/>
          <Sli label="PM Fee"         value={a.pmFee}        min={0}    max={.10}  step={.005}  disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>set("pmFee",v)} sub="% EGI (gross revenue)"/>
          <Sli label="Carried Int."   value={a.carry}        min={.10}  max={.30}  step={.025}  disp={v=>`${(v*100).toFixed(0)}%`} onChange={v=>set("carry",v)} sub="GP catch-up target"/>
          <Sli label="Preferred Ret." value={a.prefReturn}   min={.05}  max={.10}  step={.005}  disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>set("prefReturn",v)}/>
          {/* Pref type toggle */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:9,color:C.whDim,textTransform:"uppercase",letterSpacing:".07em",marginBottom:5}}>Pref Type</div>
            <div style={{display:"flex",gap:4}}>
              {[["Simple","false"],["Compound","true"]].map(([lbl,val])=>{
                const active=String(a.compoundPref)===val;
                return(<button key={lbl} onClick={()=>set("compoundPref",val==="true")}
                  style={{flex:1,padding:"4px 0",fontSize:9,fontWeight:700,letterSpacing:".06em",
                    textTransform:"uppercase",cursor:"pointer",borderRadius:3,
                    background:active?C.gold:"transparent",color:active?C.navy:C.goldDim,
                    border:`1px solid ${active?C.gold:"rgba(255,94,170,.2)"}`}}>{lbl}</button>);
              })}
            </div>
            <div style={{fontSize:8,color:"rgba(255,94,170,.3)",marginTop:3}}>
              {a.compoundPref?"Compound: capital*(1+r)^n — institutional standard":"Simple: capital*rate*years"}
            </div>
          </div>
          {/* Catch-up toggle */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:9,color:C.whDim,textTransform:"uppercase",letterSpacing:".07em",marginBottom:5}}>GP Catch-Up</div>
            <div style={{display:"flex",gap:4}}>
              {[["None","false"],["Full","true"]].map(([lbl,val])=>{
                const active=String(a.catchUp)===val;
                return(<button key={lbl} onClick={()=>set("catchUp",val==="true")}
                  style={{flex:1,padding:"4px 0",fontSize:9,fontWeight:700,letterSpacing:".06em",
                    textTransform:"uppercase",cursor:"pointer",borderRadius:3,
                    background:active?C.gold:"transparent",color:active?C.navy:C.goldDim,
                    border:`1px solid ${active?C.gold:"rgba(255,94,170,.2)"}`}}>{lbl}</button>);
              })}
            </div>
            <div style={{fontSize:8,color:"rgba(255,94,170,.3)",marginTop:3}}>
              {a.catchUp?"GP takes 100% above pref until carry% of total, then splits":"GP takes carry% of all proceeds above pref"}
            </div>
          </div>
          <Sli label="GP Commitment"  value={a.gpPct}        min={0}    max={.05}  step={.005}  disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>set("gpPct",v)}/>
          <Sli label="Sale Costs"     value={a.saleCosts}    min={.01}  max={.04}  step={.005}  disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>set("saleCosts",v)}/>

          <div style={{height:1,background:C.border,margin:"12px 0"}}/>
          <SHdr t="Refinancing"/>
          {/* Refi toggle */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:9,color:C.whDim,textTransform:"uppercase",letterSpacing:".07em",marginBottom:5}}>Cash-Out Refi</div>
            <div style={{display:"flex",gap:4}}>
              {[["Off","false"],["On","true"]].map(([lbl,val])=>{
                const active=String(a.refiEnabled)===val;
                return(<button key={lbl} onClick={()=>set("refiEnabled",val==="true")}
                  style={{flex:1,padding:"4px 0",fontSize:9,fontWeight:700,letterSpacing:".06em",
                    textTransform:"uppercase",cursor:"pointer",borderRadius:3,
                    background:active?C.gold:"transparent",color:active?C.navy:C.goldDim,
                    border:`1px solid ${active?C.gold:"rgba(255,94,170,.2)"}`}}>{lbl}</button>);
              })}
            </div>
            <div style={{fontSize:8,color:"rgba(255,94,170,.3)",marginTop:3}}>
              {a.refiEnabled?"Refi at month "+a.refiMonth+" — cash returned to LP":"No mid-hold refinancing"}
            </div>
          </div>
          {a.refiEnabled&&<>
            <Sli label="Refi Month"    value={a.refiMonth}   min={12}   max={a.fundTerm*12-12} step={6}  disp={v=>`Mo ${v} (Yr ${(v/12).toFixed(1)})`} onChange={v=>set("refiMonth",v)}/>
            <Sli label="Refi LTV"      value={a.refiLTV}     min={.50}  max={.80}  step={.05}  disp={v=>`${(v*100).toFixed(0)}%`} onChange={v=>set("refiLTV",v)} sub="New LTV on appraised value"/>
            <Sli label="Refi Rate"     value={a.refiRate}    min={.04}  max={.10}  step={.005} disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>set("refiRate",v)} sub="New loan interest rate"/>
            <Sli label="Refi Costs"    value={a.refiCosts}   min={.005} max={.03}  step={.005} disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>set("refiCosts",v)} sub="% of appraised value"/>
          </>}

          <div style={{height:1,background:C.border,margin:"12px 0"}}/>
          <SHdr t="G&A Globals"/>
          <Sli label="Benefits Rate"  value={a.benefitsRate} min={.15}  max={.30}  step={.01}  disp={v=>`${(v*100).toFixed(0)}%`} onChange={v=>set("benefitsRate",v)}/>
          <Sli label="Salary Growth"  value={a.salaryGrowth} min={.01}  max={.06}  step={.005} disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>set("salaryGrowth",v)}/>
          <Sli label="# of Partners"  value={a.partners}     min={1}    max={5}    step={1}    disp={v=>`${v}`}                   onChange={v=>set("partners",v)}/>

          {m&&(
            <div style={{marginTop:10,padding:"10px 12px",background:C.goldFaint,
              borderRadius:4,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:9,color:C.gold,textTransform:"uppercase",letterSpacing:".1em",marginBottom:5}}>Live Output</div>
              <div style={{fontSize:10,color:C.whDim,lineHeight:1.8}}>
                <div>LP IRR: <span style={{color:m.lpIRR>a.prefReturn?C.green:C.red,fontWeight:700}}>{f.p(m.lpIRR)}</span></div>
                <div>LP MOIC: <span style={{color:C.gold}}>{f.x(m.lpMOIC)}</span></div>
                <div>GP Promote: <span style={{color:C.gold}}>{f.$(m.gpPromote)}</span></div>
                <div>GP Net 7yr: <span style={{color:m.gpNetTotal>0?C.green:C.red}}>{f.$(m.gpNetTotal)}</span></div>
              </div>
            </div>
          )}
        </div>

        {/* MAIN CONTENT */}
        <div style={{flex:1,padding:"24px 28px",overflowY:"auto",minHeight:"calc(100vh - 52px)"}}>
          {m&&tab==="Overview"    && <TabOverview    m={m} a={a}/>}
          {m&&tab==="Assets"      && <TabAssets      m={m} a={a} setAsset={setAsset} addAsset={addAsset} removeAsset={removeAsset} addGlobalWithModal={addGlobalWithModal}/>}
          {m&&tab==="Waterfall"   && <TabWaterfall   m={m} a={a} setTier={setTier} addTier={addTier} removeTier={removeTier} setTierPreset={setTierPreset}/>}
          {m&&tab==="Fund CF"     && <TabFundCF      m={m} a={a}/>}
          {m&&tab==="G&A Model"   && <TabGA          m={m} a={a} setHire={setHire} addHire={addHire} removeHire={removeHire} setOhead={setOhead} addOhead={addOhead} removeOhead={removeOhead} setPartnerSal={setPartnerSal} setOneTime={setOneTime} addOneTime={addOneTime} removeOneTime={removeOneTime} addGlobalWithModal={addGlobalWithModal}/>}
          {m&&tab==="GP Partners" && <TabGPPartners  m={m} a={a}/>}
          {m&&tab==="Sensitivity" && <TabSensitivity m={m} a={a}/>}
          {tab==="Deals" && <TabDeals a={a}/>}
        </div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRESENTATION VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function PresentationView({m,a,scenName,onClose}){
  const today=new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});
  const tiers=[
    {tier:"Tier 1",label:"Return of Capital",lp:m.lpROC,gp:m.gpROC,color:"#2980B9"},
    {tier:"Tier 2",label:`Preferred Return (${f.p(a.prefReturn)} ${a.compoundPref?"compound":"simple"})`,lp:m.lpPref,gp:0,color:C.mid},
    ...(a.catchUp?[{tier:"Tier 3",label:`GP Catch-Up (to ${f.p(a.carry)})`,lp:0,gp:m.gpCatchUp,color:"#A08040"}]:[]),
    ...(m.tierResults||[]).map((t,i)=>({
      tier:`Tier ${(a.catchUp?4:3)+i}`,
      label:t.irrHurdle!=null||t.moicHurdle!=null
        ? `${Math.round(t.lpSplit*100)}/${Math.round(t.gpSplit*100)} (${t.irrHurdle!=null?f.p(t.irrHurdle)+" IRR":""}${t.irrHurdle!=null&&t.moicHurdle!=null?" / ":""}${t.moicHurdle!=null?f.x(t.moicHurdle)+" EM":""})`
        : `Residual (${Math.round(t.lpSplit*100)}/${Math.round(t.gpSplit*100)})`,
      lp:t.lp,gp:t.gp,color:["#5DADE2","#3498DB","#2471A3"][i]||C.gold,
    })),
  ];

  const Slide=({children,title,sub})=>(
    <div className="pres-slide" style={{padding:"48px 56px",minHeight:"100vh",
      background:C.dark,borderBottom:`3px solid ${C.gold}`,position:"relative"}}>
      {title&&<div style={{fontSize:28,fontWeight:700,color:C.white,
        fontFamily:"'Playfair Display',serif",marginBottom:sub?4:20}}>{title}</div>}
      {sub&&<div style={{fontSize:13,color:C.goldDim,marginBottom:24}}>{sub}</div>}
      {children}
      <div style={{position:"absolute",bottom:16,right:56,fontSize:8,color:"rgba(255,94,170,.3)",
        letterSpacing:".1em",textTransform:"uppercase"}}>CONFIDENTIAL — {scenName}</div>
    </div>
  );

  return(
    <div style={{position:"fixed",inset:0,zIndex:1000,background:C.dark,overflowY:"auto"}}
      className="pres-container">
      {/* Print styles */}
      <style>{`
        @media print {
          body { background: #0D1B2A !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .pres-no-print { display: none !important; }
          .pres-slide { page-break-after: always; min-height: auto !important; padding: 32px 40px !important; }
          .pres-slide:last-child { page-break-after: avoid; }
          .pres-container { position: static !important; overflow: visible !important; }
          @page { size: landscape; margin: 0.3in; }
        }
      `}</style>

      {/* Top bar — hidden in print */}
      <div className="pres-no-print" style={{position:"sticky",top:0,zIndex:10,
        background:"rgba(9,6,15,.97)",backdropFilter:"blur(12px)",
        borderBottom:`1px solid ${C.gold}`,padding:"0 24px",
        display:"flex",alignItems:"center",justifyContent:"space-between",height:48}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:28,height:28,background:C.gold,borderRadius:3,
            display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontSize:10,fontWeight:900,color:C.navy,fontFamily:"'Playfair Display',serif"}}>F1</span>
          </div>
          <div>
            <span style={{fontSize:13,fontWeight:800,color:C.white}}>GP Fund I</span>
            <span style={{fontSize:10,color:C.gold,marginLeft:8,letterSpacing:".08em",textTransform:"uppercase"}}>Presentation Mode</span>
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>window.print()} style={{background:C.gold,color:C.navy,border:"none",
            borderRadius:3,padding:"5px 16px",fontSize:10,fontWeight:800,letterSpacing:".07em",
            textTransform:"uppercase",cursor:"pointer"}}>Print / PDF</button>
          <button onClick={onClose} style={{background:"transparent",color:C.goldDim,
            border:`1px solid rgba(255,94,170,.3)`,borderRadius:3,padding:"5px 16px",
            fontSize:10,fontWeight:700,letterSpacing:".07em",textTransform:"uppercase",cursor:"pointer"}}>
            Exit</button>
        </div>
      </div>

      {/* SLIDE 1: Cover */}
      <Slide>
        <div style={{display:"flex",flexDirection:"column",justifyContent:"center",
          alignItems:"center",minHeight:"calc(100vh - 160px)",textAlign:"center"}}>
          <div style={{width:64,height:64,background:C.gold,borderRadius:8,
            display:"flex",alignItems:"center",justifyContent:"center",marginBottom:28}}>
            <span style={{fontSize:24,fontWeight:900,color:C.navy,fontFamily:"'Playfair Display',serif"}}>F1</span>
          </div>
          <div style={{fontSize:42,fontWeight:700,color:C.white,fontFamily:"'Playfair Display',serif",
            marginBottom:8}}>GP Fund I</div>
          <div style={{fontSize:16,color:C.gold,letterSpacing:".15em",textTransform:"uppercase",
            marginBottom:32}}>Investment Summary</div>
          <div style={{height:1,width:120,background:C.gold,marginBottom:32}}/>
          <div style={{fontSize:14,color:C.whDim,marginBottom:6}}>Scenario: <span style={{color:C.white,fontWeight:700}}>{scenName}</span></div>
          <div style={{fontSize:12,color:C.goldDim}}>{today}</div>
          <div style={{marginTop:40,display:"flex",gap:20,flexWrap:"wrap",justifyContent:"center"}}>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:9,color:C.goldDim,textTransform:"uppercase",letterSpacing:".1em"}}>Assets</div>
              <div style={{fontSize:22,color:C.white,fontWeight:700,fontFamily:"'Playfair Display',serif"}}>{a.assets.length}</div>
            </div>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:9,color:C.goldDim,textTransform:"uppercase",letterSpacing:".1em"}}>Equity Deployed</div>
              <div style={{fontSize:22,color:C.white,fontWeight:700,fontFamily:"'Playfair Display',serif"}}>{f.$(m.totEqDep)}</div>
            </div>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:9,color:C.goldDim,textTransform:"uppercase",letterSpacing:".1em"}}>Hold Period</div>
              <div style={{fontSize:22,color:C.white,fontWeight:700,fontFamily:"'Playfair Display',serif"}}>{a.fundTerm} Years</div>
            </div>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:9,color:C.goldDim,textTransform:"uppercase",letterSpacing:".1em"}}>LP Net IRR</div>
              <div style={{fontSize:22,color:C.gold,fontWeight:700,fontFamily:"'Playfair Display',serif"}}>{f.p(m.lpIRR)}</div>
            </div>
          </div>
        </div>
      </Slide>

      {/* SLIDE 2: Key Terms */}
      <Slide title="Key Fund Terms">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24,marginTop:12}}>
          <Card>
            <CT c="Structure"/>
            <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
              <tbody>
                {[
                  ["Fund Term",`${a.fundTerm} years`],
                  ["LTV (Debt %)",f.p(a.debtPct)],
                  ["Interest Rate",f.p(a.interestRate)],
                  ["Amortization",`${a.amortYears} years`],
                  ["Exit Cap Rate",f.p(a.exitCapRate)],
                  ["Sale Costs",f.p(a.saleCosts)],
                ].map(([k,v],i)=>(
                  <tr key={i} style={{borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:"8px 0",color:C.whDim}}>{k}</td>
                    <td style={{padding:"8px 0",color:C.white,fontWeight:600,textAlign:"right"}}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card>
            <CT c="Fees & Carry"/>
            <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
              <tbody>
                {[
                  ["Asset Management Fee",`${f.p(a.amFee)} of invested capital`],
                  ["Property Management Fee",`${f.p(a.pmFee)} of EGI (gross revenue)`],
                  ["Carried Interest",f.p(a.carry)],
                  ["Preferred Return",`${f.p(a.prefReturn)} (${a.compoundPref?"compound":"simple"})`],
                  ["GP Catch-Up",a.catchUp?"Yes — full catch-up":"None"],
                  ["GP Co-Investment",f.p(a.gpPct)],
                ].map(([k,v],i)=>(
                  <tr key={i} style={{borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:"8px 0",color:C.whDim}}>{k}</td>
                    <td style={{padding:"8px 0",color:C.white,fontWeight:600,textAlign:"right"}}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </Slide>

      {/* SLIDE 3: LP Return Summary */}
      <Slide title="LP Return Summary"
        sub={`${a.assets.length}-asset portfolio | ${f.$(m.totEqDep)} equity deployed | ${a.fundTerm}-year hold`}>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:24}}>
          <KPI label="LP Net IRR"   value={f.p(m.lpIRR)}   sub="Net of fees + promote" gold/>
          <KPI label="LP MOIC"      value={f.x(m.lpMOIC)}  sub="Multiple on invested capital"/>
          <KPI label="LP Equity In" value={f.$(m.totLPIn)} sub={`${f.p(1-a.gpPct)} of total equity`}/>
          <KPI label="Pref Hurdle"  value={f.p(a.prefReturn)} sub={`Annual preferred return (${a.compoundPref?"compound":"simple"})`}/>
          <KPI label="LP Proceeds"  value={f.$(m.lpTotal)} sub="Total at fund exit"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <Card>
            <CT c="Portfolio NOI Growth"/>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={m.noiChart}>
                <defs><linearGradient id="pn1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C.gold} stopOpacity={.3}/>
                  <stop offset="95%" stopColor={C.gold} stopOpacity={0}/>
                </linearGradient></defs>
                <XAxis dataKey="year" tick={{fill:C.whDim,fontSize:10}} axisLine={false} tickLine={false}/>
                <YAxis tickFormatter={v=>`$${(v/1e6).toFixed(0)}M`} tick={{fill:C.whDim,fontSize:10}} axisLine={false} tickLine={false} width={44}/>
                <Tooltip content={<TT/>}/>
                <Area type="monotone" dataKey="noi" stroke={C.gold} strokeWidth={2} fill="url(#pn1)" name="NOI"/>
              </AreaChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <CT c="Asset-Level IRRs"/>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={m.assetR.map(r=>({name:r.name,irr:r.irr}))}>
                <XAxis dataKey="name" tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
                <YAxis tickFormatter={v=>`${(v*100).toFixed(0)}%`} tick={{fill:C.whDim,fontSize:10}} axisLine={false} tickLine={false} width={32}/>
                <Tooltip content={<TT/>} formatter={v=>`${(v*100).toFixed(1)}%`}/>
                <ReferenceLine y={a.prefReturn} stroke={C.gold} strokeDasharray="4 4"/>
                <Bar dataKey="irr" name="IRR" radius={[2,2,0,0]}>
                  {m.assetR.map((e,i)=><Cell key={i} fill={e.irr>=a.prefReturn?C.green:C.red}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </Slide>

      {/* SLIDE 4: Asset Detail */}
      <Slide title="Asset Summary"
        sub={`${a.assets.length} assets | ${f.$(a.assets.reduce((s,x)=>s+x.price,0))} portfolio value | ${f.p(a.debtPct)} LTV`}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead>
              <tr style={{borderBottom:`1px solid ${C.border}`}}>
                {["Asset","Price","Going-In Cap","NOI Growth","Close Month","Equity","IRR","MOIC","Exit Value","Sale Net"].map(h=>(
                  <th key={h} style={{padding:"9px 10px",color:C.goldDim,fontSize:9,textTransform:"uppercase",
                    letterSpacing:".06em",textAlign:h==="Asset"?"left":"right"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.assetR.map((r,i)=>(
                <tr key={i} style={{borderBottom:"1px solid rgba(255,255,255,.04)",
                  background:i%2===0?"transparent":"rgba(255,255,255,.02)"}}>
                  <td style={{padding:"9px 10px",color:C.white,fontWeight:600}}>{r.name}</td>
                  <td style={{padding:"9px 10px",color:C.whDim,textAlign:"right"}}>{f.$(r.price)}</td>
                  <td style={{padding:"9px 10px",color:C.whDim,textAlign:"right"}}>{f.p(r.cap)}</td>
                  <td style={{padding:"9px 10px",color:C.whDim,textAlign:"right"}}>{f.p(r.growth)}</td>
                  <td style={{padding:"9px 10px",color:"#5DADE2",textAlign:"right"}}>M{r.startMonth}</td>
                  <td style={{padding:"9px 10px",color:C.whDim,textAlign:"right"}}>{f.$(r.eq)}</td>
                  <td style={{padding:"9px 10px",color:r.irr>=a.prefReturn?C.green:C.red,textAlign:"right",fontWeight:700}}>{f.p(r.irr)}</td>
                  <td style={{padding:"9px 10px",color:C.gold,textAlign:"right",fontWeight:600}}>{f.x(r.moic)}</td>
                  <td style={{padding:"9px 10px",color:C.whDim,textAlign:"right"}}>{f.$(r.exitVal)}</td>
                  <td style={{padding:"9px 10px",color:C.green,textAlign:"right"}}>{f.$(r.saleNet)}</td>
                </tr>
              ))}
              <tr style={{borderTop:`2px solid ${C.border}`,background:"rgba(255,94,170,.06)"}}>
                <td style={{padding:"9px 10px",color:C.gold,fontWeight:700}}>TOTAL</td>
                <td style={{padding:"9px 10px",color:C.gold,textAlign:"right",fontWeight:700}}>{f.$(a.assets.reduce((s,x)=>s+x.price,0))}</td>
                <td style={{padding:"9px 10px",color:C.goldDim,textAlign:"right"}}>{f.p(a.assets.reduce((s,x)=>s+x.cap*x.price,0)/a.assets.reduce((s,x)=>s+x.price,0))}</td>
                <td colSpan={2}/>
                <td style={{padding:"9px 10px",color:C.gold,textAlign:"right",fontWeight:700}}>{f.$(m.totEqDep)}</td>
                <td style={{padding:"9px 10px",color:C.green,textAlign:"right",fontWeight:700}}>{f.p(m.lpIRR)}</td>
                <td style={{padding:"9px 10px",color:C.gold,textAlign:"right",fontWeight:700}}>{f.x(m.lpMOIC)}</td>
                <td/>
                <td style={{padding:"9px 10px",color:C.green,textAlign:"right",fontWeight:700}}>{f.$(m.totSaleProc)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:18}}>
          <KPI label="Wtd Avg Cap" value={f.p(a.assets.reduce((s,x)=>s+x.cap*x.price,0)/a.assets.reduce((s,x)=>s+x.price,0))}/>
          <KPI label="Portfolio Value" value={f.$(a.assets.reduce((s,x)=>s+x.price,0))}/>
          <KPI label="Total Equity" value={f.$(m.totEqDep)}/>
          <KPI label="Total Debt" value={f.$(a.assets.reduce((s,x)=>s+x.price*a.debtPct,0))}/>
        </div>
      </Slide>

      {/* SLIDE 5: Distribution Waterfall */}
      <Slide title="Distribution Waterfall"
        sub={`3-tier | ${f.$(m.pool)} total pool | ${f.$(m.totSaleProc)} sale proceeds + ${f.$(m.totOpCF)} op CF`}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1.4fr",gap:24}}>
          <div>
            {tiers.map(row=>(
              <div key={row.tier} style={{background:C.whFaint,border:`1px solid ${C.border}`,
                borderRadius:5,padding:"13px 15px",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:9}}>
                  <div style={{width:3,height:28,background:row.color,borderRadius:2}}/>
                  <div>
                    <div style={{fontSize:9,color:C.gold,textTransform:"uppercase",letterSpacing:".1em"}}>{row.tier}</div>
                    <div style={{fontSize:12,color:C.white,fontWeight:600}}>{row.label}</div>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div style={{background:"rgba(41,128,185,.12)",borderRadius:3,padding:"7px 10px"}}>
                    <div style={{fontSize:9,color:"rgba(41,128,185,.7)",textTransform:"uppercase"}}>LP</div>
                    <div style={{fontSize:16,color:"#5DADE2",fontWeight:700,fontFamily:"'Playfair Display',serif"}}>{f.$(row.lp)}</div>
                  </div>
                  <div style={{background:"rgba(255,94,170,.08)",borderRadius:3,padding:"7px 10px"}}>
                    <div style={{fontSize:9,color:C.goldDim,textTransform:"uppercase"}}>GP</div>
                    <div style={{fontSize:16,color:C.gold,fontWeight:700,fontFamily:"'Playfair Display',serif"}}>{f.$(row.gp)}</div>
                  </div>
                </div>
              </div>
            ))}
            <div style={{background:C.navy,border:`1px solid ${C.gold}`,borderRadius:5,padding:"13px 15px"}}>
              <div style={{fontSize:9,color:C.gold,textTransform:"uppercase",letterSpacing:".1em",marginBottom:7}}>Totals</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div>
                  <div style={{fontSize:9,color:"rgba(93,173,226,.7)",textTransform:"uppercase"}}>LP Total</div>
                  <div style={{fontSize:19,color:"#5DADE2",fontWeight:700,fontFamily:"'Playfair Display',serif"}}>{f.$(m.lpTotal)}</div>
                  <div style={{fontSize:10,color:C.whDim}}>MOIC: {f.x(m.lpMOIC)}</div>
                </div>
                <div>
                  <div style={{fontSize:9,color:C.goldDim,textTransform:"uppercase"}}>GP Total</div>
                  <div style={{fontSize:19,color:C.gold,fontWeight:700,fontFamily:"'Playfair Display',serif"}}>{f.$(m.gpFundTotal)}</div>
                  <div style={{fontSize:10,color:C.whDim}}>{f.$(m.gpPromote)} promote</div>
                </div>
              </div>
            </div>
          </div>
          <Card>
            <CT c="Proceeds by Recipient"/>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={m.waterfall} margin={{top:10,right:10,bottom:10,left:10}}>
                <XAxis dataKey="name" tick={{fill:C.whDim,fontSize:10}} axisLine={false} tickLine={false}/>
                <YAxis tickFormatter={v=>`$${(v/1e6).toFixed(0)}M`} tick={{fill:C.whDim,fontSize:10}} axisLine={false} tickLine={false} width={44}/>
                <Tooltip content={<TT/>}/>
                <Bar dataKey="value" name="Amount" radius={[3,3,0,0]}>
                  {m.waterfall.map((e,i)=><Cell key={i} fill={e.fill}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </Slide>

      {/* SLIDE 6: Fund Cash Flow */}
      <Slide title="Fund Cash Flow"
        sub="LP capital calls, operating cash flow, and deployment timeline">
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:20}}>
          <KPI label="Total LP Called"   value={f.$(m.totLPCalled)} sub="Investment period"/>
          <KPI label="Total Op CF"       value={f.$(m.totOpCF)}     sub="Net of DS + PM fees"/>
          <KPI label="Sale Proceeds"     value={f.$(m.totSaleProc)} sub={`All ${a.assets.length} exits`} gold/>
          <KPI label="Total Pool"        value={f.$(m.pool)}        sub="Available for distribution"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
          <Card>
            <CT c="Annual Capital Calls & Net Operating CF"/>
            <ResponsiveContainer width="100%" height={210}>
              <ComposedChart data={m.fundCFAnnual}>
                <XAxis dataKey="year" tick={{fill:C.whDim,fontSize:10}} axisLine={false} tickLine={false}/>
                <YAxis tickFormatter={v=>`$${(v/1e6).toFixed(0)}M`} tick={{fill:C.whDim,fontSize:10}} axisLine={false} tickLine={false} width={44}/>
                <Tooltip content={<TT/>}/>
                <ReferenceLine y={0} stroke="rgba(255,255,255,.2)"/>
                <Bar dataKey="lpCalls" name="LP Capital Calls" fill={C.red} radius={[2,2,0,0]}/>
                <Bar dataKey="opCF"    name="Net Op CF"         fill={C.green} radius={[2,2,0,0]}/>
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <CT c="LP Capital Deployment"/>
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={m.deplCurve.slice(0,30)}>
                <defs><linearGradient id="pd1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C.blue} stopOpacity={.35}/>
                  <stop offset="95%" stopColor={C.blue} stopOpacity={0}/>
                </linearGradient></defs>
                <XAxis dataKey="mo" tickFormatter={v=>`M${v}`} tick={{fill:C.whDim,fontSize:10}} axisLine={false} tickLine={false}/>
                <YAxis tickFormatter={v=>`$${(v/1e6).toFixed(0)}M`} tick={{fill:C.whDim,fontSize:10}} axisLine={false} tickLine={false} width={44}/>
                <Tooltip content={<TT/>}/>
                <Area type="stepAfter" dataKey="lp" stroke={C.blue} strokeWidth={2} fill="url(#pd1)" name="LP Called"/>
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </Slide>

      {/* SLIDE 7: G&A Summary */}
      <Slide title="GP Operating Model"
        sub="Fee income, G&A burden, and coverage analysis">
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:20}}>
          <KPI label="Total G&A (7yr)"       value={f.$(m.totGA)}              sub="All-in incl. partner salaries"/>
          <KPI label="Total Fee Income"       value={f.$(m.totFees)}           sub="AM + PM fees"/>
          <KPI label="Fee Coverage"           value={f.p(m.totFees/m.totGA)}   sub="Fees / total G&A" gold/>
          <KPI label="G&A Shortfall"          value={f.$(m.totGAShortfall)}    sub="LP funds the gap"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <Card>
            <CT c="Monthly G&A by Category"/>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={m.gaMonthly.map(x=>({
                mo:x.mo,
                partnerSal:Math.round(x.partnerSalCost||0),
                staff:Math.round(x.personnel-(x.partnerSalCost||0)),
                overhead:Math.round(x.fix),
              }))}>
                <defs>
                  <linearGradient id="pgp2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.gold} stopOpacity={.35}/><stop offset="95%" stopColor={C.gold} stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="pgs2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.blue} stopOpacity={.4}/><stop offset="95%" stopColor={C.blue} stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="pgo2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.mid} stopOpacity={.4}/><stop offset="95%" stopColor={C.mid} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="mo" tickFormatter={v=>v%12===0?`M${v}`:""} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
                <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}K`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={44}/>
                <Tooltip content={<TT/>}/>
                <Area stackId="1" type="monotone" dataKey="overhead"   stroke={C.mid}  strokeWidth={1} fill="url(#pgo2)" name="Overhead"/>
                <Area stackId="1" type="monotone" dataKey="staff"      stroke={C.blue} strokeWidth={1} fill="url(#pgs2)" name="Staff G&A"/>
                <Area stackId="1" type="monotone" dataKey="partnerSal" stroke={C.gold} strokeWidth={1.5} fill="url(#pgp2)" name="Partner Salaries"/>
              </AreaChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <CT c="Fee Income vs G&A — Monthly Net"/>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={m.gpEntity.map(x=>({
                mo:x.mo,fees:Math.round(x.fees),ga:Math.round(-x.ga),net:Math.round(x.fees+x.ga)
              }))}>
                <XAxis dataKey="mo" tickFormatter={v=>v%12===0?`M${v}`:""} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
                <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}K`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={44}/>
                <Tooltip content={<TT/>}/>
                <ReferenceLine y={0} stroke="rgba(255,255,255,.2)"/>
                <Bar dataKey="fees" name="Fee Income" fill={C.green} radius={[1,1,0,0]}/>
                <Bar dataKey="ga"   name="G&A Spend"  fill={C.red}   radius={[1,1,0,0]}/>
                <Line type="monotone" dataKey="net" name="Net" stroke={C.gold} strokeWidth={2} dot={false}/>
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </Slide>

      {/* SLIDE 8: Sensitivity */}
      <Slide title="Sensitivity Analysis"
        sub="LP IRR across key assumption combinations — current assumptions highlighted">
        {(()=>{
          const exitCaps=[.065,.070,.075,.080,.085,.090];
          const noiGrowths=[.03,.05,.07,.09];
          return(
            <Card>
              <CT c="LP IRR Matrix — Exit Cap Rate x NOI Growth"/>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead>
                    <tr style={{borderBottom:`1px solid ${C.border}`}}>
                      <th style={{padding:"9px 14px",color:C.goldDim,fontSize:10,
                        textTransform:"uppercase",letterSpacing:".07em",textAlign:"left"}}>
                        Exit Cap / NOI Growth
                      </th>
                      {noiGrowths.map(g=>(
                        <th key={g} style={{padding:"9px 16px",color:C.gold,fontSize:11,textAlign:"center"}}>
                          {(g*100).toFixed(0)}%
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {exitCaps.map(ec=>(
                      <tr key={ec} style={{borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                        <td style={{padding:"10px 14px",fontSize:12,
                          color:Math.abs(ec-a.exitCapRate)<.001?C.gold:C.whDim,
                          fontWeight:Math.abs(ec-a.exitCapRate)<.001?700:400}}>
                          {(ec*100).toFixed(1)}% {Math.abs(ec-a.exitCapRate)<.001&&"  current"}
                        </td>
                        {noiGrowths.map(g=>{
                          const r2=run({...a,exitCapRate:ec,assets:a.assets.map(x=>({...x,growth:g}))});
                          const v=r2.lpIRR;
                          const isCur=Math.abs(ec-a.exitCapRate)<.001&&Math.abs(g-a.assets[0].growth)<.001;
                          const bg=v>.18?"rgba(30,132,73,.25)":v>.14?"rgba(255,94,170,.12)":"rgba(192,57,43,.2)";
                          const clr=v>.18?C.green:v>.14?C.white:C.red;
                          return(
                            <td key={g} style={{padding:"10px 16px",textAlign:"center",fontSize:13,
                              background:isCur?"rgba(255,94,170,.22)":bg,color:clr,fontWeight:isCur?700:500,
                              border:isCur?`1px solid ${C.gold}`:"none"}}>
                              {f.p(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{display:"flex",gap:14,marginTop:12,fontSize:11}}>
                {[["rgba(30,132,73,.3)","> 18%"],["rgba(255,94,170,.15)","14-18%"],["rgba(192,57,43,.25)","< 14%"]].map(([bg,l])=>(
                  <div key={l} style={{display:"flex",alignItems:"center",gap:5}}>
                    <div style={{width:14,height:14,background:bg,borderRadius:2}}/>
                    <span style={{color:C.whDim}}>{l}</span>
                  </div>
                ))}
              </div>
            </Card>
          );
        })()}
      </Slide>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════
function TabOverview({m,a}){
  return(
    <div>
      <PHdr title="Fund I — Return Summary"
        sub={`${a.assets.length}-asset portfolio · ${f.$(m.totEqDep)} equity deployed · ${a.fundTerm}-year hold`}/>
      <div style={{fontSize:9,color:C.gold,letterSpacing:".12em",textTransform:"uppercase",marginBottom:7,fontWeight:700}}>LP Returns</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
        <KPI label="LP Net IRR"   value={f.p(m.lpIRR)}   sub="Net of fees + promote" gold/>
        <KPI label="LP MOIC"      value={f.x(m.lpMOIC)}  sub="Multiple on invested capital"/>
        <KPI label="LP Equity In" value={f.$(m.totLPIn)} sub="98% of total equity"/>
        <KPI label="Pref Hurdle"  value={f.p(a.prefReturn)} sub="Annual preferred return"/>
        <KPI label="LP Proceeds"  value={f.$(m.lpTotal)} sub="Total at fund exit"/>
        {m.totRefiLP>0&&<KPI label="Refi to LP" value={f.$(m.totRefiLP)} sub={`Month ${a.refiMonth} cash-out refi`}/>}
      </div>
      <div style={{height:1,background:C.border,margin:"14px 0"}}/>
      <div style={{fontSize:9,color:C.gold,letterSpacing:".12em",textTransform:"uppercase",marginBottom:7,fontWeight:700}}>GP Economics</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:22}}>
        <KPI label="GP Promote"   value={f.$(m.gpPromote)}    sub={`Total promote${(a.promoteTiers||[]).length>1?" (multi-tier)":""}`} gold/>
        <KPI label="AM + PM Fees" value={f.$(m.totFees)}      sub="7-yr fee income"/>
        <KPI label="Per Partner"  value={f.$(m.promPP)}       sub={`1 of ${a.partners} partners`}/>
        <KPI label="GP Net 7-yr"  value={f.$(m.gpNetTotal)}   sub="After co-invest (LP funds G&A gap)"/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <Card>
          <CT c="Portfolio NOI Growth"/>
          <ResponsiveContainer width="100%" height={170}>
            <AreaChart data={m.noiChart}>
              <defs><linearGradient id="n1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.gold} stopOpacity={.3}/>
                <stop offset="95%" stopColor={C.gold} stopOpacity={0}/>
              </linearGradient></defs>
              <XAxis dataKey="year" tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
              <YAxis tickFormatter={v=>`$${(v/1e6).toFixed(0)}M`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={40}/>
              <Tooltip content={<TT/>}/>
              <Area type="monotone" dataKey="noi" stroke={C.gold} strokeWidth={2} fill="url(#n1)" name="NOI"/>
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <CT c="Asset-Level IRRs"/>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={m.assetR.map(r=>({name:r.name,irr:r.irr}))}>
              <XAxis dataKey="name" tick={{fill:C.whDim,fontSize:8}} axisLine={false} tickLine={false}/>
              <YAxis tickFormatter={v=>`${(v*100).toFixed(0)}%`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={30}/>
              <Tooltip content={<TT/>} formatter={v=>`${(v*100).toFixed(1)}%`}/>
              <ReferenceLine y={a.prefReturn} stroke={C.gold} strokeDasharray="4 4"/>
              <Bar dataKey="irr" name="IRR" radius={[2,2,0,0]}>
                {m.assetR.map((e,i)=><Cell key={i} fill={e.irr>=a.prefReturn?C.green:C.red}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <Card>
        <CT c="LP Capital Deployment (Months 1–30)"/>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={m.deplCurve.slice(0,30)}>
            <defs><linearGradient id="d1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={C.blue} stopOpacity={.35}/>
              <stop offset="95%" stopColor={C.blue} stopOpacity={0}/>
            </linearGradient></defs>
            <XAxis dataKey="mo" tickFormatter={v=>`M${v}`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
            <YAxis tickFormatter={v=>`$${(v/1e6).toFixed(0)}M`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={40}/>
            <Tooltip content={<TT/>}/>
            <Area type="stepAfter" dataKey="lp" stroke={C.blue} strokeWidth={2} fill="url(#d1)" name="LP Called"/>
          </AreaChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASSETS
// ═══════════════════════════════════════════════════════════════════════════════
function TabAssets({m,a,setAsset,addAsset,removeAsset,addGlobalWithModal}){
  const [expanded,setExpanded]=useState({});
  const toggle=(idx,section)=>setExpanded(p=>({...p,[idx]:{...(p[idx]||{}),[section]:!(p[idx]||{})[section]}}));

  const inp={background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,
    borderRadius:3,color:C.white,fontSize:10,padding:"3px 6px",width:"100%",outline:"none"};
  const secBtn={background:"transparent",border:`1px solid ${C.border}`,
    color:C.goldDim,fontSize:9,padding:"3px 8px",borderRadius:3,cursor:"pointer"};
  const TH=({children})=><th style={{fontSize:8,color:C.whDim,fontWeight:600,padding:"3px 4px",
    textAlign:"left",textTransform:"uppercase",letterSpacing:".05em"}}>{children}</th>;

  return(
    <div>
      <PHdr title="Asset Assumptions" sub="Adjust per-asset parameters — returns update live"/>
      {a.assets.map((asset,idx)=>{
        const r=m.assetR[idx];
        const exp=expanded[idx]||{};
        const hasRev=r?.useBottomsUp||false;
        const impliedCap=hasRev&&r?.noi?.[1]&&asset.price?r.noi[1]/asset.price:null;
        const yr1Gross=r?.grossRevYr1||0;

        const updRow=(field,ri,k,v)=>{
          const arr=[...(asset[field]||[])];
          arr[ri]={...arr[ri],[k]:v};
          setAsset(idx,field,arr);
        };
        const delRow=(field,ri)=>setAsset(idx,field,(asset[field]||[]).filter((_,j)=>j!==ri));
        const addRow=(field,tmpl)=>setAsset(idx,field,[...(asset[field]||[]),tmpl]);

        return(
          <div key={idx} style={{background:C.whFaint,border:`1px solid ${C.border}`,
            borderRadius:5,padding:"12px 14px",marginBottom:8}}>

            {/* Header */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <input value={asset.name} onChange={e=>setAsset(idx,"name",e.target.value)}
                  style={{background:"transparent",border:"none",borderBottom:`1px solid rgba(255,94,170,.3)`,
                    color:C.white,fontSize:12,fontWeight:700,outline:"none",width:140,padding:"1px 0"}}/>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:11,color:C.green}}>IRR: {f.p(r?.irr)}</span>
                <span style={{fontSize:11,color:C.gold}}>MOIC: {f.x(r?.moic)}</span>
                <span style={{fontSize:11,color:C.whDim}}>Equity: {f.$(r?.eq)}</span>
                <button onClick={()=>setAsset(idx,"scope",asset.scope==="global"?"scenario":"global")}
                  title={asset.scope==="global"?"Global: applies to all scenarios":"Scenario: current scenario only"}
                  style={{padding:"2px 7px",borderRadius:3,fontSize:8,fontWeight:700,cursor:"pointer",
                    background:asset.scope==="global"?"rgba(255,94,170,.2)":"rgba(255,255,255,.06)",
                    color:asset.scope==="global"?C.gold:C.whDim,
                    border:`1px solid ${asset.scope==="global"?"rgba(255,94,170,.4)":"rgba(255,255,255,.1)"}`}}>
                  {asset.scope==="global"?"Global":"Scen."}
                </button>
                {a.assets.length>1&&(
                  <button onClick={()=>removeAsset(idx)}
                    style={{background:"rgba(192,57,43,.2)",border:`1px solid ${C.red}`,
                      color:C.red,borderRadius:3,padding:"2px 8px",fontSize:9,cursor:"pointer"}}>✕</button>
                )}
              </div>
            </div>

            {/* Sliders */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:10}}>
              {[
                {k:"price",     l:"Price",                     min:5e6,max:50e6,step:5e5, d:v=>`$${(v/1e6).toFixed(1)}M`},
                {k:"cap",       l:hasRev?"Implied Cap":"Cap",  min:.04, max:.12, step:.005,d:v=>impliedCap?`${(impliedCap*100).toFixed(1)}% ↑`:`${(v*100).toFixed(1)}%`,readOnly:hasRev},
                {k:"growth",    l:"Revenue Growth",            min:.02, max:.12, step:.005,d:v=>`${(v*100).toFixed(1)}%`},
                {k:"noiMargin", l:"NOI Margin",                min:.30, max:.85, step:.01, fb:.525,d:v=>`${(v*100).toFixed(0)}%`},
                {k:"startMonth",l:"Close Month",               min:3,   max:36,  step:3,   d:v=>`M${v}`},
              ].map(fi=>{
                const val=asset[fi.k]!=null?asset[fi.k]:(fi.fb!=null?fi.fb:fi.min);
                const pct=Math.min(100,Math.max(0,((val-fi.min)/(fi.max-fi.min))*100));
                return(
                  <div key={fi.k}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                      <span style={{fontSize:9,color:C.goldDim,textTransform:"uppercase",letterSpacing:".06em"}}>{fi.l}</span>
                      <span style={{fontSize:10,color:fi.readOnly?"rgba(255,94,170,.5)":C.gold}}>{fi.d(val)}</span>
                    </div>
                    {fi.readOnly?(
                      <div style={{height:6,background:"rgba(255,255,255,.04)",borderRadius:2,marginTop:5}}>
                        <div style={{height:"100%",borderRadius:2,background:"rgba(255,94,170,.3)",
                          width:`${impliedCap?Math.min(100,Math.max(0,((impliedCap-.04)/(.12-.04))*100)):0}%`}}/>
                      </div>
                    ):(
                      <input type="range" min={fi.min} max={fi.max} step={fi.step} value={val}
                        onChange={e=>setAsset(idx,fi.k,Number(e.target.value))}
                        style={{width:"100%",accentColor:C.gold,cursor:"pointer",
                          background:`linear-gradient(to right,${C.gold} ${pct}%,rgba(255,255,255,0.07) 0%)`}}/>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── REVENUE BUILD-UP ── */}
            <div style={{marginBottom:5}}>
              <button onClick={()=>toggle(idx,"rev")}
                style={{width:"100%",textAlign:"left",background:"rgba(255,94,170,.06)",
                  border:`1px solid rgba(255,94,170,.15)`,borderRadius:4,padding:"5px 10px",
                  cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:9,fontWeight:700,color:C.gold,textTransform:"uppercase",letterSpacing:".06em"}}>
                  ▸ Revenue Build-Up
                  {hasRev?` · ${f.$(yr1Gross)} Yr1 Gross`:" (slips, STR, other revenue)"}
                </span>
                <span style={{fontSize:9,color:C.goldDim}}>{exp.rev?"▴":"▾"}</span>
              </button>
              {exp.rev&&(
                <div style={{background:"rgba(255,94,170,.025)",border:`1px solid rgba(255,94,170,.1)`,
                  borderRadius:"0 0 4px 4px",padding:"10px 12px"}}>

                  {/* SLIPS */}
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:9,color:C.goldDim,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>
                      Slips by Type
                    </div>
                    {(asset.slipTypes||[]).length>0&&(
                      <table style={{width:"100%",borderCollapse:"collapse",marginBottom:6}}>
                        <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
                          <TH>Label</TH><TH>Units</TH><TH>Rate/mo ($)</TH><TH>Occ %</TH><TH>Growth %</TH><TH>Yr1 Rev</TH><TH/>
                        </tr></thead>
                        <tbody>
                          {(asset.slipTypes||[]).map((row,ri)=>{
                            const yr1=(row.count||0)*(row.rate||0)*12*(row.occupancy!=null?row.occupancy:.85);
                            return(
                              <tr key={ri} style={{borderBottom:`1px solid rgba(255,255,255,.04)`}}>
                                <td style={{padding:"3px 4px"}}><input value={row.label||""} onChange={e=>updRow("slipTypes",ri,"label",e.target.value)} placeholder="e.g. 40ft Monthly" style={{...inp,width:110}}/></td>
                                <td style={{padding:"3px 4px"}}><input type="number" value={row.count||""} onChange={e=>updRow("slipTypes",ri,"count",Number(e.target.value))} min={0} style={{...inp,width:52}}/></td>
                                <td style={{padding:"3px 4px"}}><input type="number" value={row.rate||""} onChange={e=>updRow("slipTypes",ri,"rate",Number(e.target.value))} min={0} style={{...inp,width:72}}/></td>
                                <td style={{padding:"3px 4px"}}><input type="number" value={row.occupancy!=null?Math.round(row.occupancy*100):85} onChange={e=>updRow("slipTypes",ri,"occupancy",Number(e.target.value)/100)} min={0} max={100} style={{...inp,width:50}}/></td>
                                <td style={{padding:"3px 4px"}}><input type="number" value={row.growth!=null?Math.round(row.growth*100):3} onChange={e=>updRow("slipTypes",ri,"growth",Number(e.target.value)/100)} min={0} max={20} style={{...inp,width:46}}/></td>
                                <td style={{padding:"3px 4px",fontSize:10,color:yr1>0?C.green:C.whDim,fontWeight:600}}>{yr1>0?f.$(yr1):"—"}</td>
                                <td style={{padding:"3px 4px"}}><button onClick={()=>delRow("slipTypes",ri)} style={{background:"transparent",border:"none",color:C.red,cursor:"pointer",fontSize:13,lineHeight:1}}>×</button></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    <button onClick={()=>addRow("slipTypes",{label:"",count:0,rate:1200,occupancy:.85,growth:.03})} style={secBtn}>+ Add Slip Type</button>
                  </div>

                  {/* STR */}
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:9,color:C.goldDim,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>
                      Short-Term Rentals (STR)
                    </div>
                    {(asset.strUnits||[]).length>0&&(
                      <table style={{width:"100%",borderCollapse:"collapse",marginBottom:6}}>
                        <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
                          <TH>Label</TH><TH>Units</TH><TH>ADR ($)</TH><TH>Occ %</TH><TH>Growth %</TH><TH>Yr1 Rev</TH><TH/>
                        </tr></thead>
                        <tbody>
                          {(asset.strUnits||[]).map((row,ri)=>{
                            const yr1=(row.units||0)*(row.adr||0)*365*(row.occupancy!=null?row.occupancy:.65);
                            return(
                              <tr key={ri} style={{borderBottom:`1px solid rgba(255,255,255,.04)`}}>
                                <td style={{padding:"3px 4px"}}><input value={row.label||""} onChange={e=>updRow("strUnits",ri,"label",e.target.value)} placeholder="e.g. Wet Slip STR" style={{...inp,width:110}}/></td>
                                <td style={{padding:"3px 4px"}}><input type="number" value={row.units||""} onChange={e=>updRow("strUnits",ri,"units",Number(e.target.value))} min={0} style={{...inp,width:52}}/></td>
                                <td style={{padding:"3px 4px"}}><input type="number" value={row.adr||""} onChange={e=>updRow("strUnits",ri,"adr",Number(e.target.value))} min={0} style={{...inp,width:66}}/></td>
                                <td style={{padding:"3px 4px"}}><input type="number" value={row.occupancy!=null?Math.round(row.occupancy*100):65} onChange={e=>updRow("strUnits",ri,"occupancy",Number(e.target.value)/100)} min={0} max={100} style={{...inp,width:50}}/></td>
                                <td style={{padding:"3px 4px"}}><input type="number" value={row.growth!=null?Math.round(row.growth*100):5} onChange={e=>updRow("strUnits",ri,"growth",Number(e.target.value)/100)} min={0} max={20} style={{...inp,width:46}}/></td>
                                <td style={{padding:"3px 4px",fontSize:10,color:yr1>0?C.green:C.whDim,fontWeight:600}}>{yr1>0?f.$(yr1):"—"}</td>
                                <td style={{padding:"3px 4px"}}><button onClick={()=>delRow("strUnits",ri)} style={{background:"transparent",border:"none",color:C.red,cursor:"pointer",fontSize:13,lineHeight:1}}>×</button></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    <button onClick={()=>addRow("strUnits",{label:"",units:0,adr:350,occupancy:.65,growth:.05})} style={secBtn}>+ Add STR</button>
                  </div>

                  {/* OTHER REVENUE */}
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:9,color:C.goldDim,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>
                      Other Revenue
                    </div>
                    {(asset.otherRevenue||[]).length>0&&(
                      <table style={{width:"100%",borderCollapse:"collapse",marginBottom:6}}>
                        <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
                          <TH>Label</TH><TH>Annual ($)</TH><TH>Growth %</TH><TH>Yr1</TH><TH/>
                        </tr></thead>
                        <tbody>
                          {(asset.otherRevenue||[]).map((row,ri)=>(
                            <tr key={ri} style={{borderBottom:`1px solid rgba(255,255,255,.04)`}}>
                              <td style={{padding:"3px 4px"}}><input value={row.label||""} onChange={e=>updRow("otherRevenue",ri,"label",e.target.value)} placeholder="e.g. Dry Storage" style={{...inp,width:140}}/></td>
                              <td style={{padding:"3px 4px"}}><input type="number" value={row.annual||""} onChange={e=>updRow("otherRevenue",ri,"annual",Number(e.target.value))} min={0} style={{...inp,width:95}}/></td>
                              <td style={{padding:"3px 4px"}}><input type="number" value={row.growth!=null?Math.round(row.growth*100):3} onChange={e=>updRow("otherRevenue",ri,"growth",Number(e.target.value)/100)} min={0} max={20} style={{...inp,width:46}}/></td>
                              <td style={{padding:"3px 4px",fontSize:10,color:(row.annual||0)>0?C.green:C.whDim,fontWeight:600}}>{(row.annual||0)>0?f.$(row.annual):"—"}</td>
                              <td style={{padding:"3px 4px"}}><button onClick={()=>delRow("otherRevenue",ri)} style={{background:"transparent",border:"none",color:C.red,cursor:"pointer",fontSize:13,lineHeight:1}}>×</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                      {[["Dry Storage",480000],["Fuel (Net Margin)",150000],["Service & Repair",80000],["Concession / NNN",60000]].map(([label,annual])=>(
                        <button key={label} onClick={()=>addRow("otherRevenue",{label,annual,growth:.03})} style={secBtn}>+ {label.split(" ")[0]}</button>
                      ))}
                      <button onClick={()=>addRow("otherRevenue",{label:"",annual:0,growth:.03})} style={{...secBtn,color:C.gold}}>+ Other</button>
                    </div>
                  </div>

                  {/* Totals summary */}
                  {hasRev&&(
                    <div style={{display:"flex",gap:16,marginTop:10,paddingTop:8,borderTop:`1px solid ${C.border}`,flexWrap:"wrap"}}>
                      <div style={{fontSize:10}}><span style={{color:C.whDim}}>Yr1 Gross: </span><span style={{color:C.gold,fontWeight:700}}>{f.$(yr1Gross)}</span></div>
                      {impliedCap!=null&&<div style={{fontSize:10}}><span style={{color:C.whDim}}>Implied Cap: </span><span style={{color:C.gold,fontWeight:700}}>{f.p(impliedCap)}</span></div>}
                      <div style={{fontSize:10}}><span style={{color:C.whDim}}>Yr1 NOI: </span><span style={{color:C.green,fontWeight:700}}>{f.$(r?.noi?.[1])}</span></div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── BLUEWATER MANAGEMENT FEES ── */}
            <div style={{marginBottom:5}}>
              <button onClick={()=>toggle(idx,"fees")}
                style={{width:"100%",textAlign:"left",background:"rgba(41,128,185,.05)",
                  border:`1px solid rgba(41,128,185,.2)`,borderRadius:4,padding:"5px 10px",
                  cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:9,fontWeight:700,color:C.blue,textTransform:"uppercase",letterSpacing:".06em"}}>
                  ▸ Bluewater Management Fees
                  {(asset.mgmtFees||[]).length>0?` · ${(asset.mgmtFees||[]).length} line${(asset.mgmtFees||[]).length>1?"s":""}`:` (marketing, IT, asset mgmt)`}
                </span>
                <span style={{fontSize:9,color:"rgba(41,128,185,.4)"}}>{exp.fees?"▴":"▾"}</span>
              </button>
              {exp.fees&&(
                <div style={{background:"rgba(41,128,185,.03)",border:`1px solid rgba(41,128,185,.1)`,
                  borderRadius:"0 0 4px 4px",padding:"10px 12px"}}>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                    {[["Marketing Fee","pct",.02],["IT Fee","fixed",24000],["Asset Mgmt","pct",.01],["Accounting","fixed",18000]].map(([label,type,amt])=>(
                      <button key={label} onClick={()=>addRow("mgmtFees",{label,type,amount:amt})}
                        style={{...secBtn,color:C.blue,borderColor:"rgba(41,128,185,.3)"}}>+ {label}</button>
                    ))}
                    <button onClick={()=>addRow("mgmtFees",{label:"",type:"fixed",amount:0})}
                      style={{...secBtn,color:C.blue,borderColor:"rgba(41,128,185,.3)"}}>+ Other</button>
                  </div>
                  {(asset.mgmtFees||[]).length>0&&(
                    <table style={{width:"100%",borderCollapse:"collapse",marginBottom:8}}>
                      <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
                        <TH>Fee Label</TH><TH>Type</TH><TH>Amount</TH><TH>Annual $</TH><TH/>
                      </tr></thead>
                      <tbody>
                        {(asset.mgmtFees||[]).map((row,ri)=>{
                          const ann=row.type==="pct"?yr1Gross*(row.amount||0):(row.amount||0);
                          return(
                            <tr key={ri} style={{borderBottom:`1px solid rgba(255,255,255,.04)`}}>
                              <td style={{padding:"3px 4px"}}><input value={row.label||""} onChange={e=>updRow("mgmtFees",ri,"label",e.target.value)} placeholder="Fee name" style={{...inp,width:110}}/></td>
                              <td style={{padding:"3px 4px"}}>
                                <select value={row.type||"pct"} onChange={e=>updRow("mgmtFees",ri,"type",e.target.value)}
                                  style={{...inp,width:62,padding:"3px 4px"}}>
                                  <option value="pct">% Rev</option>
                                  <option value="fixed">Fixed</option>
                                </select>
                              </td>
                              <td style={{padding:"3px 4px",whiteSpace:"nowrap"}}>
                                <input type="number" min={0}
                                  value={row.type==="pct"?(row.amount!=null?+(row.amount*100).toFixed(2):0):(row.amount||"")}
                                  onChange={e=>updRow("mgmtFees",ri,"amount",row.type==="pct"?Number(e.target.value)/100:Number(e.target.value))}
                                  style={{...inp,width:62}}/>
                                <span style={{fontSize:8,color:C.whDim,marginLeft:2}}>{row.type==="pct"?"%":"$"}</span>
                              </td>
                              <td style={{padding:"3px 4px",fontSize:10,color:ann>0?C.blue:C.whDim,fontWeight:600}}>{ann>0?f.$(ann):"—"}</td>
                              <td style={{padding:"3px 4px"}}><button onClick={()=>delRow("mgmtFees",ri)} style={{background:"transparent",border:"none",color:C.red,cursor:"pointer",fontSize:13,lineHeight:1}}>×</button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                  {(()=>{
                    const tot=(asset.mgmtFees||[]).reduce((s,row)=>s+(row.type==="pct"?yr1Gross*(row.amount||0):(row.amount||0)),0);
                    return tot>0&&(
                      <div style={{fontSize:10,color:C.whDim}}>
                        Total fees: <span style={{color:C.blue,fontWeight:700}}>{f.$(tot)}</span>
                        {yr1Gross>0&&<span style={{marginLeft:8}}>({f.p(tot/yr1Gross)} of Yr1 gross)</span>}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* ── CAPEX SCHEDULE ── */}
            <div style={{marginBottom:2}}>
              <button onClick={()=>toggle(idx,"capex")}
                style={{width:"100%",textAlign:"left",background:"rgba(192,57,43,.04)",
                  border:`1px solid rgba(192,57,43,.2)`,borderRadius:4,padding:"5px 10px",
                  cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:9,fontWeight:700,color:C.red,textTransform:"uppercase",letterSpacing:".06em"}}>
                  ▸ CapEx Schedule
                  {(asset.capexSchedule||[]).length>0
                    ?` · ${f.$((asset.capexSchedule||[]).reduce((s,cx)=>s+(cx.amount||0),0))} total`
                    :" (dock, dredging, improvements)"}
                </span>
                <span style={{fontSize:9,color:"rgba(192,57,43,.4)"}}>{exp.capex?"▴":"▾"}</span>
              </button>
              {exp.capex&&(
                <div style={{background:"rgba(192,57,43,.03)",border:`1px solid rgba(192,57,43,.1)`,
                  borderRadius:"0 0 4px 4px",padding:"10px 12px"}}>
                  <div style={{fontSize:9,color:"rgba(192,57,43,.55)",marginBottom:8}}>
                    Deducted from levered equity cash flow in the year spent — directly impacts IRR.
                  </div>
                  {(asset.capexSchedule||[]).length>0&&(
                    <table style={{width:"100%",borderCollapse:"collapse",marginBottom:8}}>
                      <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
                        <TH>Label</TH><TH>Hold Yr</TH><TH>Amount ($)</TH><TH/>
                      </tr></thead>
                      <tbody>
                        {(asset.capexSchedule||[]).map((row,ri)=>(
                          <tr key={ri} style={{borderBottom:`1px solid rgba(255,255,255,.04)`}}>
                            <td style={{padding:"3px 4px"}}><input value={row.label||""} onChange={e=>updRow("capexSchedule",ri,"label",e.target.value)} placeholder="e.g. Dock Renovation" style={{...inp,width:140}}/></td>
                            <td style={{padding:"3px 4px"}}><input type="number" value={row.year||1} onChange={e=>updRow("capexSchedule",ri,"year",Number(e.target.value))} min={1} max={a.fundTerm||7} style={{...inp,width:52}}/></td>
                            <td style={{padding:"3px 4px"}}><input type="number" value={row.amount||""} onChange={e=>updRow("capexSchedule",ri,"amount",Number(e.target.value))} min={0} style={{...inp,width:100}}/></td>
                            <td style={{padding:"3px 4px"}}><button onClick={()=>delRow("capexSchedule",ri)} style={{background:"transparent",border:"none",color:C.red,cursor:"pointer",fontSize:13,lineHeight:1}}>×</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {(()=>{
                    const cx=asset.capexSchedule||[];
                    if(cx.length===0)return null;
                    const byYr={};
                    cx.forEach(r=>{const y=Math.round(r.year||1);byYr[y]=(byYr[y]||0)+(r.amount||0);});
                    const yrs=Object.keys(byYr).map(Number).sort((a,b)=>a-b);
                    if(yrs.length===0)return null;
                    return(
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8,paddingBottom:8,borderBottom:`1px solid rgba(192,57,43,.12)`}}>
                        {yrs.map(yr=>(
                          <div key={yr} style={{fontSize:9,background:"rgba(192,57,43,.08)",border:`1px solid rgba(192,57,43,.2)`,
                            borderRadius:3,padding:"3px 8px"}}>
                            <span style={{color:"rgba(192,57,43,.6)"}}>Yr {yr}: </span>
                            <span style={{color:C.red,fontWeight:700}}>{f.$(byYr[yr])}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {[["Dock Renovation",1,500000],["Dredging",3,250000],["Marina Upgrades",2,0]].map(([label,year,amount])=>(
                      <button key={label} onClick={()=>addRow("capexSchedule",{label,year,amount})}
                        style={{...secBtn,color:C.red,borderColor:"rgba(192,57,43,.3)"}}>+ {label}</button>
                    ))}
                    <button onClick={()=>addRow("capexSchedule",{label:"",year:1,amount:0})}
                      style={{...secBtn,color:C.red,borderColor:"rgba(192,57,43,.3)"}}>+ Add CapEx</button>
                  </div>
                </div>
              )}
            </div>

          </div>
        );
      })}

      <div style={{display:"flex",gap:6,marginBottom:12,marginTop:4}}>
        <button onClick={()=>addAsset("scenario")} style={{flex:1,padding:"10px",
          background:"rgba(255,94,170,.07)",border:`1px dashed rgba(255,94,170,.3)`,
          color:C.goldDim,borderRadius:5,fontSize:11,fontWeight:600,cursor:"pointer",
          letterSpacing:".05em"}}>+ Add Scenario Asset</button>
        <button onClick={()=>addGlobalWithModal("assets")} style={{flex:1,padding:"10px",
          background:"rgba(255,94,170,.15)",border:`1px dashed rgba(255,94,170,.5)`,
          color:C.gold,borderRadius:5,fontSize:11,fontWeight:600,cursor:"pointer",
          letterSpacing:".05em"}}>+ Add Global Asset</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginTop:0}}>
        <KPI label="Wtd Avg Cap" value={f.p(a.assets.reduce((s,x)=>s+x.cap*x.price,0)/a.assets.reduce((s,x)=>s+x.price,0))}/>
        <KPI label="Portfolio Value" value={f.$(a.assets.reduce((s,x)=>s+x.price,0))}/>
        <KPI label="Total Equity" value={f.$(a.assets.reduce((s,x)=>s+x.price*(1-a.debtPct),0))}/>
        <KPI label="Total Debt" value={f.$(a.assets.reduce((s,x)=>s+x.price*a.debtPct,0))}/>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WATERFALL
// ═══════════════════════════════════════════════════════════════════════════════
function TabWaterfall({m,a,setTier,addTier,removeTier,setTierPreset}){
  const tiers = a.promoteTiers || DEF_PROMOTE_TIERS;
  const isMultiTier = tiers.length > 1 || (tiers[0] && tiers[0].irrHurdle != null);

  // Build display rows for the full waterfall
  const displayTiers=[
    {tier:"Tier 1",label:"Return of Capital",lp:m.lpROC,gp:m.gpROC,color:"#2980B9",
      note:`LP equity + funded G&A shortfall · GP equity co-invest only`,split:"100% LP"},
    {tier:"Tier 2",label:`Preferred Return (${f.p(a.prefReturn)} ${a.compoundPref?"compound":"simple"})`,
      lp:m.lpPref,gp:0,color:C.mid,note:`LP only · ${a.compoundPref?"compound accrual":"simple interest"}`,split:"100% LP"},
    ...(a.catchUp?[{tier:"Tier 3",label:`GP Catch-Up (to ${f.p(a.carry)})`,
      lp:0,gp:m.gpCatchUp,color:"#A08040",note:`GP takes 100% until catch-up target reached`,split:"100% GP"}]:[]),
    ...(m.tierResults||[]).map((t,i)=>({
      tier:`Tier ${(a.catchUp?4:3)+i}`,
      label:t.irrHurdle!=null||t.moicHurdle!=null
        ? `${t.irrHurdle!=null?f.p(t.irrHurdle)+" IRR":""}${t.irrHurdle!=null&&t.moicHurdle!=null?" / ":""}${t.moicHurdle!=null?f.x(t.moicHurdle)+" EM":""}`
        : "Residual",
      lp:t.lp,gp:t.gp,
      color:["#5DADE2","#3498DB","#2471A3","#1A5276"][i]||"#5DADE2",
      note:t.irrHurdle!=null||t.moicHurdle!=null?"Dual trigger — whichever reached first":"All remaining proceeds",
      split:`${Math.round(t.lpSplit*100)}/${Math.round(t.gpSplit*100)}`,
    })),
  ];

  return(
    <div>
      <PHdr title="Distribution Waterfall"
        sub={`${displayTiers.length}-tier${isMultiTier?" multi-tier":""} · ${f.$(m.pool)} total pool · ${f.$(m.totSaleProc)} sale proceeds + ${f.$(m.totOpCF)} op CF`}/>

      {/* G&A shortfall explainer */}
      <div style={{background:"rgba(255,94,170,.06)",border:`1px solid rgba(255,94,170,.25)`,
        borderRadius:5,padding:"11px 15px",marginBottom:16,fontSize:11,color:C.whDim}}>
        <span style={{color:C.gold,fontWeight:700}}>How the G&A shortfall works: </span>
        When GP G&A exceeds fee income (AM+PM fees), the gap is funded by the LP as an additional capital contribution.
        G&A shortfall: <span style={{color:C.gold}}>{f.$(m.totGAShortfall)}</span> added to LP basis.
        Total LP capital at risk: <span style={{color:C.gold,fontWeight:700}}>{f.$(m.lpActualCapital)}</span> (equity{" "}
        <span style={{color:C.whDim}}>{f.$(m.totLPCalled)}</span> + shortfall{" "}
        <span style={{color:C.whDim}}>{f.$(m.totGAShortfall)}</span>).
        {m.totGAShortfall <= 0 && <span style={{color:C.green}}> Fees cover G&A fully — no shortfall.</span>}
      </div>

      {/* ── WATERFALL TIER CONFIGURATION ── */}
      <Card style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <CT c="Waterfall Structure — Promote Tiers"/>
          <div style={{display:"flex",gap:4}}>
            <button onClick={()=>setTierPreset(DEF_PROMOTE_TIERS)}
              style={{padding:"3px 10px",borderRadius:3,fontSize:8,fontWeight:700,cursor:"pointer",
                letterSpacing:".06em",textTransform:"uppercase",
                background:!isMultiTier?"rgba(255,94,170,.2)":"rgba(255,255,255,.06)",
                color:!isMultiTier?C.gold:C.whDim,
                border:`1px solid ${!isMultiTier?"rgba(255,94,170,.4)":"rgba(255,255,255,.1)"}`}}>
              Simple
            </button>
            <button onClick={()=>setTierPreset(MULTI_TIER_PRESET)}
              style={{padding:"3px 10px",borderRadius:3,fontSize:8,fontWeight:700,cursor:"pointer",
                letterSpacing:".06em",textTransform:"uppercase",
                background:isMultiTier?"rgba(255,94,170,.2)":"rgba(255,255,255,.06)",
                color:isMultiTier?C.gold:C.whDim,
                border:`1px solid ${isMultiTier?"rgba(255,94,170,.4)":"rgba(255,255,255,.1)"}`}}>
              Multi-Tier PE
            </button>
          </div>
        </div>
        <div style={{fontSize:10,color:C.goldDim,marginBottom:12}}>
          Tiers 1-{a.catchUp?3:2} (ROC, Pref{a.catchUp?", Catch-up":""}) controlled by sidebar.
          Promote tiers below define the split above pref.
          {isMultiTier&&" Dual trigger: tier advances when either IRR or MOIC threshold is reached first."}
        </div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${C.border}`}}>
              {["Tier","IRR Hurdle","MOIC Hurdle","LP Split","GP Split","LP Dist","GP Dist",""].map(h=>(
                <th key={h} style={{padding:"6px 8px",color:C.goldDim,fontSize:9,textTransform:"uppercase",
                  letterSpacing:".06em",textAlign:h==="Tier"?"left":"center"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Fixed tiers (read-only) */}
            <tr style={{borderBottom:"1px solid rgba(255,255,255,.04)",background:"rgba(41,128,185,.04)"}}>
              <td style={{padding:"6px 8px",color:"#5DADE2",fontWeight:600}}>1 — ROC</td>
              <td style={{padding:"6px 8px",textAlign:"center",color:C.whDim}}>—</td>
              <td style={{padding:"6px 8px",textAlign:"center",color:C.whDim}}>—</td>
              <td style={{padding:"6px 8px",textAlign:"center",color:"#5DADE2"}}>100%</td>
              <td style={{padding:"6px 8px",textAlign:"center",color:C.whDim}}>0%</td>
              <td style={{padding:"6px 8px",textAlign:"center",color:"#5DADE2",fontWeight:600}}>{f.$(m.lpROC)}</td>
              <td style={{padding:"6px 8px",textAlign:"center",color:C.whDim}}>{f.$(m.gpROC)}</td>
              <td/>
            </tr>
            <tr style={{borderBottom:"1px solid rgba(255,255,255,.04)",background:"rgba(41,128,185,.04)"}}>
              <td style={{padding:"6px 8px",color:"#5DADE2",fontWeight:600}}>2 — Pref ({f.p(a.prefReturn)})</td>
              <td style={{padding:"6px 8px",textAlign:"center",color:C.whDim}}>—</td>
              <td style={{padding:"6px 8px",textAlign:"center",color:C.whDim}}>—</td>
              <td style={{padding:"6px 8px",textAlign:"center",color:"#5DADE2"}}>100%</td>
              <td style={{padding:"6px 8px",textAlign:"center",color:C.whDim}}>0%</td>
              <td style={{padding:"6px 8px",textAlign:"center",color:"#5DADE2",fontWeight:600}}>{f.$(m.lpPref)}</td>
              <td style={{padding:"6px 8px",textAlign:"center",color:C.whDim}}>—</td>
              <td/>
            </tr>
            {a.catchUp&&(
              <tr style={{borderBottom:"1px solid rgba(255,255,255,.04)",background:"rgba(255,94,170,.04)"}}>
                <td style={{padding:"6px 8px",color:C.gold,fontWeight:600}}>3 — Catch-Up</td>
                <td style={{padding:"6px 8px",textAlign:"center",color:C.whDim}}>—</td>
                <td style={{padding:"6px 8px",textAlign:"center",color:C.whDim}}>—</td>
                <td style={{padding:"6px 8px",textAlign:"center",color:C.whDim}}>0%</td>
                <td style={{padding:"6px 8px",textAlign:"center",color:C.gold}}>100%</td>
                <td style={{padding:"6px 8px",textAlign:"center",color:C.whDim}}>—</td>
                <td style={{padding:"6px 8px",textAlign:"center",color:C.gold,fontWeight:600}}>{f.$(m.gpCatchUp)}</td>
                <td/>
              </tr>
            )}
            {/* Editable promote tiers */}
            {tiers.map((t,idx)=>{
              const tierNum = (a.catchUp?4:3)+idx;
              const result = m.tierResults?.[idx]||{lp:0,gp:0};
              const isLast = idx === tiers.length-1 && t.irrHurdle==null && t.moicHurdle==null;
              return(
                <tr key={idx} style={{borderBottom:"1px solid rgba(255,255,255,.04)",
                  background:idx%2===0?"transparent":"rgba(255,255,255,.015)"}}>
                  <td style={{padding:"6px 8px",color:C.gold,fontWeight:600}}>
                    {tierNum} — {isLast?"Residual":"Promote"}
                  </td>
                  <td style={{padding:"6px 8px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"center"}}>
                      {isLast
                        ? <span style={{color:C.whDim,fontSize:10}}>—</span>
                        : <>
                            <MiniSlider value={t.irrHurdle||0} min={0.08} max={0.30} step={0.005}
                              onChange={v=>setTier(idx,"irrHurdle",v)} color={C.gold} width={55}/>
                            <span style={{color:C.gold,minWidth:36,fontSize:10}}>{t.irrHurdle!=null?f.p(t.irrHurdle):"—"}</span>
                          </>
                      }
                    </div>
                  </td>
                  <td style={{padding:"6px 8px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"center"}}>
                      {isLast
                        ? <span style={{color:C.whDim,fontSize:10}}>—</span>
                        : <>
                            <MiniSlider value={t.moicHurdle||1.0} min={1.0} max={3.5} step={0.05}
                              onChange={v=>setTier(idx,"moicHurdle",v)} color={C.blue} width={55}/>
                            <span style={{color:C.blue,minWidth:36,fontSize:10}}>{t.moicHurdle!=null?f.x(t.moicHurdle):"—"}</span>
                          </>
                      }
                    </div>
                  </td>
                  <td style={{padding:"6px 8px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"center"}}>
                      <MiniSlider value={t.lpSplit} min={0.50} max={0.95} step={0.05}
                        onChange={v=>{setTier(idx,"lpSplit",v);setTier(idx,"gpSplit",+(1-v).toFixed(2));}}
                        color={"#5DADE2"} width={50}/>
                      <span style={{color:"#5DADE2",minWidth:28,fontSize:10}}>{Math.round(t.lpSplit*100)}%</span>
                    </div>
                  </td>
                  <td style={{padding:"6px 8px",color:C.gold,textAlign:"center",fontSize:10,fontWeight:600}}>
                    {Math.round(t.gpSplit*100)}%
                  </td>
                  <td style={{padding:"6px 8px",textAlign:"center",color:"#5DADE2",fontWeight:600}}>{f.$(result.lp)}</td>
                  <td style={{padding:"6px 8px",textAlign:"center",color:C.gold,fontWeight:600}}>{f.$(result.gp)}</td>
                  <td style={{padding:"6px 8px",textAlign:"center"}}>
                    {tiers.length>1&&(
                      <button onClick={()=>removeTier(idx)}
                        style={{background:"rgba(192,57,43,.15)",border:`1px solid rgba(192,57,43,.3)`,
                          color:C.red,borderRadius:3,padding:"2px 7px",fontSize:9,cursor:"pointer"}}>✕</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {/* Totals row */}
            <tr style={{borderTop:`2px solid ${C.border}`,background:"rgba(255,94,170,.06)"}}>
              <td colSpan={5} style={{padding:"7px 8px",color:C.gold,fontWeight:700}}>TOTALS</td>
              <td style={{padding:"7px 8px",textAlign:"center",color:"#5DADE2",fontWeight:700}}>{f.$(m.lpTotal)}</td>
              <td style={{padding:"7px 8px",textAlign:"center",color:C.gold,fontWeight:700}}>{f.$(m.gpFundTotal)}</td>
              <td/>
            </tr>
          </tbody>
        </table>
        <button onClick={addTier} style={{
          width:"100%",marginTop:8,padding:"8px",
          background:"rgba(255,94,170,.06)",border:`1px dashed rgba(255,94,170,.3)`,
          color:C.goldDim,borderRadius:4,fontSize:10,fontWeight:600,cursor:"pointer"}}>
          + Add Promote Tier
        </button>
      </Card>

      {/* Dual trigger note for multi-tier */}
      {isMultiTier&&(
        <div style={{background:"rgba(41,128,185,.06)",border:`1px solid rgba(41,128,185,.2)`,
          borderRadius:5,padding:"10px 14px",marginBottom:16,fontSize:11,color:C.whDim}}>
          <span style={{color:"#5DADE2",fontWeight:700}}>Dual trigger: </span>
          Each promote tier advances when either the IRR hurdle or MOIC hurdle is reached — whichever comes first.
          This protects both LP and GP across different return scenarios.
        </div>
      )}

      {/* Waterfall breakdown + chart */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1.4fr",gap:20}}>
        <div>
          {displayTiers.map(row=>(
            <div key={row.tier} style={{background:C.whFaint,border:`1px solid ${C.border}`,
              borderRadius:5,padding:"11px 13px",marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
                <div style={{width:3,height:24,background:row.color,borderRadius:2}}/>
                <div style={{flex:1}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{fontSize:9,color:C.gold,textTransform:"uppercase",letterSpacing:".1em"}}>{row.tier}</div>
                    <div style={{fontSize:9,color:C.whDim,background:"rgba(255,255,255,.06)",
                      padding:"1px 6px",borderRadius:2}}>{row.split}</div>
                  </div>
                  <div style={{fontSize:11,color:C.white,fontWeight:600}}>{row.label}</div>
                  <div style={{fontSize:9,color:C.whDim}}>{row.note}</div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                <div style={{background:"rgba(41,128,185,.12)",borderRadius:3,padding:"5px 8px"}}>
                  <div style={{fontSize:8,color:"rgba(41,128,185,.7)",textTransform:"uppercase"}}>LP</div>
                  <div style={{fontSize:14,color:"#5DADE2",fontWeight:700,fontFamily:"'Playfair Display',serif"}}>{f.$(row.lp)}</div>
                </div>
                <div style={{background:"rgba(255,94,170,.08)",borderRadius:3,padding:"5px 8px"}}>
                  <div style={{fontSize:8,color:C.goldDim,textTransform:"uppercase"}}>GP</div>
                  <div style={{fontSize:14,color:C.gold,fontWeight:700,fontFamily:"'Playfair Display',serif"}}>{f.$(row.gp)}</div>
                </div>
              </div>
            </div>
          ))}
          <div style={{background:C.navy,border:`1px solid ${C.gold}`,borderRadius:5,padding:"13px 15px"}}>
            <div style={{fontSize:9,color:C.gold,textTransform:"uppercase",letterSpacing:".1em",marginBottom:7}}>Totals</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div>
                <div style={{fontSize:9,color:"rgba(93,173,226,.7)",textTransform:"uppercase"}}>LP Total</div>
                <div style={{fontSize:19,color:"#5DADE2",fontWeight:700,fontFamily:"'Playfair Display',serif"}}>{f.$(m.lpTotal)}</div>
                <div style={{fontSize:10,color:C.whDim}}>MOIC: {f.x(m.lpMOIC)} · IRR: {f.p(m.lpIRR)}</div>
              </div>
              <div>
                <div style={{fontSize:9,color:C.goldDim,textTransform:"uppercase"}}>GP Total</div>
                <div style={{fontSize:19,color:C.gold,fontWeight:700,fontFamily:"'Playfair Display',serif"}}>{f.$(m.gpFundTotal)}</div>
                <div style={{fontSize:10,color:C.whDim}}>{f.$(m.gpPromote)} promote{m.gpCatchUp>0?` (incl. ${f.$(m.gpCatchUp)} catch-up)`:""}</div>
              </div>
            </div>
          </div>
        </div>
        <Card>
          <CT c="Proceeds by Recipient"/>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={m.waterfall.filter(x=>x.value>0)} margin={{top:10,right:10,bottom:10,left:10}}>
              <XAxis dataKey="name" tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
              <YAxis tickFormatter={v=>`$${(v/1e6).toFixed(0)}M`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={40}/>
              <Tooltip content={<TT/>}/>
              <Bar dataKey="value" name="Amount" radius={[3,3,0,0]}>
                {m.waterfall.filter(x=>x.value>0).map((e,i)=><Cell key={i} fill={e.fill}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FUND CF
// ═══════════════════════════════════════════════════════════════════════════════
function TabFundCF({m,a}){
  const [view, setView] = useState("charts");

  // Build monthly detail from raw monthly data
  const moDetail = m.monthly.map((x,i)=>{
    return {
      mo:       x.mo,
      portOpCF: Math.round(x.netOpCF),
      amFee:    Math.round(x.amFeeM),
      lpShare:  Math.round(x.netOpCF*(1-a.gpPct)),
      gpShare:  Math.round(x.netOpCF*a.gpPct),
      lpCall:   Math.round(x.lpCall),
      refiDist: Math.round(x.refiDist||0),
      cumLPCall:0,
    };
  });
  // Build cumulative LP capital called
  let cumLPCall=0;
  moDetail.forEach(r=>{cumLPCall+=r.lpCall;r.cumLPCall=Math.round(cumLPCall);});

  return(
    <div>
      <PHdr title="Fund Cash Flow" sub="LP capital calls, operating CF, and monthly distribution detail"/>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
        <KPI label="Total LP Called"   value={f.$(m.totLPCalled)} sub="Investment period"/>
        <KPI label="Total Op CF"       value={f.$(m.totOpCF)}     sub="Net of DS + PM fees"/>
        {m.totRefi>0&&<KPI label="Refi Proceeds" value={f.$(m.totRefi)} sub={`LP: ${f.$(m.totRefiLP)} · GP: ${f.$(m.totRefiGP)}`}/>}
        <KPI label="Net Sale Proceeds" value={f.$(m.totSaleProc)} sub="After debt & costs" gold/>
        <KPI label="Total Pool"        value={f.$(m.pool)}        sub="Available for distribution"/>
      </div>

      <Card style={{marginBottom:16}}>
        <CT c="Disposition Proceeds Breakdown"/>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:0,fontSize:11}}>
          {[
            {label:"Gross Sale Value",   val:m.totExitVal,      color:C.white,   sign:""},
            {label:"Debt Repaid to Bank", val:m.totDebtRepaid,   color:C.red,     sign:"\u2212"},
            {label:"Selling Costs",       val:m.totSellingCosts, color:"#E8A87C", sign:"\u2212"},
            {label:"Net to Equity",       val:m.totSaleProc,     color:C.gold,    sign:"="},
          ].map(({label,val,color,sign})=>(
            <div key={label} style={{padding:"10px 14px",borderRight:`1px solid ${C.border}`}}>
              <div style={{fontSize:9,color:C.goldDim,textTransform:"uppercase",letterSpacing:".06em",
                marginBottom:4,fontWeight:600}}>{label}</div>
              <div style={{fontSize:16,fontWeight:700,color,fontFamily:"'DM Mono',monospace"}}>
                {sign}{f.$(val)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{display:"flex",gap:4,marginBottom:14}}>
        {[["charts","Charts"],["quarterly","Quarterly"],["monthly","Monthly Detail"]].map(([v,l])=>(
          <button key={v} onClick={()=>setView(v)} style={{
            background:view===v?C.gold:"transparent",color:view===v?C.navy:C.goldDim,
            border:`1px solid ${view===v?C.gold:"rgba(255,94,170,.2)"}`,
            borderRadius:3,padding:"4px 14px",fontSize:9,fontWeight:700,
            textTransform:"uppercase",letterSpacing:".08em",cursor:"pointer"}}>
            {l}
          </button>
        ))}
      </div>

      {view==="charts" && (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
            <Card>
              <CT c="Annual Capital Calls &amp; Net Operating CF"/>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={m.fundCFAnnual}>
                  <XAxis dataKey="year" tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
                  <YAxis tickFormatter={v=>`$${(v/1e6).toFixed(0)}M`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={42}/>
                  <Tooltip content={<TT/>}/>
                  <ReferenceLine y={0} stroke="rgba(255,255,255,.2)"/>
                  <Bar dataKey="lpCalls" name="LP Capital Calls" fill={C.red}   radius={[2,2,0,0]}/>
                  <Bar dataKey="opCF"    name="Net Op CF"         fill={C.green} radius={[2,2,0,0]}/>
                  {m.totRefi>0&&<Bar dataKey="refiDist" name="Refi Proceeds" fill="#48C9B0" radius={[2,2,0,0]}/>}
                </ComposedChart>
              </ResponsiveContainer>
            </Card>
            <Card>
              <CT c="Portfolio NOI by Year"/>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={m.fundCFAnnual}>
                  <defs><linearGradient id="fc2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.blue} stopOpacity={.3}/>
                    <stop offset="95%" stopColor={C.blue} stopOpacity={0}/>
                  </linearGradient></defs>
                  <XAxis dataKey="year" tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
                  <YAxis tickFormatter={v=>`$${(v/1e6).toFixed(0)}M`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={42}/>
                  <Tooltip content={<TT/>}/>
                  <Area type="monotone" dataKey="noi" stroke={C.blue} strokeWidth={2} fill="url(#fc2)" name="Portfolio NOI"/>
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </div>
          <Card>
            <CT c="Monthly Fund Operating CF — All 84 Months"/>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={moDetail} margin={{top:0,right:0,bottom:0,left:0}}>
                <XAxis dataKey="mo" tickFormatter={v=>v%12===0?`M${v}`:""} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
                <YAxis tickFormatter={v=>`$${(v/1e6).toFixed(1)}M`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={44}/>
                <Tooltip content={<TT/>}/>
                <ReferenceLine y={0} stroke="rgba(255,255,255,.2)"/>
                <Bar dataKey="portOpCF" name="Net Op CF" radius={[1,1,0,0]}>
                  {moDetail.map((e,i)=><Cell key={i} fill={e.portOpCF>=0?C.green:C.red}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {view==="quarterly" && (
        <Card>
          <CT c="Quarterly Fund Cash Flow — All 28 Quarters"/>
          <div style={{fontSize:10,color:C.goldDim,marginBottom:12}}>
            Q1 = months 1–3, Q2 = months 4–6, etc. Distributions begin as assets close and generate NOI above debt service.
          </div>

          {/* Column legend */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:14}}>
            {[
              {col:"Portfolio CF",  color:C.green,   desc:"Total fund cash flow net of DS, PM & AM fees"},
              {col:"Mgmt Fee",      color:"#E8D5A3",  desc:"Asset mgmt fee to GP entity that quarter"},
              {col:"LP Distribution", color:"#5DADE2",desc:"LP 98% share of portfolio cash flow"},
              {col:"GP Distribution", color:C.gold,  desc:"GP 2% co-invest share"},
              {col:"LP Called (cumul)", color:C.whDim,desc:"Cumulative LP capital drawn through end of quarter"},
            ].map(({col,color,desc})=>(
              <div key={col} style={{background:"rgba(255,255,255,.04)",borderRadius:4,
                padding:"7px 9px",borderTop:`2px solid ${color}`}}>
                <div style={{fontSize:9,color,fontWeight:700,textTransform:"uppercase",
                  letterSpacing:".07em",marginBottom:3}}>{col}</div>
                <div style={{fontSize:9,color:C.whDim,lineHeight:1.5}}>{desc}</div>
              </div>
            ))}
          </div>

          <div style={{overflowX:"auto",maxHeight:480,overflowY:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,whiteSpace:"nowrap"}}>
              <thead style={{position:"sticky",top:0,zIndex:10}}>
                <tr style={{background:C.navy,borderBottom:`1px solid ${C.border}`}}>
                  {[
                    {h:"Quarter",align:"left"},
                    {h:"Portfolio CF",      align:"right",color:C.green},
                    {h:"Mgmt Fee",          align:"right",color:"#E8D5A3"},
                    {h:"LP Distribution",  align:"right",color:"#5DADE2"},
                    {h:"GP Distribution",  align:"right",color:C.gold},
                    {h:"LP Called (cumul)",align:"right",color:C.whDim},
                  ].map(({h,align,color})=>(
                    <th key={h} style={{padding:"6px 10px",color:color||C.goldDim,fontSize:9,
                      textTransform:"uppercase",letterSpacing:".06em",
                      textAlign:align,background:C.navy}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(()=>{
                  // Roll up moDetail into quarters
                  const qtrs=[];
                  let cumCalled=0;
                  for(let q=0;q<a.fundTerm*4;q++){
                    const mos=moDetail.slice(q*3,(q+1)*3);
                    const portCF=mos.reduce((s,r)=>s+r.portOpCF,0);
                    const fee=mos.reduce((s,r)=>s+r.amFee,0);
                    const lp=mos.reduce((s,r)=>s+r.lpShare,0);
                    const gp=mos.reduce((s,r)=>s+r.gpShare,0);
                    cumCalled+=mos.reduce((s,r)=>s+r.lpCall,0);
                    const yr=Math.floor(q/4)+1;
                    const qn=(q%4)+1;
                    qtrs.push({label:`Y${yr} Q${qn}`,portCF,fee,lp,gp,cumLPCall:Math.round(cumCalled)});
                  }
                  return qtrs.map((row,i)=>{
                    const isYrEnd=(i+1)%4===0;
                    return(
                      <tr key={i} style={{
                        borderBottom:isYrEnd?`1px solid rgba(255,94,170,.2)`:"1px solid rgba(255,255,255,.04)",
                        background:isYrEnd?"rgba(255,94,170,.04)":i%2===0?"transparent":"rgba(255,255,255,.015)"}}>
                        <td style={{padding:"5px 10px",color:isYrEnd?C.gold:C.white,
                          fontWeight:isYrEnd?700:400}}>{row.label}</td>
                        <td style={{padding:"5px 10px",textAlign:"right",
                          color:row.portCF>=0?C.green:C.red}}>{f.$(row.portCF)}</td>
                        <td style={{padding:"5px 10px",textAlign:"right",color:"#E8D5A3"}}>{f.$(row.fee)}</td>
                        <td style={{padding:"5px 10px",textAlign:"right",color:"#5DADE2"}}>{f.$(row.lp)}</td>
                        <td style={{padding:"5px 10px",textAlign:"right",color:C.gold}}>{f.$(row.gp)}</td>
                        <td style={{padding:"5px 10px",textAlign:"right",color:C.whDim}}>{f.$(row.cumLPCall)}</td>
                      </tr>
                    );
                  });
                })()}
                <tr style={{borderTop:`2px solid ${C.border}`,background:"rgba(255,94,170,.06)"}}>
                  <td style={{padding:"7px 10px",color:C.gold,fontWeight:700}}>7-YR TOTAL</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:C.green,fontWeight:700}}>{f.$(m.totNetOpCF)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:"#E8D5A3",fontWeight:700}}>{f.$(m.totAMFee)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:"#5DADE2",fontWeight:700}}>{f.$(m.totNetOpCF*(1-a.gpPct))}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:C.gold,fontWeight:700}}>{f.$(m.totNetOpCF*a.gpPct)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:C.whDim,fontWeight:700}}>{f.$(m.totLPCalled)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {view==="monthly" && (
        <Card>
          <CT c="Monthly Fund Cash Flow — All 84 Months"/>

          {/* Column explainer */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:14}}>
            {[
              {col:"Portfolio Cash Flow", color:C.green,
                desc:"NOI from all properties minus debt service, property mgmt fees, and asset mgmt fees. Cash the fund actually produces each month."},
              {col:"Mgmt Fee to GP", color:"#E8D5A3",
                desc:"Asset management fee paid monthly by the fund to the GP entity. 1% of invested capital per year, earned as properties close."},
              {col:"LP Cash Flow", color:"#5DADE2",
                desc:"LP's proportional share of portfolio cash flow (98%). This is the running income return distributed to LP investors."},
              {col:"GP Cash Flow", color:C.gold,
                desc:"GP's 2% co-invest share of portfolio cash flow. Separate from fees — this is GP's return on equity invested alongside LPs."},
              {col:"Cumul. LP Called", color:C.whDim,
                desc:"Running total of LP capital drawn down. Grows as each asset closes. Full drawdown complete by month 27."},
            ].map(({col,color,desc})=>(
              <div key={col} style={{background:"rgba(255,255,255,.04)",borderRadius:4,padding:"8px 10px",
                borderTop:`2px solid ${color}`}}>
                <div style={{fontSize:9,color,fontWeight:700,textTransform:"uppercase",
                  letterSpacing:".07em",marginBottom:4}}>{col}</div>
                <div style={{fontSize:9,color:C.whDim,lineHeight:1.5}}>{desc}</div>
              </div>
            ))}
          </div>

          <div style={{overflowX:"auto",maxHeight:420,overflowY:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,whiteSpace:"nowrap"}}>
              <thead style={{position:"sticky",top:0,zIndex:10}}>
                <tr style={{background:C.navy,borderBottom:`1px solid ${C.border}`}}>
                  {[
                    {h:"Mo",        align:"left"},
                    {h:"Portfolio Cash Flow", align:"right", color:C.green},
                    {h:"Mgmt Fee to GP",      align:"right", color:"#E8D5A3"},
                    {h:"LP Cash Flow",        align:"right", color:"#5DADE2"},
                    {h:"GP Cash Flow",        align:"right", color:C.gold},
                    {h:"Cumul. LP Called",    align:"right", color:C.whDim},
                  ].map(({h,align,color})=>(
                    <th key={h} style={{padding:"6px 10px",color:color||C.goldDim,fontSize:9,
                      textTransform:"uppercase",letterSpacing:".06em",
                      textAlign:align,background:C.navy}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {moDetail.map((row,i)=>(
                  <tr key={i} style={{borderBottom:"1px solid rgba(255,255,255,.04)",
                    background:i%2===0?"transparent":"rgba(255,255,255,.015)"}}>
                    <td style={{padding:"5px 10px",color:C.gold,fontWeight:600}}>M{row.mo}</td>
                    <td style={{padding:"5px 10px",textAlign:"right",
                      color:row.portOpCF>=0?C.green:C.red}}>{f.$(row.portOpCF)}</td>
                    <td style={{padding:"5px 10px",textAlign:"right",color:"#E8D5A3"}}>{f.$(row.amFee)}</td>
                    <td style={{padding:"5px 10px",textAlign:"right",color:"#5DADE2"}}>{f.$(row.lpShare)}</td>
                    <td style={{padding:"5px 10px",textAlign:"right",color:C.gold}}>{f.$(row.gpShare)}</td>
                    <td style={{padding:"5px 10px",textAlign:"right",color:C.whDim}}>{f.$(row.cumLPCall)}</td>
                  </tr>
                ))}
                <tr style={{borderTop:`2px solid ${C.border}`,background:"rgba(255,94,170,.06)"}}>
                  <td style={{padding:"7px 10px",color:C.gold,fontWeight:700}}>7-YR TOTAL</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:C.green,fontWeight:700}}>{f.$(m.totNetOpCF)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:"#E8D5A3",fontWeight:700}}>{f.$(m.totAMFee)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:"#5DADE2",fontWeight:700}}>{f.$(m.totNetOpCF*(1-a.gpPct))}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:C.gold,fontWeight:700}}>{f.$(m.totNetOpCF*a.gpPct)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:C.whDim,fontWeight:700}}>{f.$(m.totLPCalled)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// G&A MODEL
// ═══════════════════════════════════════════════════════════════════════════════
function TabGA({m,a,setHire,addHire,removeHire,setOhead,addOhead,removeOhead,setPartnerSal,setOneTime,addOneTime,removeOneTime,addGlobalWithModal}){
  const feeCoverage=m.totFees/m.totGA;
  const [gaView, setGaView] = useState("chart"); // chart | gantt | monthly

  // Build full 84-month G&A detail table with all expense categories
  const monthlyTable = m.gaMonthly.map((x,i)=>({
    mo:         x.mo,
    partnerSal: Math.round(x.partnerSalCost||0),
    staff:      Math.round(x.personnel - (x.partnerSalCost||0)),
    overhead:   Math.round(x.fix),
    oneTime:    Math.round(x.oneTimeHit||0),
    total:      Math.round(x.total),
    fees:       Math.round(m.gpEntity[i]?.fees||0),
    net:        Math.round((m.gpEntity[i]?.fees||0) - x.total),
  }));

  // Quarterly rollup — 28 quarters
  const quarterlyGA = Array.from({length:m.gaMonthly.length>0?a.fundTerm*4:0},(_,q)=>{
    const slice = monthlyTable.slice(q*3,(q+1)*3);
    const yr=Math.floor(q/4)+1, qn=(q%4)+1;
    return {
      label:`Y${yr} Q${qn}`, yr, qn,
      partnerSal: slice.reduce((s,r)=>s+r.partnerSal,0),
      staff:      slice.reduce((s,r)=>s+r.staff,0),
      overhead:   slice.reduce((s,r)=>s+r.overhead,0),
      oneTime:    slice.reduce((s,r)=>s+r.oneTime,0),
      total:      slice.reduce((s,r)=>s+r.total,0),
      fees:       slice.reduce((s,r)=>s+r.fees,0),
      net:        slice.reduce((s,r)=>s+r.net,0),
    };
  });

  // Gantt: each hire gets a color band
  const hireColors = ["#2980B9","#1E8449","#C9A84C","#8E44AD","#E74C3C",
    "#16A085","#D35400","#2C3E50","#27AE60","#7F8C8D","#F39C12"];
  const partnerColors = ["#C9A84C","#E8D5A3","#A0845A"];

  return(
    <div>
      <PHdr title="G&A Model" sub="Hire timing, salaries, overhead, and fee coverage — monthly detail"/>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
        <KPI label="Total G&A (7yr)"       value={f.$(m.totGA)}             sub="All-in incl. partner salaries"/>
        <KPI label="Partner Salaries (7yr)" value={f.$(m.totPartnerSal)}    sub={`Base + ${(a.benefitsRate*100).toFixed(0)}% benefits, excl. promote`}/>
        <KPI label="Total Fee Income"       value={f.$(m.totFees)}          sub="AM + PM fees received by GP"/>
        <KPI label="Fee Coverage"           value={f.p(feeCoverage)}        sub="Fees ÷ total G&A" gold/>
        <KPI label="Net G&A Burden"         value={f.$(m.totGA-m.totFees)}  sub="After fee offset"/>
      </div>

      {/* AM fee explainer */}
      <div style={{background:"rgba(255,94,170,.06)",border:`1px solid rgba(255,94,170,.25)`,
        borderRadius:5,padding:"11px 15px",marginBottom:16,display:"flex",gap:20,flexWrap:"wrap"}}>
        <div style={{fontSize:11,color:C.whDim}}>
          <span style={{color:C.gold,fontWeight:700}}>Where does the AM fee go? </span>
          The {f.p(a.amFee)} annual asset management fee is paid by the fund to the GP entity on invested capital.
          It flows directly into GP operating cash — first offsetting G&A, then available as partner distributions.
          Total 7-yr AM income: <span style={{color:C.gold,fontWeight:600}}>{f.$(m.totAMFee)}</span> · 
          PM fee: <span style={{color:C.gold,fontWeight:600}}>{f.$(m.totPMFee)}</span> · 
          Combined covers <span style={{color:C.gold,fontWeight:600}}>{f.p(m.totFees/m.totGA)}</span> of G&A. Any shortfall (<span style={{color:C.gold}}>{f.$(m.totGAShortfall)}</span>) is funded by LP as additional capital.
        </div>
      </div>

      {/* View toggle */}
      <div style={{display:"flex",gap:4,marginBottom:14}}>
        {[["chart","Charts"],["gantt","Hire Gantt"],["quarterly","Quarterly CF"],["monthly","Monthly CF"]].map(([v,l])=>(
          <button key={v} onClick={()=>setGaView(v)} style={{
            background:gaView===v?C.gold:"transparent",
            color:gaView===v?C.navy:C.goldDim,
            border:`1px solid ${gaView===v?C.gold:"rgba(255,94,170,.2)"}`,
            borderRadius:3,padding:"4px 14px",fontSize:9,fontWeight:700,
            textTransform:"uppercase",letterSpacing:".08em",cursor:"pointer"}}>
            {l}
          </button>
        ))}
      </div>

      {/* CHARTS VIEW */}
      {gaView==="chart" && (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
            <Card>
              <CT c="Monthly G&A by Category"/>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={m.gaMonthly.map(x=>({
                  mo:x.mo,
                  partnerSal:Math.round(x.partnerSalCost||0),
                  staff:Math.round(x.personnel-(x.partnerSalCost||0)),
                  overhead:Math.round(x.fix),
                }))}>
                  <defs>
                    <linearGradient id="gp2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.gold} stopOpacity={.35}/><stop offset="95%" stopColor={C.gold} stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="gs2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.blue} stopOpacity={.4}/><stop offset="95%" stopColor={C.blue} stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="go2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.mid} stopOpacity={.4}/><stop offset="95%" stopColor={C.mid} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="mo" tickFormatter={v=>v%12===0?`M${v}`:""} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
                  <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}K`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={44}/>
                  <Tooltip content={<TT/>}/>
                  <Area stackId="1" type="monotone" dataKey="overhead"   stroke={C.mid}  strokeWidth={1} fill="url(#go2)" name="Overhead"/>
                  <Area stackId="1" type="monotone" dataKey="staff"      stroke={C.blue} strokeWidth={1} fill="url(#gs2)" name="Staff G&A"/>
                  <Area stackId="1" type="monotone" dataKey="partnerSal" stroke={C.gold} strokeWidth={1.5} fill="url(#gp2)" name="Partner Salaries"/>
                </AreaChart>
              </ResponsiveContainer>
            </Card>
            <Card>
              <CT c="Fee Income vs G&A — Monthly Net"/>
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart data={m.gpEntity.map(x=>({
                  mo:x.mo,fees:Math.round(x.fees),ga:Math.round(-x.ga),net:Math.round(x.fees+x.ga)
                }))}>
                  <XAxis dataKey="mo" tickFormatter={v=>v%12===0?`M${v}`:""} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
                  <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}K`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={44}/>
                  <Tooltip content={<TT/>}/>
                  <ReferenceLine y={0} stroke="rgba(255,255,255,.2)"/>
                  <Bar dataKey="fees" name="Fee Income" fill={C.green} radius={[1,1,0,0]}/>
                  <Bar dataKey="ga"   name="G&A Spend"  fill={C.red}   radius={[1,1,0,0]}/>
                  <Line type="monotone" dataKey="net" name="Net" stroke={C.gold} strokeWidth={2} dot={false}/>
                </ComposedChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </div>
      )}

      {/* GANTT VIEW */}
      {gaView==="gantt" && (
        <Card style={{marginBottom:16}}>
          <CT c="Hire Timeline — Cost Ramp (each bar = monthly cost, stacked by role)"/>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={m.gaMonthly.slice(0,36).map((x,i)=>{
              const row={mo:x.mo};
              a.partnerSalaries.forEach((p,pi)=>{
                const y=i>=p.start-1?Math.floor((i-(p.start-1))/12):0;
                row[`ps${pi}`]=i+1>=p.start?Math.round(p.salary*Math.pow(1+a.salaryGrowth,y)*(1+a.benefitsRate)/12):0;
              });
              a.hires.forEach((h,hi)=>{
                const y=i>=h.start-1?Math.floor((i-(h.start-1))/12):0;
                row[`h${hi}`]=i+1>=h.start?Math.round(h.salary*Math.pow(1+a.salaryGrowth,y)*(1+a.benefitsRate)/12*h.alloc):0;
              });
              row.overhead=Math.round(x.fix);
              return row;
            })} margin={{top:4,right:4,bottom:4,left:4}}>
              <XAxis dataKey="mo" tickFormatter={v=>`M${v}`} tick={{fill:C.whDim,fontSize:8}} axisLine={false} tickLine={false}/>
              <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}K`} tick={{fill:C.whDim,fontSize:8}} axisLine={false} tickLine={false} width={40}/>
              <Tooltip content={<TT/>}/>
              {a.partnerSalaries.map((_,pi)=>(
                <Bar key={`ps${pi}`} stackId="a" dataKey={`ps${pi}`} name={a.partnerSalaries[pi].role.split('/')[0].trim()} fill={partnerColors[pi]||C.gold} radius={pi===0?[0,0,0,0]:[0,0,0,0]}/>
              ))}
              {a.hires.map((_,hi)=>(
                <Bar key={`h${hi}`} stackId="a" dataKey={`h${hi}`} name={a.hires[hi].role} fill={hireColors[hi%hireColors.length]}/>
              ))}
              <Bar stackId="a" dataKey="overhead" name="Overhead" fill="rgba(255,255,255,0.1)" radius={[2,2,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
          {/* Legend */}
          <div style={{display:"flex",flexWrap:"wrap",gap:"6px 14px",marginTop:10}}>
            {a.partnerSalaries.map((p,pi)=>(
              <div key={pi} style={{display:"flex",alignItems:"center",gap:5,fontSize:9,color:C.whDim}}>
                <div style={{width:10,height:10,background:partnerColors[pi]||C.gold,borderRadius:1}}/>
                {p.role.split('/')[0].trim()}
              </div>
            ))}
            {a.hires.map((h,hi)=>(
              <div key={hi} style={{display:"flex",alignItems:"center",gap:5,fontSize:9,color:C.whDim}}>
                <div style={{width:10,height:10,background:hireColors[hi%hireColors.length],borderRadius:1}}/>
                {h.role}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* MONTHLY DETAIL VIEW */}
      {(gaView==="quarterly"||gaView==="monthly") && (() => {
        // Shared column legend
        const legend = (
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:5,marginBottom:14}}>
            {[
              {col:"Partner Salaries", color:"#E8D5A3", desc:"CEO/COO/CIO base comp + benefits"},
              {col:"Staff G&A",        color:C.blue,    desc:"All hires × salary × benefits allocation %"},
              {col:"Overhead",         color:C.whDim,   desc:"Recurring overhead ramping to full run-rate"},
              {col:"One-Time",         color:"#A569BD", desc:"Setup, build-out, implementation costs"},
              {col:"Total G&A",        color:C.white,   desc:"All expenses combined"},
              {col:"Fee Income",       color:C.green,   desc:"AM fees + PM fees received by GP entity"},
              {col:"Net (Fee − G&A)",  color:C.gold,    desc:"Positive = fees cover expenses. Negative = LP-funded shortfall"},
            ].map(({col,color,desc})=>(
              <div key={col} style={{background:"rgba(255,255,255,.04)",borderRadius:4,
                padding:"6px 8px",borderTop:`2px solid ${color}`}}>
                <div style={{fontSize:8,color,fontWeight:700,textTransform:"uppercase",
                  letterSpacing:".06em",marginBottom:3}}>{col}</div>
                <div style={{fontSize:8,color:C.whDim,lineHeight:1.5}}>{desc}</div>
              </div>
            ))}
          </div>
        );

        const cols = [
          {h:"Period",        align:"left",  color:C.gold},
          {h:"Partner Sal",   align:"right", color:"#E8D5A3"},
          {h:"Staff G&A",     align:"right", color:C.blue},
          {h:"Overhead",      align:"right", color:C.whDim},
          {h:"One-Time",      align:"right", color:"#A569BD"},
          {h:"Total G&A",     align:"right", color:C.white},
          {h:"Fee Income",    align:"right", color:C.green},
          {h:"Net",           align:"right", color:C.gold},
        ];

        const renderRow = (row, key, label, isYrEnd=false, isTotals=false) => (
          <tr key={key} style={{
            borderBottom: isYrEnd?`1px solid rgba(255,94,170,.25)`:"1px solid rgba(255,255,255,.04)",
            background: isTotals?"rgba(255,94,170,.07)":isYrEnd?"rgba(255,94,170,.04)":
              (key%2===0?"transparent":"rgba(255,255,255,.015)")}}>
            <td style={{padding:"5px 8px",color:isTotals||isYrEnd?C.gold:C.white,
              fontWeight:isTotals||isYrEnd?700:400}}>{label}</td>
            <td style={{padding:"5px 8px",textAlign:"right",color:"#E8D5A3",
              fontWeight:isTotals?700:400}}>{f.$(row.partnerSal)}</td>
            <td style={{padding:"5px 8px",textAlign:"right",color:C.blue,
              fontWeight:isTotals?700:400}}>{f.$(row.staff)}</td>
            <td style={{padding:"5px 8px",textAlign:"right",color:C.whDim,
              fontWeight:isTotals?700:400}}>{f.$(row.overhead)}</td>
            <td style={{padding:"5px 8px",textAlign:"right",color:"#A569BD",
              fontWeight:isTotals?700:400}}>{row.oneTime>0?f.$(row.oneTime):"—"}</td>
            <td style={{padding:"5px 8px",textAlign:"right",color:C.white,
              fontWeight:isTotals||isYrEnd?700:400}}>{f.$(row.total)}</td>
            <td style={{padding:"5px 8px",textAlign:"right",color:C.green,
              fontWeight:isTotals?700:400}}>{f.$(row.fees)}</td>
            <td style={{padding:"5px 8px",textAlign:"right",fontWeight:isTotals||isYrEnd?700:400,
              color:row.net>=0?C.green:C.red}}>{f.$(row.net)}</td>
          </tr>
        );

        const totals = {
          partnerSal: monthlyTable.reduce((s,r)=>s+r.partnerSal,0),
          staff:      monthlyTable.reduce((s,r)=>s+r.staff,0),
          overhead:   monthlyTable.reduce((s,r)=>s+r.overhead,0),
          oneTime:    monthlyTable.reduce((s,r)=>s+r.oneTime,0),
          total:      monthlyTable.reduce((s,r)=>s+r.total,0),
          fees:       monthlyTable.reduce((s,r)=>s+r.fees,0),
          net:        monthlyTable.reduce((s,r)=>s+r.net,0),
        };

        const tableHead = (
          <thead style={{position:"sticky",top:0,zIndex:10}}>
            <tr style={{background:C.navy,borderBottom:`1px solid ${C.border}`}}>
              {cols.map(({h,align,color})=>(
                <th key={h} style={{padding:"6px 8px",color:color||C.goldDim,fontSize:9,
                  textTransform:"uppercase",letterSpacing:".06em",
                  textAlign:align,background:C.navy,whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
        );

        return (
          <Card style={{marginBottom:16}}>
            <CT c={gaView==="quarterly"?"Quarterly G&A Cash Flow — All 28 Quarters":"Monthly G&A Cash Flow — All 84 Months"}/>
            {legend}
            <div style={{overflowX:"auto",maxHeight:520,overflowY:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,whiteSpace:"nowrap"}}>
                {tableHead}
                <tbody>
                  {gaView==="quarterly"
                    ? quarterlyGA.map((row,i)=>renderRow(row,i,row.label,row.qn===4))
                    : monthlyTable.map((row,i)=>{
                        const isYrEnd=row.mo%12===0;
                        return renderRow(row,i,`M${row.mo}`,isYrEnd);
                      })
                  }
                  {renderRow(totals,"total","7-YR TOTAL",false,true)}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })()}

      {/* PARTNER SALARIES TABLE */}
      <Card style={{marginBottom:16}}>
        <CT c="Partner Base Salaries (Separate from Promote &amp; Draws)"/>
        <div style={{fontSize:10,color:C.goldDim,marginBottom:10}}>
          Partner salaries are a G&A expense paid by the GP entity from fee income. Promote and draws are separate at exit/distribution.
        </div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${C.border}`}}>
              {["Role","Annual Salary","Start Month","7-Yr Total (w/ benefits)",""].map(h=>(
                <th key={h} style={{padding:"5px 8px",color:C.goldDim,fontSize:9,textTransform:"uppercase",
                  letterSpacing:".06em",textAlign:h==="Role"?"left":"center"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {a.partnerSalaries.map((p,idx)=>{
              const total7=Array.from({length:84},(_,i)=>{
                const mo=i+1;
                if(mo<p.start)return 0;
                const y=Math.floor((mo-p.start)/12);
                return(p.salary*Math.pow(1+a.salaryGrowth,y)/12)*(1+a.benefitsRate);
              }).reduce((s,v)=>s+v,0);
              return(
                <tr key={idx} style={{borderBottom:"1px solid rgba(255,255,255,.04)",
                  background:idx%2===0?"transparent":"rgba(255,255,255,.02)"}}>
                  <td style={{padding:"7px 8px",color:C.gold,fontWeight:600}}>{p.role}</td>
                  <td style={{padding:"7px 8px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"center"}}>
                      <MiniSlider value={p.salary} min={50000} max={500000} step={10000} onChange={v=>setPartnerSal(idx,"salary",v)} color={C.gold} width={90}/>
                      <span style={{color:C.gold,minWidth:60,fontSize:11}}>{f.$(p.salary)}</span>
                    </div>
                  </td>
                  <td style={{padding:"7px 8px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"center"}}>
                      <MiniSlider value={p.start} min={1} max={36} step={1} onChange={v=>setPartnerSal(idx,"start",v)} color={C.blue} width={60}/>
                      <span style={{color:"#5DADE2",minWidth:26,fontSize:11}}>M{p.start}</span>
                    </div>
                  </td>
                  <td style={{padding:"7px 8px",color:C.gold,textAlign:"center",fontWeight:600}}>{f.$(total7)}</td>
                  <td style={{padding:"7px 8px",textAlign:"center"}}>
                    <button onClick={()=>removeHire(idx)}
                      style={{background:"rgba(192,57,43,.15)",border:`1px solid rgba(192,57,43,.3)`,
                        color:C.red,borderRadius:3,padding:"2px 7px",fontSize:9,cursor:"pointer"}}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{display:"flex",gap:6,marginTop:8}}>
          <button onClick={()=>addHire("scenario")} style={{
            flex:1,padding:"9px",
            background:"rgba(41,128,185,.06)",border:`1px dashed rgba(41,128,185,.3)`,
            color:"#5DADE2",borderRadius:5,fontSize:10,fontWeight:600,cursor:"pointer"}}>
            + Add Scenario Hire
          </button>
          <button onClick={()=>addGlobalWithModal("hires")} style={{
            flex:1,padding:"9px",
            background:"rgba(255,94,170,.1)",border:`1px dashed rgba(255,94,170,.4)`,
            color:C.gold,borderRadius:5,fontSize:10,fontWeight:600,cursor:"pointer"}}>
            + Add Global Hire
          </button>
        </div>
      </Card>

      {/* STAFF TABLE */}
      <Card style={{marginBottom:16}}>
        <CT c="Staff Headcount — Hire Timing &amp; Salaries"/>
        <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:580}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${C.border}`}}>
              {["Role","Annual Salary","Hire Month","G&A Alloc","7-Yr Cost",""].map(h=>(
                <th key={h} style={{padding:"5px 6px",color:C.goldDim,fontSize:9,textTransform:"uppercase",
                  letterSpacing:".06em",textAlign:h==="Role"?"left":"center",whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {a.hires.map((h,idx)=>{
              const total7=m.gaMonthly.reduce((s,x,i)=>{
                const mo=i+1;
                if(mo<h.start)return s;
                const y=Math.floor((mo-h.start)/12);
                return s+(h.salary*Math.pow(1+a.salaryGrowth,y)/12)*h.alloc*(1+a.benefitsRate);
              },0);
              return(
                <tr key={idx} style={{borderBottom:"1px solid rgba(255,255,255,.04)",
                  background:idx%2===0?"transparent":"rgba(255,255,255,.015)"}}>
                  <td style={{padding:"6px 6px",color:C.white}}>
                    <div style={{display:"flex",alignItems:"center",gap:5}}>
                      <input value={h.role} onChange={e=>setHire(idx,"role",e.target.value)}
                        style={{background:"transparent",border:"none",borderBottom:`1px solid rgba(255,255,255,.15)`,
                          color:C.white,fontSize:10,fontWeight:600,outline:"none",width:95,padding:"1px 0"}}/>
                      <button onClick={()=>setHire(idx,"scope",h.scope==="global"?"scenario":"global")}
                        title={h.scope==="global"?"Global: change applies to all scenarios":"Scenario: change only affects current scenario"}
                        style={{padding:"1px 5px",borderRadius:3,fontSize:7,fontWeight:700,cursor:"pointer",
                          background:h.scope==="global"?"rgba(255,94,170,.2)":"rgba(255,255,255,.06)",
                          color:h.scope==="global"?C.gold:C.whDim,
                          border:`1px solid ${h.scope==="global"?"rgba(255,94,170,.4)":"rgba(255,255,255,.1)"}`}}>
                        {h.scope==="global"?"G":"S"}
                      </button>
                    </div>
                  </td>
                  <td style={{padding:"6px 5px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"center"}}>
                      <MiniSlider value={h.salary} min={40000} max={250000} step={5000} onChange={v=>setHire(idx,"salary",v)} color={C.gold} width={60}/>
                      <span style={{color:C.gold,minWidth:48,fontSize:10}}>{f.$(h.salary)}</span>
                    </div>
                  </td>
                  <td style={{padding:"6px 5px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"center"}}>
                      <MiniSlider value={h.start} min={1} max={84} step={1} onChange={v=>setHire(idx,"start",v)} color={C.blue} width={50}/>
                      <span style={{color:"#5DADE2",minWidth:24,fontSize:10}}>M{h.start}</span>
                    </div>
                  </td>
                  <td style={{padding:"6px 5px",color:C.whDim,textAlign:"center",fontSize:10}}>{f.p(h.alloc)}</td>
                  <td style={{padding:"6px 5px",color:C.gold,textAlign:"center",fontWeight:600,fontSize:10}}>{f.$(total7)}</td>
                  <td style={{padding:"6px 5px",textAlign:"center"}}>
                    <button onClick={()=>removeHire(idx)}
                      style={{background:"rgba(192,57,43,.15)",border:`1px solid rgba(192,57,43,.3)`,
                        color:C.red,borderRadius:3,padding:"2px 7px",fontSize:9,cursor:"pointer"}}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <div style={{display:"flex",gap:6,marginTop:8}}>
          <button onClick={()=>addHire("scenario")} style={{
            flex:1,padding:"9px",
            background:"rgba(41,128,185,.06)",border:`1px dashed rgba(41,128,185,.3)`,
            color:"#5DADE2",borderRadius:5,fontSize:10,fontWeight:600,cursor:"pointer"}}>
            + Add Scenario Hire
          </button>
          <button onClick={()=>addGlobalWithModal("hires")} style={{
            flex:1,padding:"9px",
            background:"rgba(255,94,170,.1)",border:`1px dashed rgba(255,94,170,.4)`,
            color:C.gold,borderRadius:5,fontSize:10,fontWeight:600,cursor:"pointer"}}>
            + Add Global Hire
          </button>
        </div>
      </Card>

      {/* OVERHEAD TABLE */}
      <Card style={{marginBottom:16}}>
        <CT c="Recurring Overhead — Budget, Start/End &amp; Ramp-Up Period"/>
        <div style={{fontSize:10,color:C.goldDim,marginBottom:10}}>
          End = month when expense stops (dash = runs to fund end). Ramp = months to reach full run-rate from start.
        </div>
        <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:700}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${C.border}`}}>
              {["Line Item","Annual $","Start","End","Ramp","Growth","Scope","7-Yr Total",""].map(h=>(
                <th key={h} style={{padding:"5px 6px",color:C.goldDim,fontSize:9,textTransform:"uppercase",
                  letterSpacing:".06em",textAlign:h==="Line Item"?"left":"center",whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {a.overhead.map((o,idx)=>{
              const total7=Array.from({length:84},(_,i)=>{
                const mo=i+1;
                if(mo<o.start) return 0;
                if(o.end&&o.end>0&&mo>o.end) return 0;
                const yr=Math.floor(i/12);
                let base=o.annual;
                if(o.ramps){const props=a.assets.filter(x=>x.startMonth<=mo).length;base=props*250*12;}
                const ramp=o.rampMo&&o.rampMo>1?Math.min(1,(mo-o.start+1)/o.rampMo):1;
                return(base*Math.pow(1+o.growth,yr)/12)*ramp;
              }).reduce((s,v)=>s+v,0);
              // Show what month 1 actually costs vs full run-rate
              const mo1pct=o.rampMo&&o.rampMo>1?Math.min(1,1/o.rampMo):1;
              return(
                <tr key={idx} style={{borderBottom:"1px solid rgba(255,255,255,.04)",
                  background:idx%2===0?"transparent":"rgba(255,255,255,.015)"}}>
                  <td style={{padding:"6px 6px",color:C.white}}>
                    <input value={o.label} onChange={e=>setOhead(idx,"label",e.target.value)}
                      style={{background:"transparent",border:"none",borderBottom:`1px solid rgba(255,255,255,.15)`,
                        color:C.white,fontSize:10,fontWeight:600,outline:"none",width:100,padding:"1px 0"}}/>
                  </td>
                  <td style={{padding:"6px 5px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"center"}}>
                      <MiniSlider value={o.annual} min={2000} max={200000} step={1000} onChange={v=>setOhead(idx,"annual",v)} color={C.gold} width={55}/>
                      <span style={{color:C.gold,minWidth:44,fontSize:10}}>{f.$(o.annual)}</span>
                    </div>
                  </td>
                  <td style={{padding:"6px 4px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:3,justifyContent:"center"}}>
                      <MiniSlider value={o.start} min={1} max={36} step={1} onChange={v=>setOhead(idx,"start",v)} color={C.blue} width={40}/>
                      <span style={{color:"#5DADE2",minWidth:22,fontSize:10}}>M{o.start}</span>
                    </div>
                  </td>
                  <td style={{padding:"6px 4px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:3,justifyContent:"center"}}>
                      <MiniSlider value={o.end||0} min={0} max={84} step={1} onChange={v=>setOhead(idx,"end",v)} color={o.end&&o.end>0?"#E67E22":C.whDim} width={40}/>
                      <span style={{color:o.end&&o.end>0?"#E67E22":C.whDim,minWidth:24,fontSize:10}}>
                        {o.end&&o.end>0?`M${o.end}`:"—"}
                      </span>
                    </div>
                  </td>
                  <td style={{padding:"6px 4px"}}>
                    {!o.ramps&&(
                      <div style={{display:"flex",alignItems:"center",gap:3,justifyContent:"center"}}>
                        <MiniSlider value={o.rampMo||1} min={1} max={24} step={1} onChange={v=>setOhead(idx,"rampMo",v)} color={"#A569BD"} width={40}/>
                        <span style={{color:"#A569BD",minWidth:30,fontSize:9}}>{o.rampMo||1}mo</span>
                      </div>
                    )}
                    {o.ramps&&<span style={{color:C.goldDim,fontSize:9,display:"block",textAlign:"center"}}>w/ deals</span>}
                  </td>
                  <td style={{padding:"6px 4px",color:C.whDim,textAlign:"center",fontSize:9,whiteSpace:"nowrap"}}>
                    {o.ramps?"deals":`${(o.growth*100).toFixed(0)}%`}
                  </td>
                  <td style={{padding:"6px 4px",textAlign:"center"}}>
                    <button onClick={()=>setOhead(idx,"scope",o.scope==="global"?"scenario":"global")}
                      title={o.scope==="global"?"Global: change applies to all scenarios":"Scenario: change only affects current scenario"}
                      style={{padding:"2px 5px",borderRadius:3,fontSize:7,fontWeight:700,cursor:"pointer",
                        background:o.scope==="global"?"rgba(255,94,170,.2)":"rgba(255,255,255,.06)",
                        color:o.scope==="global"?C.gold:C.whDim,
                        border:`1px solid ${o.scope==="global"?"rgba(255,94,170,.4)":"rgba(255,255,255,.1)"}`}}>
                      {o.scope==="global"?"G":"S"}
                    </button>
                  </td>
                  <td style={{padding:"6px 4px",color:C.gold,textAlign:"center",fontWeight:600,fontSize:10}}>{f.$(total7)}</td>
                  <td style={{padding:"6px 4px",textAlign:"center"}}>
                    <button onClick={()=>removeOhead(idx)}
                      style={{background:"rgba(192,57,43,.15)",border:`1px solid rgba(192,57,43,.3)`,
                        color:C.red,borderRadius:3,padding:"2px 6px",fontSize:9,cursor:"pointer"}}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <div style={{display:"flex",gap:6,marginTop:8}}>
          <button onClick={()=>addOhead("scenario")} style={{
            flex:1,padding:"9px",
            background:"rgba(255,94,170,.06)",border:`1px dashed rgba(255,94,170,.25)`,
            color:C.goldDim,borderRadius:5,fontSize:10,fontWeight:600,cursor:"pointer"}}>
            + Add Scenario Overhead
          </button>
          <button onClick={()=>addGlobalWithModal("overhead")} style={{
            flex:1,padding:"9px",
            background:"rgba(255,94,170,.15)",border:`1px dashed rgba(255,94,170,.5)`,
            color:C.gold,borderRadius:5,fontSize:10,fontWeight:600,cursor:"pointer"}}>
            + Add Global Overhead
          </button>
        </div>
      </Card>

      {/* ONE-TIME EXPENSES */}
      <Card>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <CT c="One-Time &amp; Irregular Expenses"/>
          <div style={{display:"flex",gap:4}}>
            <button onClick={()=>addOneTime("scenario")} style={{
              background:"rgba(255,255,255,.08)",color:C.whDim,border:"none",borderRadius:3,
              padding:"4px 10px",fontSize:9,fontWeight:700,letterSpacing:".08em",
              textTransform:"uppercase",cursor:"pointer"}}>+ Scen.</button>
            <button onClick={()=>addGlobalWithModal("oneTime")} style={{
              background:C.gold,color:C.navy,border:"none",borderRadius:3,
              padding:"4px 10px",fontSize:9,fontWeight:700,letterSpacing:".08em",
              textTransform:"uppercase",cursor:"pointer"}}>+ Global</button>
          </div>
        </div>
        <div style={{fontSize:10,color:C.goldDim,marginBottom:10}}>
          Single-month hits — setup costs, build-outs, audits, system implementations. Enter month number.
        </div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${C.border}`}}>
              {["Description","Amount","Month","Category","Scope",""].map(h=>(
                <th key={h} style={{padding:"5px 8px",color:C.goldDim,fontSize:9,textTransform:"uppercase",
                  letterSpacing:".06em",textAlign:h==="Description"?"left":"center"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(a.oneTime||[]).map((e,idx)=>{
              const catColors={Legal:"#A569BD",CapEx:C.gold,Tech:"#5DADE2",Marketing:C.green,Other:C.whDim};
              const col=catColors[e.category]||C.whDim;
              return(
                <tr key={idx} style={{borderBottom:"1px solid rgba(255,255,255,.04)",
                  background:idx%2===0?"transparent":"rgba(255,255,255,.015)"}}>
                  <td style={{padding:"6px 8px"}}>
                    <input value={e.label} onChange={ev=>setOneTime(idx,"label",ev.target.value)}
                      style={{background:"transparent",border:"none",borderBottom:`1px solid rgba(255,255,255,.15)`,
                        color:C.white,fontSize:11,width:"100%",outline:"none",padding:"2px 0"}}/>
                  </td>
                  <td style={{padding:"6px 8px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:5,justifyContent:"center"}}>
                      <MiniSlider value={e.amount} min={1000} max={250000} step={1000} onChange={v=>setOneTime(idx,"amount",v)} color={C.gold} width={70}/>
                      <span style={{color:C.gold,minWidth:52,fontSize:11}}>{f.$(e.amount)}</span>
                    </div>
                  </td>
                  <td style={{padding:"6px 8px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"center"}}>
                      <MiniSlider value={e.month} min={1} max={84} step={1} onChange={v=>setOneTime(idx,"month",v)} color={C.blue} width={55}/>
                      <span style={{color:"#5DADE2",minWidth:24,fontSize:11}}>M{e.month}</span>
                    </div>
                  </td>
                  <td style={{padding:"6px 8px",textAlign:"center"}}>
                    <select value={e.category}
                      onChange={ev=>setOneTime(idx,"category",ev.target.value)}
                      style={{background:C.dark,border:`1px solid ${C.border}`,color:col,
                        borderRadius:3,padding:"2px 6px",fontSize:10,cursor:"pointer"}}>
                      {["Legal","CapEx","Tech","Marketing","Other"].map(c=>(
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{padding:"6px 8px",textAlign:"center"}}>
                    <button onClick={()=>setOneTime(idx,"scope",e.scope==="global"?"scenario":"global")}
                      style={{padding:"2px 7px",borderRadius:3,fontSize:8,fontWeight:700,cursor:"pointer",
                        letterSpacing:".06em",textTransform:"uppercase",
                        background:e.scope==="global"?"rgba(255,94,170,.2)":"rgba(255,255,255,.06)",
                        color:e.scope==="global"?C.gold:C.whDim,
                        border:`1px solid ${e.scope==="global"?"rgba(255,94,170,.4)":"rgba(255,255,255,.1)"}`}}>
                      {e.scope==="global"?"Global":"Scen."}
                    </button>
                  </td>
                  <td style={{padding:"6px 8px",textAlign:"center"}}>
                    <button onClick={()=>removeOneTime(idx)}
                      style={{background:"rgba(192,57,43,.2)",border:`1px solid ${C.red}`,
                        color:C.red,borderRadius:3,padding:"2px 8px",fontSize:9,cursor:"pointer"}}>✕</button>
                  </td>
                </tr>
              );
            })}
            {(a.oneTime||[]).length>0&&(
              <tr style={{borderTop:`1px solid ${C.border}`,background:"rgba(255,94,170,.05)"}}>
                <td style={{padding:"7px 8px",color:C.gold,fontWeight:700,fontSize:11}}>Total One-Time</td>
                <td style={{padding:"7px 8px",color:C.gold,fontWeight:700,textAlign:"center"}}>
                  {f.$((a.oneTime||[]).reduce((s,e)=>s+e.amount,0))}
                </td>
                <td colSpan={4}/>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// GP PARTNERS
// ═══════════════════════════════════════════════════════════════════════════════
function TabGPPartners({m,a}){
  const n=a.partners;
  const labels=["Partner 1","Partner 2","Partner 3","Partner 4","Partner 5"].slice(0,n);

  return(
    <div>
      <PHdr title="GP Partner Economics"
        sub={`${n} equal partners · ${f.p(1/n)} each · all figures shown per partner`}/>

      <div style={{background:"rgba(255,94,170,.06)",border:`1px solid rgba(255,94,170,.2)`,
        borderRadius:5,padding:"10px 14px",marginBottom:14,fontSize:11,color:C.whDim}}>
        <span style={{color:C.gold,fontWeight:700}}>Partner compensation stack: </span>
        Base salary (G&A expense, paid monthly from fee income) +
        Operating draws (when GP entity cash flow is positive) +
        Promote at exit (20% carry above {f.p(a.prefReturn)} pref).
        Total per-partner base salary 7-yr: <span style={{color:C.gold}}>{f.$(m.totPartnerSal/a.partners)}</span> · LP funds any G&A shortfall above fees: <span style={{color:C.gold}}>{f.$(m.totGAShortfall)}</span>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
        <KPI label="Promote at Exit"   value={f.$(m.promPP)}     sub={`${f.p(a.carry)} carry ÷ ${n}`} gold/>
        <KPI label="Operating Draws"   value={f.$(m.drawsPP)}    sub="Positive monthly CF months"/>
        <KPI label="Return of Capital" value={f.$(m.rocPP)}      sub="Co-invest returned at exit"/>
        <KPI label="Total 7-Yr"        value={f.$(m.totalPP)}    sub="Draws + ROC + promote"/>
        <KPI label="Net After Co-inv"  value={f.$(m.netPP)}      sub="After capital deployed"/>
        <KPI label="Capital Deployed"  value={f.$(m.coInvPP)}    sub={`Equity + funded G&A shortfall`}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <Card>
          <CT c="Per-Partner Economics — Sources &amp; Uses"/>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart layout="vertical" margin={{left:10,right:10}} data={[
              {name:"Co-invest Out", value:-m.coInvPP,  fill:C.red},
              {name:"Op Draws",      value:m.drawsPP,   fill:C.blue},
              {name:"ROC",           value:m.rocPP,     fill:C.mid},
              {name:"Promote",       value:m.promPP,    fill:C.gold},
              {name:"Net Return",    value:m.netPP,     fill:m.netPP>0?C.green:C.red},
            ]}>
              <XAxis type="number" tickFormatter={v=>`$${(v/1e6).toFixed(1)}M`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
              <YAxis type="category" dataKey="name" tick={{fill:C.whDim,fontSize:10}} axisLine={false} tickLine={false} width={90}/>
              <Tooltip content={<TT/>}/>
              <ReferenceLine x={0} stroke="rgba(255,255,255,.2)"/>
              <Bar dataKey="value" name="Amount" radius={[0,3,3,0]}>
                {[{fill:C.red},{fill:C.blue},{fill:C.mid},{fill:C.gold},{fill:m.netPP>0?C.green:C.red}].map((e,i)=>(
                  <Cell key={i} fill={e.fill}/>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <CT c="Cumulative Cash Position Per Partner"/>
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={m.partnerCum}>
              <defs><linearGradient id="pp1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.gold} stopOpacity={.3}/>
                <stop offset="95%" stopColor={C.gold} stopOpacity={0}/>
              </linearGradient></defs>
              <XAxis dataKey="mo" tickFormatter={v=>`M${v}`} tick={{fill:C.whDim,fontSize:8}} axisLine={false} tickLine={false}/>
              <YAxis tickFormatter={v=>`$${(v/1e6).toFixed(1)}M`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={42}/>
              <Tooltip content={<TT/>}/>
              <ReferenceLine y={0} stroke={C.gold} strokeDasharray="5 3"
                label={{value:"Breakeven",fill:C.goldDim,fontSize:9,position:"insideTopLeft"}}/>
              <Area type="monotone" dataKey="cum" stroke={C.gold} strokeWidth={2} fill="url(#pp1)" name="Cumulative"/>
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Partner table */}
      <Card style={{marginBottom:16}}>
        <CT c="Partner Summary Table"/>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${C.border}`}}>
              {["Partner","Share","Co-invest","Draws","ROC","Promote","Gross Total","Net Return"].map(h=>(
                <th key={h} style={{padding:"7px 9px",color:C.goldDim,fontSize:9,
                  textTransform:"uppercase",letterSpacing:".06em",
                  textAlign:h==="Partner"?"left":"right"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((p,i)=>(
              <tr key={i} style={{borderBottom:"1px solid rgba(255,255,255,.04)",
                background:i%2===0?"transparent":"rgba(255,255,255,.02)"}}>
                <td style={{padding:"9px 9px",color:C.white,fontWeight:600}}>{p}</td>
                <td style={{padding:"9px 9px",color:C.whDim,textAlign:"right"}}>{f.p(1/n)}</td>
                <td style={{padding:"9px 9px",color:C.red,textAlign:"right"}}>({f.$(m.coInvPP)})</td>
                <td style={{padding:"9px 9px",color:C.blue,textAlign:"right"}}>{f.$(m.drawsPP)}</td>
                <td style={{padding:"9px 9px",color:C.whDim,textAlign:"right"}}>{f.$(m.rocPP)}</td>
                <td style={{padding:"9px 9px",color:C.gold,fontWeight:700,textAlign:"right"}}>{f.$(m.promPP)}</td>
                <td style={{padding:"9px 9px",color:C.white,fontWeight:700,textAlign:"right"}}>{f.$(m.totalPP)}</td>
                <td style={{padding:"9px 9px",fontWeight:700,textAlign:"right",
                  color:m.netPP>0?C.green:C.red}}>{f.$(m.netPP)}</td>
              </tr>
            ))}
            {/* Totals row */}
            <tr style={{borderTop:`1px solid ${C.border}`,background:"rgba(255,94,170,.06)"}}>
              <td style={{padding:"9px 9px",color:C.gold,fontWeight:700}}>TOTAL</td>
              <td style={{padding:"9px 9px",color:C.gold,textAlign:"right",fontWeight:700}}>100%</td>
              <td style={{padding:"9px 9px",color:C.red,textAlign:"right",fontWeight:700}}>({f.$(m.totGPCalled)})</td>
              <td style={{padding:"9px 9px",color:C.blue,textAlign:"right",fontWeight:700}}>{f.$(m.drawsPP*n)}</td>
              <td style={{padding:"9px 9px",color:C.whDim,textAlign:"right",fontWeight:700}}>{f.$(m.gpROC)}</td>
              <td style={{padding:"9px 9px",color:C.gold,textAlign:"right",fontWeight:700}}>{f.$(m.gpPromote)}</td>
              <td style={{padding:"9px 9px",color:C.white,textAlign:"right",fontWeight:700}}>{f.$(m.totalPP*n)}</td>
              <td style={{padding:"9px 9px",textAlign:"right",fontWeight:700,
                color:m.netPP>0?C.green:C.red}}>{f.$(m.netPP*n)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      {/* Monthly draw */}
      <Card>
        <CT c="Monthly Draw Available Per Partner (excl. promote at exit)"/>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={m.partnerMonthly}>
            <XAxis dataKey="mo" tickFormatter={v=>v%12===0?`M${v}`:""} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
            <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}K`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={38}/>
            <Tooltip content={<TT/>}/>
            <ReferenceLine y={0} stroke="rgba(255,255,255,.2)"/>
            <Bar dataKey="draw" name="Draw/Partner" radius={[1,1,0,0]}>
              {m.partnerMonthly.map((e,i)=><Cell key={i} fill={e.draw>0?C.blue:C.red}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SENSITIVITY
// ═══════════════════════════════════════════════════════════════════════════════
function TabSensitivity({m,a}){
  const exitCaps=[.065,.070,.075,.080,.085,.090];
  const noiGrowths=[.03,.05,.07,.09];
  const rates=[.05,.055,.06,.065,.07,.075,.08];
  return(
    <div>
      <PHdr title="Sensitivity Analysis" sub="LP IRR across key assumption combinations — current assumptions highlighted"/>
      <Card style={{marginBottom:18}}>
        <CT c="LP IRR Matrix — Exit Cap Rate × NOI Growth"/>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr style={{borderBottom:`1px solid ${C.border}`}}>
                <th style={{padding:"7px 11px",color:C.goldDim,fontSize:9,
                  textTransform:"uppercase",letterSpacing:".07em",textAlign:"left"}}>
                  Exit Cap ↓ / NOI Growth →
                </th>
                {noiGrowths.map(g=>(
                  <th key={g} style={{padding:"7px 14px",color:C.gold,fontSize:10,textAlign:"center"}}>
                    {(g*100).toFixed(0)}% growth
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {exitCaps.map(ec=>(
                <tr key={ec} style={{borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                  <td style={{padding:"9px 11px",fontSize:11,
                    color:Math.abs(ec-a.exitCapRate)<.001?C.gold:C.whDim,
                    fontWeight:Math.abs(ec-a.exitCapRate)<.001?700:400}}>
                    {(ec*100).toFixed(1)}% {Math.abs(ec-a.exitCapRate)<.001&&"◀"}
                  </td>
                  {noiGrowths.map(g=>{
                    const r2=run({...a,exitCapRate:ec,assets:a.assets.map(x=>({...x,growth:g}))});
                    const v=r2.lpIRR;
                    const isCur=Math.abs(ec-a.exitCapRate)<.001&&Math.abs(g-a.assets[0].growth)<.001;
                    const bg=v>.18?"rgba(30,132,73,.25)":v>.14?"rgba(255,94,170,.12)":"rgba(192,57,43,.2)";
                    const clr=v>.18?C.green:v>.14?C.white:C.red;
                    return(
                      <td key={g} style={{padding:"9px 14px",textAlign:"center",fontSize:12,
                        background:isCur?"rgba(255,94,170,.22)":bg,color:clr,fontWeight:isCur?700:500,
                        border:isCur?`1px solid ${C.gold}`:"none"}}>
                        {f.p(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{display:"flex",gap:14,marginTop:10,fontSize:10}}>
          {[["rgba(30,132,73,.3)","> 18%"],["rgba(255,94,170,.15)","14–18%"],["rgba(192,57,43,.25)","< 14%"]].map(([bg,l])=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:5}}>
              <div style={{width:12,height:12,background:bg,borderRadius:2}}/>
              <span style={{color:C.whDim}}>{l}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CT c="LP IRR vs Interest Rate"/>
        {(()=>{
          const irrData=rates.map(r=>({rate:`${(r*100).toFixed(1)}%`,irr:run({...a,interestRate:r}).lpIRR}));
          const minIRR=Math.min(...irrData.map(d=>d.irr));
          const maxIRR=Math.max(...irrData.map(d=>d.irr));
          const pad=(maxIRR-minIRR)*0.25||0.02;
          return(
            <div>
              <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                {irrData.map(d=>{
                  const isCur=d.rate===`${(a.interestRate*100).toFixed(1)}%`;
                  return(
                    <div key={d.rate} style={{
                      padding:"4px 10px",borderRadius:3,fontSize:10,flex:1,
                      background:isCur?"rgba(255,94,170,.18)":"rgba(255,255,255,.04)",
                      border:`1px solid ${isCur?C.gold:"transparent"}`,textAlign:"center"}}>
                      <div style={{color:C.whDim,fontSize:8,marginBottom:1}}>{d.rate}</div>
                      <div style={{color:isCur?C.gold:C.white,fontWeight:isCur?700:400}}>
                        {(d.irr*100).toFixed(1)}%
                      </div>
                    </div>
                  );
                })}
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={irrData} margin={{top:22,right:16,bottom:0,left:0}}>
                  <XAxis dataKey="rate" tick={{fill:C.whDim,fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tickFormatter={v=>`${(v*100).toFixed(0)}%`} tick={{fill:C.whDim,fontSize:9}}
                    axisLine={false} tickLine={false} width={36}
                    domain={[minIRR-pad, maxIRR+pad]}/>
                  <Tooltip content={<TT/>} formatter={v=>[`${(v*100).toFixed(1)}%`,"LP IRR"]}/>
                  <ReferenceLine y={a.prefReturn} stroke="rgba(255,255,255,.2)" strokeDasharray="3 3"
                    label={{value:`${(a.prefReturn*100).toFixed(0)}% pref`,fill:C.whDim,fontSize:8,position:"insideTopRight"}}/>
                  <ReferenceLine x={`${(a.interestRate*100).toFixed(1)}%`} stroke={C.gold} strokeDasharray="4 4"
                    label={{value:"current",fill:C.gold,fontSize:8,position:"insideTopRight"}}/>
                  <Line type="monotone" dataKey="irr" stroke={C.gold} strokeWidth={2.5}
                    dot={{fill:C.gold,r:5,strokeWidth:0}} activeDot={{r:7,fill:C.gold}}
                    label={{formatter:v=>`${(v*100).toFixed(1)}%`,fill:C.white,fontSize:9,fontWeight:600,position:"top",offset:6}}
                    name="LP IRR"/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          );
        })()}
      </Card>
    </div>
  );
}

// ── DEALS TAB ─────────────────────────────────────────────────────────────
// ── REVENUE LINE PRESETS ──────────────────────────────────────────────────
const REV_LINE_PRESETS = {
  "Full-Service Marina": [
    {category:"Wet Slips",line_type:"Under 30'",unit_count:40,rate:900,rate_period:"monthly",occupancy:0.92,growth_rate:0.03},
    {category:"Wet Slips",line_type:"30'–40'",unit_count:60,rate:1400,rate_period:"monthly",occupancy:0.90,growth_rate:0.03},
    {category:"Wet Slips",line_type:"40'–50'",unit_count:30,rate:2000,rate_period:"monthly",occupancy:0.88,growth_rate:0.03},
    {category:"Wet Slips",line_type:"50'+",unit_count:10,rate:3200,rate_period:"monthly",occupancy:0.85,growth_rate:0.04},
    {category:"Dry Storage",line_type:"Rack Storage",unit_count:120,rate:550,rate_period:"monthly",occupancy:0.85,growth_rate:0.03},
    {category:"Dry Storage",line_type:"Covered Storage",unit_count:40,rate:400,rate_period:"monthly",occupancy:0.80,growth_rate:0.03},
    {category:"Dry Storage",line_type:"Yard Storage",unit_count:30,rate:250,rate_period:"monthly",occupancy:0.75,growth_rate:0.02},
    {category:"Lifts & Launch",line_type:"Forklift Launch",unit_count:1,rate:72000,rate_period:"annual",occupancy:1.0,growth_rate:0.03},
    {category:"Lifts & Launch",line_type:"Travel Lift",unit_count:1,rate:96000,rate_period:"annual",occupancy:1.0,growth_rate:0.03},
    {category:"Fuel",line_type:"Gas Dock",unit_count:1,rate:240000,rate_period:"annual",occupancy:1.0,growth_rate:0.04},
    {category:"Service & Repair",line_type:"Boat Yard / Service",unit_count:1,rate:180000,rate_period:"annual",occupancy:1.0,growth_rate:0.03},
    {category:"Retail & F&B",line_type:"Ship Store",unit_count:1,rate:48000,rate_period:"annual",occupancy:1.0,growth_rate:0.02},
    {category:"Retail & F&B",line_type:"Restaurant / Bar",unit_count:1,rate:120000,rate_period:"annual",occupancy:1.0,growth_rate:0.03},
  ],
  "Dry Stack Marina": [
    {category:"Dry Storage",line_type:"Under 25'",unit_count:100,rate:450,rate_period:"monthly",occupancy:0.88,growth_rate:0.03},
    {category:"Dry Storage",line_type:"25'–35'",unit_count:80,rate:650,rate_period:"monthly",occupancy:0.85,growth_rate:0.03},
    {category:"Dry Storage",line_type:"35'+",unit_count:20,rate:900,rate_period:"monthly",occupancy:0.82,growth_rate:0.04},
    {category:"Lifts & Launch",line_type:"Forklift Launch",unit_count:1,rate:96000,rate_period:"annual",occupancy:1.0,growth_rate:0.03},
    {category:"Fuel",line_type:"Gas Dock",unit_count:1,rate:180000,rate_period:"annual",occupancy:1.0,growth_rate:0.04},
    {category:"Retail & F&B",line_type:"Ship Store",unit_count:1,rate:36000,rate_period:"annual",occupancy:1.0,growth_rate:0.02},
  ],
  "Wet Slip Marina": [
    {category:"Wet Slips",line_type:"Under 30'",unit_count:60,rate:800,rate_period:"monthly",occupancy:0.93,growth_rate:0.03},
    {category:"Wet Slips",line_type:"30'–40'",unit_count:80,rate:1300,rate_period:"monthly",occupancy:0.91,growth_rate:0.03},
    {category:"Wet Slips",line_type:"40'–60'",unit_count:40,rate:2200,rate_period:"monthly",occupancy:0.88,growth_rate:0.04},
    {category:"Wet Slips",line_type:"60'+",unit_count:10,rate:4000,rate_period:"monthly",occupancy:0.85,growth_rate:0.04},
    {category:"Liveaboard",line_type:"Liveaboard Surcharge",unit_count:15,rate:400,rate_period:"monthly",occupancy:1.0,growth_rate:0.03},
    {category:"Fuel",line_type:"Gas & Diesel Dock",unit_count:1,rate:300000,rate_period:"annual",occupancy:1.0,growth_rate:0.04},
    {category:"Service & Repair",line_type:"Pumpout / Utilities",unit_count:1,rate:24000,rate_period:"annual",occupancy:1.0,growth_rate:0.02},
  ],
  "Mixed-Use Marina": [
    {category:"Wet Slips",line_type:"30'–50'",unit_count:50,rate:1600,rate_period:"monthly",occupancy:0.90,growth_rate:0.03},
    {category:"Dry Storage",line_type:"Rack Storage",unit_count:80,rate:550,rate_period:"monthly",occupancy:0.85,growth_rate:0.03},
    {category:"Dry Storage",line_type:"Yard / Trailer",unit_count:25,rate:200,rate_period:"monthly",occupancy:0.70,growth_rate:0.02},
    {category:"Lifts & Launch",line_type:"Travel Lift / Forklift",unit_count:1,rate:144000,rate_period:"annual",occupancy:1.0,growth_rate:0.03},
    {category:"Fuel",line_type:"Gas Dock",unit_count:1,rate:200000,rate_period:"annual",occupancy:1.0,growth_rate:0.04},
    {category:"Service & Repair",line_type:"Boat Yard",unit_count:1,rate:120000,rate_period:"annual",occupancy:1.0,growth_rate:0.03},
    {category:"Retail & F&B",line_type:"Ship Store",unit_count:1,rate:42000,rate_period:"annual",occupancy:1.0,growth_rate:0.02},
    {category:"Retail & F&B",line_type:"Restaurant / Tiki Bar",unit_count:1,rate:96000,rate_period:"annual",occupancy:1.0,growth_rate:0.03},
    {category:"Ancillary",line_type:"Parking / Trailer Storage",unit_count:40,rate:75,rate_period:"monthly",occupancy:0.65,growth_rate:0.02},
  ],
};

// ── PROFORMA BUILDER ────────────────────────────────────────────────────
// Accepts revenue lines, expense lines, per-year overrides, and hold period.
// Override keys:
//   Annual: "rev_0_3": 150000, "exp_2_5": 50000, "totalRevenue_3": 2000000, "noi_3": 500000
//   Monthly: "rev_0_3_m6": 12500 (line 0, year 3, month 6)
//   Monthly total: "totalRevenue_3_m6": 200000
//   Rate: "rev_0_rate_3": 1500 (override rate for line 0 in year 3)
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function buildProforma(revenueLines, expenseLines, holdYears = 7, overrides = {}) {
  const years = [];
  for (let yr = 1; yr <= holdYears; yr++) {
    // Revenue lines with monthly breakdown
    const revLineResults = revenueLines.map((l, li) => {
      const rateOverrideKey = `rev_${li}_rate_${yr}`;
      const valueOverrideKey = `rev_${li}_${yr}`;

      const rate = Number(l.rate) || 0;
      const unitCount = Number(l.unit_count) || 0;
      const occupancy = Number(l.occupancy ?? 1.0);
      const defaultGrowth = Number(l.growth_rate) || 0.03;
      const growthKey = `rev_${li}_growth_${yr}`;
      const yearGrowth = overrides[growthKey] != null ? Number(overrides[growthKey]) : defaultGrowth;
      const baseAnnualRate = l.rate_period === 'monthly' ? rate * 12 : rate;
      let annualRate;
      if (overrides[rateOverrideKey] != null) {
        annualRate = l.rate_period === 'monthly' ? Number(overrides[rateOverrideKey]) * 12 : Number(overrides[rateOverrideKey]);
      } else {
        // Compound growth using per-year rates where overridden
        let compounded = baseAnnualRate;
        for (let y = 2; y <= yr; y++) {
          const gKey = `rev_${li}_growth_${y}`;
          const g = overrides[gKey] != null ? Number(overrides[gKey]) : defaultGrowth;
          compounded *= (1 + g);
        }
        annualRate = compounded;
      }

      const monthlyRate = annualRate / 12;
      const months = [];
      let annualTotal = 0;
      for (let m = 0; m < 12; m++) {
        const mKey = `rev_${li}_${yr}_m${m}`;
        const computed = monthlyRate * unitCount * occupancy;
        const val = overrides[mKey] != null ? overrides[mKey] : computed;
        months.push({ month: m, value: val, isOverridden: overrides[mKey] != null });
        annualTotal += val;
      }

      const finalValue = overrides[valueOverrideKey] != null ? overrides[valueOverrideKey] : annualTotal;

      return { ...l, year: yr, idx: li, annualRate, effective: finalValue, months,
        growthRate: yearGrowth, defaultGrowth,
        isOverridden: overrides[valueOverrideKey] != null,
        isRateOverridden: overrides[rateOverrideKey] != null,
        isGrowthOverridden: overrides[growthKey] != null };
    });

    // Expense lines with monthly breakdown
    const expLineResults = expenseLines.map((l, li) => {
      const rateOverrideKey = `exp_${li}_rate_${yr}`;
      const valueOverrideKey = `exp_${li}_${yr}`;

      const baseAmount = l.rate_period === 'monthly' ? Number(l.amount) * 12 : Number(l.amount);
      const defaultExpGrowth = Number(l.growth_rate) || 0.03;
      const expGrowthKey = `exp_${li}_growth_${yr}`;
      const expYearGrowth = overrides[expGrowthKey] != null ? Number(overrides[expGrowthKey]) : defaultExpGrowth;
      let amount;
      if (overrides[rateOverrideKey] != null) {
        amount = l.rate_period === 'monthly' ? Number(overrides[rateOverrideKey]) * 12 : Number(overrides[rateOverrideKey]);
      } else {
        let compounded = baseAmount;
        for (let y = 2; y <= yr; y++) {
          const gKey = `exp_${li}_growth_${y}`;
          const g = overrides[gKey] != null ? Number(overrides[gKey]) : defaultExpGrowth;
          compounded *= (1 + g);
        }
        amount = compounded;
      }

      const monthlyAmt = amount / 12;
      const months = [];
      let annualTotal = 0;
      for (let m = 0; m < 12; m++) {
        const mKey = `exp_${li}_${yr}_m${m}`;
        const computed = monthlyAmt;
        const val = overrides[mKey] != null ? overrides[mKey] : computed;
        months.push({ month: m, value: val, isOverridden: overrides[mKey] != null });
        annualTotal += val;
      }

      const finalValue = overrides[valueOverrideKey] != null ? overrides[valueOverrideKey] : annualTotal;

      return { ...l, year: yr, idx: li, amount: finalValue, months,
        growthRate: expYearGrowth, defaultGrowth: defaultExpGrowth,
        isOverridden: overrides[valueOverrideKey] != null,
        isRateOverridden: overrides[rateOverrideKey] != null,
        isGrowthOverridden: overrides[expGrowthKey] != null };
    });

    let totalRevenue = revLineResults.reduce((s, l) => s + l.effective, 0);
    let totalExpenses = expLineResults.reduce((s, l) => s + Math.abs(l.amount), 0);
    if (overrides[`totalRevenue_${yr}`] != null) totalRevenue = overrides[`totalRevenue_${yr}`];
    if (overrides[`totalExpenses_${yr}`] != null) totalExpenses = overrides[`totalExpenses_${yr}`];

    // Monthly totals
    const monthlyTotals = [];
    for (let m = 0; m < 12; m++) {
      let mRev = revLineResults.reduce((s, l) => s + l.months[m].value, 0);
      let mExp = expLineResults.reduce((s, l) => s + Math.abs(l.months[m].value), 0);
      if (overrides[`totalRevenue_${yr}_m${m}`] != null) mRev = overrides[`totalRevenue_${yr}_m${m}`];
      if (overrides[`totalExpenses_${yr}_m${m}`] != null) mExp = overrides[`totalExpenses_${yr}_m${m}`];
      monthlyTotals.push({ month: m, revenue: mRev, expenses: mExp, noi: mRev - mExp });
    }

    let noi = totalRevenue - totalExpenses;
    if (overrides[`noi_${yr}`] != null) noi = overrides[`noi_${yr}`];

    years.push({
      year: yr, revLines: revLineResults, expLines: expLineResults,
      totalRevenue, totalExpenses, noi, monthlyTotals,
      isRevOverridden: overrides[`totalRevenue_${yr}`] != null,
      isExpOverridden: overrides[`totalExpenses_${yr}`] != null,
      isNoiOverridden: overrides[`noi_${yr}`] != null,
    });
  }
  return years;
}

// ── EXPENSE LINE PRESETS ──────────────────────────────────────────────────
const EXP_LINE_PRESETS = {
  "Full-Service Marina": [
    {category:"Payroll",line_type:"Dock Staff & Harbor Master",amount:18000,rate_period:"monthly",growth_rate:0.03},
    {category:"Payroll",line_type:"Service Technicians",amount:12000,rate_period:"monthly",growth_rate:0.03},
    {category:"Payroll",line_type:"Admin / Office",amount:6000,rate_period:"monthly",growth_rate:0.03},
    {category:"Payroll",line_type:"Benefits & Payroll Tax",amount:8000,rate_period:"monthly",growth_rate:0.03},
    {category:"Dock & Facility",line_type:"Dock Maintenance",amount:48000,rate_period:"annual",growth_rate:0.04},
    {category:"Dock & Facility",line_type:"Grounds / Landscaping",amount:18000,rate_period:"annual",growth_rate:0.02},
    {category:"Dock & Facility",line_type:"Building Maintenance",amount:24000,rate_period:"annual",growth_rate:0.03},
    {category:"Fuel COGS",line_type:"Fuel Cost of Goods",amount:156000,rate_period:"annual",growth_rate:0.04},
    {category:"Insurance",line_type:"Property & Liability",amount:72000,rate_period:"annual",growth_rate:0.05},
    {category:"Utilities",line_type:"Electric",amount:4500,rate_period:"monthly",growth_rate:0.03},
    {category:"Utilities",line_type:"Water & Sewer",amount:1800,rate_period:"monthly",growth_rate:0.03},
    {category:"Utilities",line_type:"Trash / Waste",amount:800,rate_period:"monthly",growth_rate:0.02},
    {category:"Taxes",line_type:"Property Tax",amount:96000,rate_period:"annual",growth_rate:0.02},
    {category:"Admin",line_type:"Management Fee",amount:0,rate_period:"annual",growth_rate:0.0,pct_of_revenue:0.05},
    {category:"Admin",line_type:"Marketing",amount:18000,rate_period:"annual",growth_rate:0.02},
    {category:"Admin",line_type:"Professional Fees",amount:12000,rate_period:"annual",growth_rate:0.02},
    {category:"Admin",line_type:"Software / Technology",amount:6000,rate_period:"annual",growth_rate:0.03},
    {category:"R&M",line_type:"Repairs & Maintenance",amount:36000,rate_period:"annual",growth_rate:0.03},
    {category:"CapEx",line_type:"Replacement Reserve",amount:48000,rate_period:"annual",growth_rate:0.03},
    {category:"Environmental",line_type:"Environmental Compliance",amount:12000,rate_period:"annual",growth_rate:0.02},
  ],
  "Dry Stack Marina": [
    {category:"Payroll",line_type:"Forklift Operators",amount:14000,rate_period:"monthly",growth_rate:0.03},
    {category:"Payroll",line_type:"Admin / Office",amount:5000,rate_period:"monthly",growth_rate:0.03},
    {category:"Payroll",line_type:"Benefits & Payroll Tax",amount:4500,rate_period:"monthly",growth_rate:0.03},
    {category:"Equipment",line_type:"Forklift Maintenance",amount:24000,rate_period:"annual",growth_rate:0.04},
    {category:"Dock & Facility",line_type:"Rack / Building Maint",amount:30000,rate_period:"annual",growth_rate:0.03},
    {category:"Fuel COGS",line_type:"Fuel Cost of Goods",amount:120000,rate_period:"annual",growth_rate:0.04},
    {category:"Insurance",line_type:"Property & Liability",amount:48000,rate_period:"annual",growth_rate:0.05},
    {category:"Utilities",line_type:"Electric",amount:3000,rate_period:"monthly",growth_rate:0.03},
    {category:"Utilities",line_type:"Water & Sewer",amount:800,rate_period:"monthly",growth_rate:0.03},
    {category:"Taxes",line_type:"Property Tax",amount:60000,rate_period:"annual",growth_rate:0.02},
    {category:"Admin",line_type:"Management Fee",amount:0,rate_period:"annual",growth_rate:0.0,pct_of_revenue:0.05},
    {category:"R&M",line_type:"Repairs & Maintenance",amount:24000,rate_period:"annual",growth_rate:0.03},
    {category:"CapEx",line_type:"Replacement Reserve",amount:30000,rate_period:"annual",growth_rate:0.03},
  ],
};

function TabDeals({a}){
  const [deals,setDeals]=useState([]);
  const [selectedDeal,setSelectedDeal]=useState(null);
  const [analysis,setAnalysis]=useState(null);
  const [uploading,setUploading]=useState(false);
  const [creating,setCreating]=useState(false);
  const [comparing,setComparing]=useState(false);
  const [compareIds,setCompareIds]=useState([]);
  const [compareResult,setCompareResult]=useState(null);
  const [newDeal,setNewDeal]=useState({name:"",property_type:"Full-Service Marina",market:"",price:"",slips:""});
  const [analyzing,setAnalyzing]=useState(false);
  const [revLines,setRevLines]=useState([]);
  const [expLines,setExpLines]=useState([]);
  const [proformaOverrides,setProformaOverrides]=useState({});
  const [revDirty,setRevDirty]=useState(false);
  const [editingCell,setEditingCell]=useState(null); // { key, currentValue }
  const [expandedYears,setExpandedYears]=useState({}); // { 1: true, 3: true } = year 1 and 3 expanded to monthly
  const [dealTab,setDealTab]=useState("financials");
  const [showPresentation,setShowPresentation]=useState(false);
  // Deal-level analysis assumptions (local overrides for this deal)
  const [dealAssumptions,setDealAssumptions]=useState({
    price:null, t12Noi:null, exitCapRate:0.075, noiGrowth:0.03, holdYears:7,
    debtPct:0.60, interestRate:0.065, goingInCap:null, noiMargin:null,
  });

  const loadDeals=useCallback(async()=>{
    try{ const res=await fetch('/api/deals'); const data=await res.json(); setDeals(Array.isArray(data)?data:[]); }
    catch(e){ console.error(e); }
  },[]);

  useEffect(()=>{ loadDeals(); },[loadDeals]);

  const createDeal=async()=>{
    if(!newDeal.name.trim()) return;
    try{
      const res=await fetch('/api/deals',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...newDeal,price:newDeal.price?Number(newDeal.price):null,slips:newDeal.slips?Number(newDeal.slips):null})});
      const d=await res.json();
      setCreating(false);setNewDeal({name:"",property_type:"Full-Service Marina",market:"",price:"",slips:""});
      await loadDeals(); selectDeal(d.id);
    }catch(e){ console.error(e); }
  };

  const selectDeal=async(id)=>{
    // Auto-save unsaved changes before switching deals
    if(revDirty&&selectedDeal) await saveAllLines();
    try{
      const res=await fetch(`/api/deals/${id}`); const d=await res.json();
      setSelectedDeal(d); setAnalysis(null); setSaveMsg("");
      setRevLines(d.revenueLines||[]); setRevDirty(false);
      setExpLines(d.expenseLines||[]);
      setShowVersionPanel(false); setShowVersionInput(false); setVersionNameInput("");
      loadVersions(id);
      setProformaOverrides(d.assumptions?.proforma_overrides||{});
      // Populate deal assumptions from saved analysis or defaults
      const saved=d.assumptions?.deal_analysis||{};
      const latestParsed=d.financials?.length?d.financials.sort((a2,b2)=>(a2.year||0)-(b2.year||0)).slice(-1)[0]?.parsed:{};
      const noi=latestParsed?.noi||0;
      const pr=d.price?Number(d.price):null;
      setDealAssumptions({
        price:saved.price||pr||null,
        t12Noi:saved.t12Noi||(noi>0?noi:null),
        exitCapRate:saved.exitCapRate||0.075,
        noiGrowth:saved.noiGrowth||0.03,
        holdYears:saved.holdYears||a.fundTerm||7,
        debtPct:saved.debtPct||0.60,
        interestRate:saved.interestRate||0.065,
        goingInCap:saved.goingInCap||(pr&&noi>0?noi/pr:null),
        noiMargin:saved.noiMargin||null,
      });
    }catch(e){ console.error(e); }
  };

  const deleteDeal=async(id)=>{
    if(!confirm("Delete this deal and all its financials?")) return;
    try{ await fetch(`/api/deals/${id}`,{method:'DELETE'}); setSelectedDeal(null); setAnalysis(null); setRevLines([]); await loadDeals(); }
    catch(e){ console.error(e); }
  };

  const uploadFiles=async(e)=>{
    if(!selectedDeal) return;
    const files=e.target.files; if(!files.length) return;
    setUploading(true);
    const form=new FormData();
    for(const f2 of files) form.append('files',f2);
    try{
      const res=await fetch(`/api/deals/${selectedDeal.id}/upload`,{method:'POST',body:form});
      const data=await res.json();
      if(data.success){ await selectDeal(selectedDeal.id); }
    }catch(err){ console.error(err); }
    finally{ setUploading(false); e.target.value=''; }
  };

  const runAnalysis=()=>{
    if(!selectedDeal||!proformaReturns) return;
    setAnalyzing(true);
    try{
      const pr=proformaReturns;
      const price=pr.price;
      const capRate=pr.goingInCap;
      const noiGrowth=dealAssumptions.noiGrowth||0.03;
      const exitCap=dealAssumptions.exitCapRate||0.075;
      const holdYrs=dealAssumptions.holdYears||a.fundTerm||7;
      const debtPct2=dealAssumptions.debtPct!=null?dealAssumptions.debtPct:0.60;
      const intRate2=dealAssumptions.interestRate||0.065;

      // Build single-asset model input for run()
      const asset={
        name:selectedDeal.name||"Deal",
        price:price,
        cap:capRate,
        growth:noiGrowth,
        startMonth:1,
        noiMargin:0.525,
        scope:"scenario",
      };
      const modelInput={
        assets:[asset],hires:[],overhead:[],oneTime:[],partnerSalaries:[],
        fundTerm:holdYrs,debtPct:debtPct2,interestRate:intRate2,amortYears:25,
        exitCapRate:exitCap,saleCosts:0.02,
        carry:a.carry||0.20,prefReturn:a.prefReturn||0.07,
        gpPct:a.gpPct||0.02,amFee:a.amFee||0.01,pmFee:a.pmFee||0.06,
        benefitsRate:0.22,salaryGrowth:0.03,partners:a.partners||3,
        compoundPref:a.compoundPref||false,catchUp:a.catchUp||false,
        promoteTiers:a.promoteTiers||DEF_PROMOTE_TIERS,
      };
      const result=run(modelInput);

      // Build sensitivity grid client-side
      const exitCaps=[0.055,0.060,0.065,0.070,0.075,0.080,0.085,0.090];
      const growthRates=[0.02,0.03,0.04,0.05,0.06,0.07,0.08];
      const grid=[];
      for(const ec of exitCaps){
        const row={exitCap:ec,values:{}};
        for(const gr of growthRates){
          const testAsset={...asset,growth:gr};
          const testResult=run({...modelInput,exitCapRate:ec,assets:[testAsset]});
          row.values[gr]={lpIRR:testResult.lpIRR,lpMOIC:testResult.lpMOIC,gpPromote:testResult.gpPromote};
        }
        grid.push(row);
      }

      setAnalysis({
        asset:asset,
        modelResult:{
          lpIRR:result.lpIRR,lpMOIC:result.lpMOIC,
          gpPromote:result.gpPromote,totExitVal:result.totExitVal,
          totSaleProc:result.totSaleProc,totOpCF:result.totOpCF,
          lpROC:result.lpROC,lpPref:result.lpPref,
          lpResid:result.lpResid,lpTotal:result.lpTotal,
          tierResults:result.tierResults,
        },
        historicalAnalysis:{yearsOfData:0,noiHistory:[]},
        sensitivity:{exitCaps,growthRates,grid},
      });

      // Save deal assumptions in background
      fetch(`/api/deals/${selectedDeal.id}`,{method:'PUT',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({
          ...selectedDeal,assumptions:{...(selectedDeal.assumptions||{}),deal_analysis:dealAssumptions}
        })}).catch(()=>{});
    }catch(err){
      console.error("Analysis error:",err);
    }
    finally{ setAnalyzing(false); }
  };

  const runCompare=async()=>{
    if(compareIds.length<2) return;
    setComparing(true);
    try{
      const res=await fetch('/api/deals/compare',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({dealIds:compareIds,assumptions:{fundTerm:a.fundTerm,debtPct:a.debtPct,
          interestRate:a.interestRate,exitCapRate:a.exitCapRate,prefReturn:a.prefReturn,carry:a.carry,gpPct:a.gpPct,
          promoteTiers:a.promoteTiers}})});
      const data=await res.json();
      setCompareResult(data);
    }catch(err){ console.error(err); }
    finally{ setComparing(false); }
  };

  const toggleCompare=(id)=>{
    setCompareIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  };

  const deleteFinancial=async(dealId,finId)=>{
    try{ await fetch(`/api/deals/${dealId}/financials/${finId}`,{method:'DELETE'}); await selectDeal(dealId); }
    catch(e){ console.error(e); }
  };

  // Revenue line management
  const addRevLine=()=>{
    setRevLines([...revLines,{category:"",line_type:"",unit_count:0,rate:0,rate_period:"monthly",
      occupancy:1.0,growth_rate:0.03,start_year:1,notes:""}]);
    setRevDirty(true);
  };

  const updateRevLine=(idx,field,val)=>{
    const updated=[...revLines];
    updated[idx]={...updated[idx],[field]:val};
    setRevLines(updated);
    setRevDirty(true);
  };

  const removeRevLine=(idx)=>{
    setRevLines(revLines.filter((_,i)=>i!==idx));
    setRevDirty(true);
  };

  const loadPreset=(presetName)=>{
    const preset=REV_LINE_PRESETS[presetName];
    if(preset){ setRevLines([...preset]); setRevDirty(true); }
  };

  const loadExpPreset=(presetName)=>{
    const preset=EXP_LINE_PRESETS[presetName];
    if(preset){ setExpLines([...preset]); setRevDirty(true); }
  };

  // Expense line management
  const addExpLine=()=>{
    setExpLines([...expLines,{category:"",line_type:"",amount:0,rate_period:"annual",growth_rate:0.03,notes:""}]);
    setRevDirty(true);
  };
  const updateExpLine=(idx,field,val)=>{
    const updated=[...expLines]; updated[idx]={...updated[idx],[field]:val}; setExpLines(updated); setRevDirty(true);
  };
  const removeExpLine=(idx)=>{
    setExpLines(expLines.filter((_,i)=>i!==idx)); setRevDirty(true);
  };

  // Override management
  const setOverride=(key,val)=>{
    const next={...proformaOverrides};
    if(val==null||val==="") delete next[key]; else next[key]=Number(val);
    setProformaOverrides(next); setRevDirty(true);
  };
  const clearOverride=(key)=>{
    const next={...proformaOverrides}; delete next[key]; setProformaOverrides(next); setRevDirty(true);
  };

  const [saving,setSaving2]=useState(false);
  const [saveMsg,setSaveMsg]=useState("");
  const [versions,setVersions]=useState([]);
  const [showVersionPanel,setShowVersionPanel]=useState(false);
  const [savingVersion,setSavingVersion]=useState(false);
  const [versionNameInput,setVersionNameInput]=useState("");
  const [showVersionInput,setShowVersionInput]=useState(false);

  const loadVersions=useCallback(async(id)=>{
    try{ const r=await fetch(`/api/deals/${id}/versions`); setVersions(await r.json()); }
    catch(e){ console.error(e); }
  },[]);

  const saveVersion=async()=>{
    if(!selectedDeal) return;
    setSavingVersion(true);
    try{
      await saveAllLines();
      const name=versionNameInput.trim()||`Version – ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
      const r=await fetch(`/api/deals/${selectedDeal.id}/versions`,{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({version_name:name})});
      if(r.ok){ setVersionNameInput(""); setShowVersionInput(false); await loadVersions(selectedDeal.id); }
    }catch(e){ console.error(e); }
    finally{ setSavingVersion(false); }
  };

  const restoreVersion=async(vid)=>{
    if(!selectedDeal||!confirm("Restore this version? Current deal data will be overwritten.")) return;
    try{
      const r=await fetch(`/api/deals/${selectedDeal.id}/versions/${vid}/restore`,{method:'POST'});
      if(r.ok){ await selectDeal(selectedDeal.id); await loadVersions(selectedDeal.id); }
    }catch(e){ console.error(e); }
  };

  const deleteVersion=async(vid)=>{
    if(!selectedDeal||!confirm("Delete this saved version?")) return;
    try{
      const r=await fetch(`/api/deals/${selectedDeal.id}/versions/${vid}`,{method:'DELETE'});
      if(r.ok){ await loadVersions(selectedDeal.id); }
    }catch(e){ console.error(e); }
  };
  const saveAllLines=async()=>{
    if(!selectedDeal) return;
    setSaving2(true); setSaveMsg("");
    try{
      const [r1,r2,r3]=await Promise.all([
        fetch(`/api/deals/${selectedDeal.id}/revenue-lines`,{method:'PUT',
          headers:{'Content-Type':'application/json'},body:JSON.stringify({lines:revLines})}),
        fetch(`/api/deals/${selectedDeal.id}/expense-lines`,{method:'PUT',
          headers:{'Content-Type':'application/json'},body:JSON.stringify({lines:expLines})}),
        fetch(`/api/deals/${selectedDeal.id}`,{method:'PUT',
          headers:{'Content-Type':'application/json'},body:JSON.stringify({
            name:selectedDeal.name,property_type:selectedDeal.property_type,market:selectedDeal.market,
            address:selectedDeal.address,units:selectedDeal.units,slips:selectedDeal.slips,
            price:dealAssumptions.price||selectedDeal.price,start_month:selectedDeal.start_month,
            status:selectedDeal.status,notes:selectedDeal.notes,
            assumptions:{...(selectedDeal.assumptions||{}),proforma_overrides:proformaOverrides,deal_analysis:dealAssumptions}
          })}),
      ]);
      if(!r1.ok||!r2.ok||!r3.ok){
        const errs=[];
        if(!r1.ok) errs.push("revenue lines");
        if(!r2.ok) errs.push("expense lines");
        if(!r3.ok) errs.push("deal settings");
        setSaveMsg("Failed to save: "+errs.join(", "));
      } else {
        setRevDirty(false);
        setSaveMsg("Saved!");
        // Update selectedDeal with saved assumptions
        setSelectedDeal(prev=>({...prev,
          assumptions:{...(prev.assumptions||{}),proforma_overrides:proformaOverrides,deal_analysis:dealAssumptions}
        }));
        setTimeout(()=>setSaveMsg(""),3000);
      }
    }catch(e){ console.error(e); setSaveMsg("Save error: "+e.message); }
    finally{ setSaving2(false); }
  };

  // Proforma computation
  const proformaHoldYears=dealAssumptions.holdYears||a.fundTerm||7;
  const proforma=useMemo(()=>{
    if(revLines.length===0&&expLines.length===0) return [];
    return buildProforma(revLines, expLines, proformaHoldYears, proformaOverrides);
  },[revLines,expLines,proformaHoldYears,proformaOverrides]);

  // Proforma-based deal returns (computed live from proforma data or T-12 NOI)
  const proformaReturns=useMemo(()=>{
    const price=dealAssumptions.price||Number(selectedDeal?.price)||0;
    if(!price) return null;
    const exitCap=dealAssumptions.exitCapRate||0.075;
    const debtPct=dealAssumptions.debtPct||0.60;
    const intRate=dealAssumptions.interestRate||0.065;
    const holdYrs=proforma.length||(dealAssumptions.holdYears||7);
    const noiGrowthRate=dealAssumptions.noiGrowth||0.03;

    // NOI from T-12 (highest priority), proforma, or implied
    let yr1Noi, exitNoi;
    const hasProforma=proforma.length>0;
    if(dealAssumptions.t12Noi){
      // T-12 NOI takes priority — it's the actual trailing NOI
      yr1Noi=dealAssumptions.t12Noi;
      exitNoi=yr1Noi*Math.pow(1+noiGrowthRate,holdYrs-1);
    } else if(hasProforma){
      yr1Noi=proforma[0]?.noi||0;
      exitNoi=proforma[proforma.length-1]?.noi||0;
    } else {
      // Imply from price and going-in cap or exit cap
      const impliedCap=dealAssumptions.goingInCap||exitCap;
      yr1Noi=price*impliedCap;
      exitNoi=yr1Noi*Math.pow(1+noiGrowthRate,holdYrs-1);
    }
    if(!yr1Noi) return null;
    const exitValue=exitNoi/exitCap;
    const saleCosts=exitValue*0.02;

    // Debt
    const loanAmt=price*debtPct;
    const equity=price-loanAmt;
    const monthlyIntRate=intRate/12;
    const amortMonths=25*12;
    const monthlyPmt=loanAmt>0?pmt(monthlyIntRate,amortMonths,loanAmt):0;
    const annualDS=monthlyPmt*12;

    // Remaining loan balance at exit
    let loanBal=loanAmt;
    for(let y=0;y<holdYrs;y++){
      for(let m=0;m<12;m++){
        const interest=loanBal*monthlyIntRate;
        const principal=monthlyPmt-interest;
        loanBal=Math.max(0,loanBal-principal);
      }
    }
    const saleProceeds=exitValue-saleCosts-loanBal;

    // Build NOI schedule
    const noiSchedule=[];
    for(let y=0;y<holdYrs;y++){
      if(hasProforma&&proforma[y]) noiSchedule.push(proforma[y].noi||0);
      else noiSchedule.push(yr1Noi*Math.pow(1+noiGrowthRate,y));
    }

    // Unlevered IRR (property-level)
    const unlevCF=[(-price)];
    for(let y=0;y<holdYrs;y++){
      if(y<holdYrs-1) unlevCF.push(noiSchedule[y]);
      else unlevCF.push(noiSchedule[y]+exitValue-saleCosts);
    }
    const unlvIRR=irr(unlevCF);

    // Levered IRR (equity-level)
    const levCF=[(-equity)];
    for(let y=0;y<holdYrs;y++){
      const levCashFlow=noiSchedule[y]-annualDS;
      if(y<holdYrs-1) levCF.push(levCashFlow);
      else levCF.push(levCashFlow+saleProceeds);
    }
    const levIRR=irr(levCF);

    // MOIC
    const totalCashToEquity=levCF.slice(1).reduce((s,v)=>s+v,0);
    const moic=equity>0?(totalCashToEquity+equity)/equity:0;

    // NOI growth CAGR
    const noiCAGR=(yr1Noi>0&&exitNoi>0&&holdYrs>1)?Math.pow(exitNoi/yr1Noi,1/(holdYrs-1))-1:noiGrowthRate;
    const goingInCap=price>0?yr1Noi/price:0;

    return {
      price,equity,loanAmt,exitCap,exitValue,exitNoi,saleProceeds,loanBal,
      annualDS,yr1Noi,unlvIRR,levIRR,moic,noiCAGR,goingInCap,holdYrs,
      debtPct,intRate,
    };
  },[proforma,dealAssumptions,selectedDeal?.price]);

  const totalRevLineRevenue=revLines.reduce((s,l)=>{
    const annual=l.rate_period==="monthly"?Number(l.rate)*12:Number(l.rate);
    return s+Number(l.unit_count)*annual*(Number(l.occupancy)??1);
  },0);
  const totalExpLineAmount=expLines.reduce((s,l)=>{
    const annual=l.rate_period==="monthly"?Number(l.amount)*12:Number(l.amount);
    return s+annual;
  },0);

  // Editable cell helper — double-click to override, right-click to clear
  const EditableCell=({cellKey,computedValue,style={}})=>{
    const isOverridden=proformaOverrides[cellKey]!=null;
    const displayVal=isOverridden?proformaOverrides[cellKey]:computedValue;
    if(editingCell?.key===cellKey){
      return <td style={{...tdS,...style,padding:"2px 4px"}}><input type="number" autoFocus
        defaultValue={Math.round(displayVal||0)}
        onBlur={e=>{const v=e.target.value;if(v!==""&&Number(v)!==Math.round(computedValue||0)){setOverride(cellKey,v);}setEditingCell(null);}}
        onKeyDown={e=>{if(e.key==="Enter")e.target.blur();if(e.key==="Escape"){setEditingCell(null);}}}
        style={{...inputS,width:"100%",textAlign:"right",fontSize:11,padding:"3px 6px"}}/></td>;
    }
    return <td style={{...tdS,...style,cursor:"pointer",
      background:isOverridden?"rgba(41,128,185,.12)":"transparent",
      fontStyle:isOverridden?"normal":"normal"}}
      onDoubleClick={()=>setEditingCell({key:cellKey,currentValue:displayVal})}
      onContextMenu={e=>{if(isOverridden){e.preventDefault();clearOverride(cellKey);}}}
      title={isOverridden?"Double-click to edit, right-click to reset":"Double-click to hard-code"}>
      {f.$(displayVal)}{isOverridden&&<span style={{fontSize:7,color:C.blue,marginLeft:3}}>HC</span>}
    </td>;
  };

  const thS={padding:"8px 12px",fontSize:9,color:C.goldDim,textTransform:"uppercase",letterSpacing:".07em",
    textAlign:"left",borderBottom:`1px solid ${C.border}`};
  const tdS={padding:"9px 12px",fontSize:11,color:C.white,borderBottom:"1px solid rgba(255,255,255,.04)"};
  const btnS={padding:"6px 16px",fontSize:10,fontWeight:700,border:"none",borderRadius:4,cursor:"pointer",
    letterSpacing:".04em"};
  const goldBtn={...btnS,background:C.gold,color:C.dark};
  const dimBtn={...btnS,background:"rgba(255,255,255,.08)",color:C.whDim,border:`1px solid rgba(255,255,255,.12)`};
  const inputS={background:"rgba(255,255,255,.06)",border:`1px solid ${C.border}`,borderRadius:3,
    padding:"5px 8px",color:C.white,fontSize:11,outline:"none",fontFamily:"'DM Sans',sans-serif",
    boxSizing:"border-box",width:"100%"};
  const dealTabs=["financials","revenue","expenses","proforma","analysis","presentation"];

  // ── IC MEMO / PRESENTATION VIEW ──────────────────────────────────
  if(showPresentation&&selectedDeal){
    const today=new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});
    const fins=(selectedDeal.financials||[]).filter(f2=>f2.parsed?.noi).sort((a2,b2)=>(a2.year||0)-(b2.year||0));
    const pr=proformaReturns;
    const yr1Rev=totalRevLineRevenue;
    const yr1Exp=totalExpLineAmount;
    const yr1Noi=yr1Rev-yr1Exp;
    const totalSlips=Number(selectedDeal.slips||selectedDeal.units)||0;
    const acqPrice=dealAssumptions.price||Number(selectedDeal.price)||0;

    // Revenue by category
    const revByCat={};
    revLines.forEach(l=>{
      const annual=Number(l.rate_period==="monthly"?Number(l.rate)*12:Number(l.rate))*Number(l.unit_count)*(Number(l.occupancy)??1);
      revByCat[l.category]=(revByCat[l.category]||0)+annual;
    });

    // Expense by category
    const expByCat={};
    expLines.forEach(l=>{
      const annual=l.rate_period==="monthly"?Number(l.amount)*12:Number(l.amount);
      expByCat[l.category]=(expByCat[l.category]||0)+annual;
    });

    const SectionHdr=({t,pageBreak})=>(
      <div className={`ic-section-hdr${pageBreak?" ic-page-break":""}`} style={{fontSize:14,fontWeight:700,color:C.gold,marginBottom:12,marginTop:pageBreak?0:28,paddingTop:pageBreak?8:0,paddingBottom:6,
        borderBottom:`1px solid ${C.gold}`,textTransform:"uppercase",letterSpacing:".12em"}}>{t}</div>
    );
    const IcKPI=({label,value,sub,gold})=>(
      <div className={`ic-kpi${gold?" ic-kpi-gold":""}`} style={{background:C.whFaint,border:`1px solid ${C.border}`,borderRadius:4,padding:"10px 14px",minWidth:100,flex:1}}>
        <div className="ic-kpi-label" style={{fontSize:8,color:C.goldDim,textTransform:"uppercase",letterSpacing:".08em",marginBottom:3}}>{label}</div>
        <div className="ic-kpi-value" style={{fontSize:15,fontWeight:700,color:gold?C.gold:C.white}}>{value}</div>
        {sub&&<div className="ic-kpi-sub" style={{fontSize:8,color:C.whDim,marginTop:2}}>{sub}</div>}
      </div>
    );
    const IcCard=({children,style})=>(
      <div className="ic-card" style={{background:"rgba(255,255,255,.03)",border:`1px solid ${C.border}`,
        borderRadius:6,padding:"16px 18px",...style}}>{children}</div>
    );

    return(
      <div id="ic-memo-overlay" style={{position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:9999,
        background:C.dark,overflowY:"auto",fontFamily:"'DM Sans',sans-serif"}}>
        {/* Print styles — hides everything except the memo */}
        <style>{`
          @media print {
            body > * { visibility: hidden !important; }
            #ic-memo-overlay, #ic-memo-overlay * { visibility: visible !important; }
            #ic-memo-overlay {
              position: absolute !important; top: 0 !important; left: 0 !important;
              width: 100% !important; overflow: visible !important;
              background: white !important; color: #1a1a2e !important;
            }
            .ic-no-print { display: none !important; }
            .ic-page-break { page-break-before: always; }
            @page { size: letter; margin: 0.6in 0.7in; }
            * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

            /* Light theme overrides for print */
            #ic-memo-overlay .ic-card {
              background: #f8f7f4 !important; border: 1px solid #d4c99e !important;
              box-shadow: none !important; color: #1a1a2e !important;
            }
            #ic-memo-overlay .ic-kpi { background: #f0efe8 !important; border: 1px solid #d4c99e !important; }
            #ic-memo-overlay .ic-kpi-label { color: #8b7536 !important; }
            #ic-memo-overlay .ic-kpi-value { color: #1a1a2e !important; }
            #ic-memo-overlay .ic-kpi-gold .ic-kpi-value { color: #8b7536 !important; }
            #ic-memo-overlay .ic-kpi-sub { color: #666 !important; }
            #ic-memo-overlay .ic-section-hdr {
              color: #8b7536 !important; border-bottom-color: #8b7536 !important;
            }
            #ic-memo-overlay .ic-cover-title { color: #1a1a2e !important; }
            #ic-memo-overlay .ic-cover-sub { color: #8b7536 !important; }
            #ic-memo-overlay .ic-cover-date { color: #666 !important; }
            #ic-memo-overlay .ic-cover-line { border-color: #8b7536 !important; }
            #ic-memo-overlay .ic-body-text { color: #333 !important; }
            #ic-memo-overlay .ic-dim-text { color: #666 !important; }
            #ic-memo-overlay .ic-green { color: #1e7d34 !important; }
            #ic-memo-overlay .ic-red { color: #c0392b !important; }
            #ic-memo-overlay .ic-gold-text { color: #8b7536 !important; }
            #ic-memo-overlay th { color: #8b7536 !important; border-bottom: 1px solid #d4c99e !important; }
            #ic-memo-overlay td { color: #333 !important; border-bottom: 1px solid #e8e4d8 !important; }
            #ic-memo-overlay .ic-confidential { color: #8b7536 !important; }
            #ic-memo-overlay .ic-risk-title { color: #8b7536 !important; }
            #ic-memo-overlay .ic-risk-desc { color: #555 !important; }
            #ic-memo-overlay .ic-disclaimer { color: #999 !important; border-top-color: #ddd !important; }
            #ic-memo-overlay .ic-sens-green { background: rgba(30,125,52,.12) !important; color: #1e7d34 !important; }
            #ic-memo-overlay .ic-sens-yellow { background: rgba(139,117,54,.1) !important; color: #8b7536 !important; }
            #ic-memo-overlay .ic-sens-red { background: rgba(192,57,43,.08) !important; color: #c0392b !important; }
          }
        `}</style>

        {/* Top bar — hidden in print */}
        <div className="ic-no-print" style={{position:"sticky",top:0,zIndex:10,
          background:"rgba(9,6,15,.97)",backdropFilter:"blur(12px)",
          borderBottom:`1px solid ${C.gold}`,padding:"0 24px",
          display:"flex",alignItems:"center",justifyContent:"space-between",height:48}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:13,fontWeight:800,color:C.white}}>IC Memo — {selectedDeal.name}</span>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>window.print()} style={{background:C.gold,color:C.navy,border:"none",
              borderRadius:3,padding:"5px 16px",fontSize:10,fontWeight:800,letterSpacing:".07em",
              textTransform:"uppercase",cursor:"pointer"}}>Print / PDF</button>
            <button onClick={()=>setShowPresentation(false)} style={{background:"transparent",color:C.goldDim,
              border:`1px solid rgba(255,94,170,.3)`,borderRadius:3,padding:"5px 16px",
              fontSize:10,fontWeight:700,letterSpacing:".07em",textTransform:"uppercase",cursor:"pointer"}}>Close</button>
          </div>
        </div>

        <div style={{maxWidth:900,margin:"0 auto",padding:"40px 24px"}}>

          {/* ═══ COVER ═══ */}
          <div style={{textAlign:"center",marginBottom:50,paddingBottom:24,borderBottom:`2px solid ${C.gold}`}} className="ic-cover-line">
            <div className="ic-confidential" style={{fontSize:10,color:C.gold,letterSpacing:".25em",textTransform:"uppercase",marginBottom:8}}>
              Investment Committee Memorandum — Confidential</div>
            <div className="ic-cover-title" style={{fontSize:36,fontWeight:700,color:C.white,fontFamily:"'Playfair Display',serif",marginBottom:6}}>
              {selectedDeal.name}</div>
            <div className="ic-cover-sub" style={{fontSize:14,color:C.goldDim,marginTop:6}}>
              {[selectedDeal.property_type,selectedDeal.market,selectedDeal.address].filter(Boolean).join(" | ")}</div>
            <div className="ic-cover-date" style={{fontSize:11,color:C.whDim,marginTop:8}}>{today}</div>
          </div>

          {/* ═══ EXECUTIVE SUMMARY ═══ */}
          <SectionHdr t="Executive Summary"/>
          <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
            {acqPrice>0&&<IcKPI label="Acquisition Price" value={f.$(acqPrice)} gold/>}
            {totalSlips>0&&<IcKPI label="Total Slips" value={totalSlips}/>}
            {(pr?.yr1Noi||yr1Noi)>0&&<IcKPI label="Year 1 NOI" value={f.$(pr?.yr1Noi||yr1Noi)} gold/>}
            {pr&&<IcKPI label="Going-In Cap" value={f.p(pr.goingInCap)}/>}
            {pr&&<IcKPI label="Levered IRR" value={f.p(pr.levIRR)} gold/>}
            {pr&&<IcKPI label="Equity MOIC" value={f.x(pr.moic)}/>}
            {pr&&<IcKPI label="Exit Value" value={f.$(pr.exitValue)}/>}
          </div>
          <IcCard style={{marginBottom:16}}>
            <div className="ic-body-text" style={{fontSize:12,color:C.whDim,lineHeight:1.7}}>
              {selectedDeal.name} is a {selectedDeal.property_type||"marina"} located in {selectedDeal.market||"[Market]"}
              {totalSlips>0?` comprising ${totalSlips} slips`:""}.
              {acqPrice>0?` The proposed acquisition price is ${f.$(acqPrice)}`:""}
              {(pr?.yr1Noi||yr1Noi)>0?`, implying a going-in cap rate of ${f.p((pr?.yr1Noi||yr1Noi)/acqPrice)}`:""}
              {yr1Rev>0?`. Year 1 projected revenue is ${f.$(yr1Rev)} with operating expenses of ${f.$(yr1Exp)}, yielding NOI of ${f.$(yr1Noi)}`:""}
              {yr1Rev>0?` (${f.p(yr1Noi/yr1Rev)} margin).`:"."}
              {pr?` Over a ${pr.holdYrs}-year hold, the deal targets a levered IRR of ${f.p(pr.levIRR)} and ${f.x(pr.moic)} equity multiple.`:""}
            </div>
          </IcCard>

          {/* ═══ SOURCES & USES ═══ */}
          {acqPrice>0&&pr&&(
            <>
              <SectionHdr t="Sources & Uses" pageBreak/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
                <IcCard>
                  <CT c="Sources"/>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <tbody>
                      {[
                        ["Senior Debt",f.$(pr.loanAmt),f.p(pr.debtPct)],
                        ["Equity",f.$(pr.equity),f.p(1-pr.debtPct)],
                      ].map(([k,v,pct],i)=>(
                        <tr key={i}><td className="ic-dim-text" style={{padding:"8px 0"}}>{k}</td>
                          <td style={{padding:"8px 0",fontWeight:600,textAlign:"right"}}>{v}</td>
                          <td className="ic-gold-text" style={{padding:"8px 0",color:C.goldDim,textAlign:"right",width:50}}>{pct}</td></tr>
                      ))}
                      <tr style={{borderTop:`2px solid ${C.gold}`}}>
                        <td className="ic-gold-text" style={{padding:"8px 0",color:C.gold,fontWeight:700}}>Total Sources</td>
                        <td className="ic-gold-text" style={{padding:"8px 0",color:C.gold,fontWeight:700,textAlign:"right"}}>{f.$(acqPrice)}</td>
                        <td className="ic-gold-text" style={{padding:"8px 0",color:C.gold,textAlign:"right"}}>100%</td></tr>
                    </tbody>
                  </table>
                </IcCard>
                <IcCard>
                  <CT c="Uses"/>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <tbody>
                      {[
                        ["Acquisition",f.$(acqPrice),"100.0%"],
                        ["Closing Costs (est.)",f.$(acqPrice*0.02),"2.0%"],
                      ].map(([k,v,pct],i)=>(
                        <tr key={i}><td className="ic-dim-text" style={{padding:"8px 0"}}>{k}</td>
                          <td style={{padding:"8px 0",fontWeight:600,textAlign:"right"}}>{v}</td>
                          <td className="ic-gold-text" style={{padding:"8px 0",color:C.goldDim,textAlign:"right",width:50}}>{pct}</td></tr>
                      ))}
                      <tr style={{borderTop:`2px solid ${C.gold}`}}>
                        <td className="ic-gold-text" style={{padding:"8px 0",color:C.gold,fontWeight:700}}>Total Uses</td>
                        <td className="ic-gold-text" style={{padding:"8px 0",color:C.gold,fontWeight:700,textAlign:"right"}}>{f.$(acqPrice*1.02)}</td>
                        <td></td></tr>
                    </tbody>
                  </table>
                </IcCard>
              </div>
              <IcCard style={{marginBottom:16}}>
                <CT c="Financing Terms"/>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,fontSize:12}}>
                  {[
                    ["Loan Amount",f.$(pr.loanAmt)],["LTV",f.p(pr.debtPct)],
                    ["Interest Rate",f.p(pr.intRate)],["Amort","25 years"],
                    ["Annual Debt Service",f.$(pr.annualDS)],["DSCR (Yr 1)",(pr.yr1Noi||yr1Noi)>0?((pr.yr1Noi||yr1Noi)/pr.annualDS).toFixed(2)+"x":"—"],
                    ["Loan Balance at Exit",f.$(pr.loanBal)],["Debt Yield (Yr 1)",pr.loanAmt>0?f.p((pr.yr1Noi||yr1Noi)/pr.loanAmt):"—"],
                  ].map(([k,v],i)=>(
                    <div key={i}>
                      <div className="ic-kpi-label" style={{fontSize:9,color:C.goldDim,textTransform:"uppercase",letterSpacing:".06em"}}>{k}</div>
                      <div style={{fontSize:13,fontWeight:600,marginTop:2}}>{v}</div>
                    </div>
                  ))}
                </div>
              </IcCard>
            </>
          )}

          {/* ═══ HISTORICAL PERFORMANCE ═══ */}
          {fins.length>0&&(
            <>
              <SectionHdr t="Historical Performance" pageBreak/>
              <IcCard style={{marginBottom:16}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr>
                    <th style={thS}>Year</th><th style={thS}>Revenue</th><th style={thS}>Expenses</th>
                    <th style={thS}>NOI</th><th style={thS}>Margin</th><th style={thS}>Occupancy</th>
                  </tr></thead>
                  <tbody>
                    {fins.map(fin=>{
                      const p=fin.parsed||{};
                      return <tr key={fin.id}><td style={tdS}>{fin.year}</td>
                        <td style={tdS}>{f.$(p.revenue||p.egi)}</td>
                        <td style={{...tdS,color:"#E57373"}}>{f.$(p.expenses)}</td>
                        <td style={{...tdS,color:C.green,fontWeight:600}}>{f.$(p.noi)}</td>
                        <td style={tdS}>{p.noi_margin?f.p(p.noi_margin):"—"}</td>
                        <td style={tdS}>{p.occupancy?f.p(p.occupancy):"—"}</td>
                      </tr>;
                    })}
                  </tbody>
                </table>
                {fins.length>=2&&(
                  <div style={{marginTop:12}}>
                    <ResponsiveContainer width="100%" height={180}>
                      <ComposedChart data={fins.map(fin=>({year:fin.year,noi:fin.parsed?.noi||0,revenue:fin.parsed?.revenue||0}))} margin={{top:10,right:16,bottom:0,left:0}}>
                        <XAxis dataKey="year" tick={{fill:C.whDim,fontSize:10}} axisLine={false} tickLine={false}/>
                        <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={50}/>
                        <Tooltip content={<TT/>}/>
                        <Bar dataKey="revenue" fill="#5C9BD1" radius={[3,3,0,0]} name="Revenue"/>
                        <Line type="monotone" dataKey="noi" stroke={C.gold} strokeWidth={2.5} dot={{fill:C.gold,r:4}} name="NOI"/>
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </IcCard>
            </>
          )}

          {/* ═══ REVENUE BREAKDOWN ═══ */}
          {revLines.length>0&&(
            <>
              <SectionHdr t="Revenue Breakdown" pageBreak/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
                <IcCard>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead><tr>
                      <th style={thS}>Category</th><th style={thS}>Type</th><th style={thS}>Ct</th>
                      <th style={thS}>Rate</th><th style={thS}>Occ</th><th style={thS}>Annual</th>
                    </tr></thead>
                    <tbody>
                      {revLines.map((l,i)=>{
                        const annual=Number(l.rate_period==="monthly"?Number(l.rate)*12:Number(l.rate))*Number(l.unit_count)*(Number(l.occupancy)??1);
                        return <tr key={i}><td style={{...tdS,fontSize:10}}>{l.category}</td><td style={{...tdS,fontSize:10}}>{l.line_type}</td>
                          <td style={{...tdS,fontSize:10,textAlign:"center"}}>{l.unit_count}</td>
                          <td style={{...tdS,fontSize:10}}>{f.$(Number(l.rate))}/{l.rate_period==="monthly"?"mo":"yr"}</td>
                          <td style={{...tdS,fontSize:10}}>{f.p(Number(l.occupancy)??1)}</td>
                          <td className="ic-green" style={{...tdS,fontSize:10,color:C.green,fontWeight:600}}>{f.$(annual)}</td>
                        </tr>;
                      })}
                      <tr style={{borderTop:`2px solid ${C.gold}`}}>
                        <td colSpan={5} className="ic-gold-text" style={{...tdS,fontWeight:700,color:C.gold}}>Total Revenue</td>
                        <td className="ic-gold-text" style={{...tdS,fontWeight:700,color:C.gold}}>{f.$(yr1Rev)}</td>
                      </tr>
                    </tbody>
                  </table>
                </IcCard>
                <IcCard>
                  <CT c="Revenue by Category"/>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={Object.entries(revByCat).map(([cat,amt])=>({cat,amt}))} margin={{top:10,right:10,bottom:0,left:0}}>
                      <XAxis dataKey="cat" tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
                      <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={45}/>
                      <Tooltip content={<TT/>}/>
                      <Bar dataKey="amt" fill="#5C9BD1" radius={[3,3,0,0]} name="Revenue"/>
                    </BarChart>
                  </ResponsiveContainer>
                </IcCard>
              </div>
            </>
          )}

          {/* ═══ OPERATING EXPENSES ═══ */}
          {expLines.length>0&&(
            <>
              <SectionHdr t="Operating Expenses"/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
                <IcCard>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead><tr>
                      <th style={thS}>Category</th><th style={thS}>Line Item</th><th style={thS}>Annual</th><th style={thS}>Growth</th>
                    </tr></thead>
                    <tbody>
                      {expLines.map((l,i)=>{
                        const annual=l.rate_period==="monthly"?Number(l.amount)*12:Number(l.amount);
                        return <tr key={i}><td style={{...tdS,fontSize:10}}>{l.category}</td><td style={{...tdS,fontSize:10}}>{l.line_type}</td>
                          <td className="ic-red" style={{...tdS,fontSize:10,color:"#E57373"}}>{f.$(annual)}</td>
                          <td style={{...tdS,fontSize:10}}>{f.p(Number(l.growth_rate)||0.03)}</td>
                        </tr>;
                      })}
                      <tr style={{borderTop:`2px solid ${C.gold}`}}>
                        <td colSpan={2} className="ic-red" style={{...tdS,fontWeight:700,color:"#E57373"}}>Total Expenses</td>
                        <td className="ic-red" style={{...tdS,fontWeight:700,color:"#E57373"}}>{f.$(yr1Exp)}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </IcCard>
                <IcCard>
                  <CT c="Expenses by Category"/>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={Object.entries(expByCat).map(([cat,amt])=>({cat,amt}))} margin={{top:10,right:10,bottom:0,left:0}}>
                      <XAxis dataKey="cat" tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
                      <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={45}/>
                      <Tooltip content={<TT/>}/>
                      <Bar dataKey="amt" fill="#E57373" radius={[3,3,0,0]} name="Expenses"/>
                    </BarChart>
                  </ResponsiveContainer>
                  {yr1Rev>0&&(
                    <div className="ic-dim-text" style={{marginTop:8,fontSize:11,color:C.whDim,textAlign:"center"}}>
                      Expense Ratio: <span className="ic-red" style={{fontWeight:600}}>{f.p(yr1Exp/yr1Rev)}</span>
                      {" | "}NOI Margin: <span className="ic-green" style={{color:C.green,fontWeight:600}}>{f.p(yr1Noi/yr1Rev)}</span>
                    </div>
                  )}
                </IcCard>
              </div>
            </>
          )}

          {/* ═══ PROFORMA PROJECTION ═══ */}
          {proforma.length>0&&(
            <>
              <SectionHdr t="Proforma Projection" pageBreak/>
              <IcCard style={{marginBottom:16}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr>
                    <th style={thS}>Metric</th>
                    {proforma.map(yr=><th key={yr.year} style={{...thS,textAlign:"right"}}>Yr {yr.year}</th>)}
                  </tr></thead>
                  <tbody>
                    <tr>
                      <td style={{...tdS,fontWeight:600}}>Revenue</td>
                      {proforma.map(yr=><td key={yr.year} style={{...tdS,textAlign:"right"}}>{f.$(yr.totalRevenue)}</td>)}
                    </tr>
                    <tr>
                      <td className="ic-red" style={{...tdS,fontWeight:600,color:"#E57373"}}>Expenses</td>
                      {proforma.map(yr=><td key={yr.year} className="ic-red" style={{...tdS,textAlign:"right",color:"#E57373"}}>({f.$(yr.totalExpenses)})</td>)}
                    </tr>
                    <tr style={{borderTop:`2px solid ${C.gold}`}}>
                      <td className="ic-gold-text" style={{...tdS,fontWeight:700,color:C.gold}}>NOI</td>
                      {proforma.map(yr=><td key={yr.year} className="ic-gold-text" style={{...tdS,textAlign:"right",fontWeight:700,color:C.gold}}>{f.$(yr.noi)}</td>)}
                    </tr>
                    <tr>
                      <td className="ic-dim-text" style={{...tdS,color:C.whDim}}>Margin</td>
                      {proforma.map(yr=><td key={yr.year} className="ic-dim-text" style={{...tdS,textAlign:"right",color:C.whDim}}>{yr.totalRevenue>0?f.p(yr.noi/yr.totalRevenue):"—"}</td>)}
                    </tr>
                    {pr&&(
                      <>
                        <tr>
                          <td className="ic-dim-text" style={{...tdS,color:C.whDim}}>Debt Service</td>
                          {proforma.map(yr=><td key={yr.year} className="ic-red" style={{...tdS,textAlign:"right",color:"#E57373"}}>({f.$(pr.annualDS)})</td>)}
                        </tr>
                        <tr style={{borderTop:`1px solid ${C.border}`}}>
                          <td className="ic-green" style={{...tdS,fontWeight:600,color:C.green}}>Cash Flow (Levered)</td>
                          {proforma.map(yr=><td key={yr.year} className={yr.noi-pr.annualDS>0?"ic-green":"ic-red"} style={{...tdS,textAlign:"right",fontWeight:600,color:yr.noi-pr.annualDS>0?C.green:C.red}}>{f.$(yr.noi-pr.annualDS)}</td>)}
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
                <div className="ic-no-print" style={{marginTop:14}}>
                  <ResponsiveContainer width="100%" height={200}>
                    <ComposedChart data={proforma} margin={{top:10,right:16,bottom:0,left:0}}>
                      <XAxis dataKey="year" tickFormatter={v=>`Yr ${v}`} tick={{fill:C.whDim,fontSize:10}} axisLine={false} tickLine={false}/>
                      <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={55}/>
                      <Tooltip formatter={(v,name)=>[f.$(v),name]} labelFormatter={v=>`Year ${v}`}
                        contentStyle={{background:C.dark,border:`1px solid ${C.border}`,borderRadius:6,fontSize:11}}
                        itemStyle={{color:C.white}} labelStyle={{color:C.gold,fontWeight:600}}/>
                      <Bar dataKey="totalRevenue" fill="#5C9BD1" radius={[3,3,0,0]} name="Revenue"/>
                      <Bar dataKey="totalExpenses" fill="#E57373" radius={[3,3,0,0]} name="Expenses"/>
                      <Line type="monotone" dataKey="noi" stroke={C.gold} strokeWidth={2.5} dot={{fill:C.gold,r:4}} name="NOI"/>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </IcCard>
            </>
          )}

          {/* ═══ RETURNS ANALYSIS ═══ */}
          {pr&&(
            <>
              <SectionHdr t="Returns Analysis" pageBreak/>
              <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
                <IcKPI label="Levered IRR" value={f.p(pr.levIRR)} gold/>
                <IcKPI label="Unlevered IRR" value={f.p(pr.unlvIRR)}/>
                <IcKPI label="Equity Multiple" value={f.x(pr.moic)}/>
                <IcKPI label="Going-In Cap" value={f.p(pr.goingInCap)}/>
                <IcKPI label="Exit Cap" value={f.p(pr.exitCap)}/>
                <IcKPI label="NOI CAGR" value={f.p(pr.noiCAGR)}/>
                <IcKPI label="Exit Value" value={f.$(pr.exitValue)}/>
                <IcKPI label="Sale Proceeds" value={f.$(pr.saleProceeds)}/>
              </div>
              <IcCard style={{marginBottom:16}}>
                <CT c="Exit Analysis"/>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,fontSize:12}}>
                  {[
                    ["Exit Year NOI",f.$(pr.exitNoi)],["Exit Cap Rate",f.p(pr.exitCap)],["Gross Exit Value",f.$(pr.exitValue)],
                    ["Sale Costs (2%)",f.$(pr.exitValue*0.02)],["Loan Balance",f.$(pr.loanBal)],["Net Sale Proceeds",f.$(pr.saleProceeds)],
                    ["Total Equity Invested",f.$(pr.equity)],["Profit (Equity Basis)",f.$(pr.saleProceeds-pr.equity+(proforma.length>0?proforma.reduce((s,yr)=>s+(yr.noi-pr.annualDS),0):(pr.yr1Noi-pr.annualDS)*pr.holdYrs))],
                    ["Hold Period",`${pr.holdYrs} years`],
                  ].map(([k,v],i)=>(
                    <div key={i}>
                      <div className="ic-kpi-label" style={{fontSize:9,color:C.goldDim,textTransform:"uppercase",letterSpacing:".06em"}}>{k}</div>
                      <div style={{fontSize:13,fontWeight:600,marginTop:2}}>{v}</div>
                    </div>
                  ))}
                </div>
              </IcCard>
            </>
          )}

          {/* ═══ FUND-LEVEL RETURNS ═══ */}
          {analysis?.modelResult&&(
            <>
              <SectionHdr t="Fund-Level Returns" pageBreak/>
              <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
                <IcKPI label="LP Net IRR" value={f.p(analysis.modelResult.lpIRR)} gold/>
                <IcKPI label="LP MOIC" value={f.x(analysis.modelResult.lpMOIC)}/>
                <IcKPI label="GP Promote" value={f.$(analysis.modelResult.gpPromote)}/>
                <IcKPI label="Total Exit Value" value={f.$(analysis.modelResult.totExitVal)}/>
                <IcKPI label="Total Op CF" value={f.$(analysis.modelResult.totOpCF)}/>
              </div>
              {analysis.modelResult.tierResults&&(
                <IcCard style={{marginBottom:16}}>
                  <CT c="Waterfall Distribution"/>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead><tr>
                      <th style={thS}>Tier</th><th style={thS}>Hurdle</th><th style={thS}>LP Split</th>
                      <th style={thS}>GP Split</th><th style={thS}>LP $</th><th style={thS}>GP $</th>
                    </tr></thead>
                    <tbody>
                      <tr><td style={{...tdS,fontWeight:600}}>Return of Capital</td><td style={tdS}>—</td><td style={tdS}>—</td>
                        <td style={tdS}>—</td><td style={{...tdS,color:"#5C9BD1"}}>{f.$(analysis.modelResult.lpROC)}</td><td style={tdS}>—</td></tr>
                      <tr><td style={{...tdS,fontWeight:600}}>Preferred Return</td><td style={tdS}>—</td><td style={tdS}>—</td>
                        <td style={tdS}>—</td><td style={{...tdS,color:"#5C9BD1"}}>{f.$(analysis.modelResult.lpPref)}</td><td style={tdS}>—</td></tr>
                      {analysis.modelResult.tierResults.map((t,i)=>(
                        <tr key={i}><td style={{...tdS,fontWeight:600}}>Tier {i+1}</td>
                          <td style={tdS}>{t.irrHurdle!=null?f.p(t.irrHurdle):t.moicHurdle!=null?f.x(t.moicHurdle):"Residual"}</td>
                          <td style={tdS}>{f.p(t.lpSplit)}</td><td style={tdS}>{f.p(t.gpSplit)}</td>
                          <td style={{...tdS,color:"#5C9BD1"}}>{f.$(t.lp)}</td>
                          <td className="ic-gold-text" style={{...tdS,color:C.gold}}>{f.$(t.gp)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </IcCard>
              )}
            </>
          )}

          {/* ═══ SENSITIVITY ═══ */}
          {analysis?.sensitivity&&(
            <>
              <SectionHdr t="Sensitivity Analysis — LP IRR"/>
              <IcCard style={{marginBottom:16}}>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead><tr>
                      <th style={{...thS,textAlign:"left"}}>Exit Cap ↓ / Growth →</th>
                      {analysis.sensitivity.growthRates.map(g=>(
                        <th key={g} style={{...thS,textAlign:"center"}}>{(g*100).toFixed(0)}%</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {analysis.sensitivity.grid.map(row=>(
                        <tr key={row.exitCap}>
                          <td className="ic-gold-text" style={{...tdS,color:C.goldDim,fontWeight:600}}>{(row.exitCap*100).toFixed(1)}%</td>
                          {analysis.sensitivity.growthRates.map(g=>{
                            const v=row.values[g]?.lpIRR;
                            const bg=v>.18?"rgba(30,132,73,.25)":v>.14?"rgba(255,94,170,.12)":"rgba(192,57,43,.2)";
                            const clr=v>.18?C.green:v>.14?C.white:C.red;
                            const cls=v>.18?"ic-sens-green":v>.14?"ic-sens-yellow":"ic-sens-red";
                            return <td key={g} className={cls} style={{...tdS,textAlign:"center",background:bg,color:clr,fontWeight:500}}>{v!=null?f.p(v):"—"}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </IcCard>
            </>
          )}

          {/* ═══ KEY RISKS ═══ */}
          <SectionHdr t="Key Risks & Considerations" pageBreak/>
          <IcCard style={{marginBottom:30}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,fontSize:12}}>
              {[
                ["Market Risk","Marina valuations tied to local boating demand, economic conditions, and weather events."],
                ["Environmental","Waterfront properties face flood, hurricane, and environmental compliance risks."],
                ["Regulatory","Submerged land leases, dock permitting, and coastal development regulations may impact operations."],
                ["Concentration","Revenue concentrated in slip rentals and seasonal boating activity."],
                ["Capital Expenditure","Docks, seawalls, and lifts require significant ongoing maintenance capital."],
                ["Insurance","Coastal properties face elevated property and liability insurance costs."],
              ].map(([title,desc],i)=>(
                <div key={i}>
                  <div className="ic-risk-title" style={{fontWeight:700,color:C.gold,fontSize:11,marginBottom:3}}>{title}</div>
                  <div className="ic-risk-desc" style={{color:C.whDim,lineHeight:1.5}}>{desc}</div>
                </div>
              ))}
            </div>
          </IcCard>

          {/* ═══ DISCLAIMER ═══ */}
          <div className="ic-disclaimer" style={{textAlign:"center",padding:"20px 0",borderTop:`1px solid ${C.border}`,marginTop:20}}>
            <div style={{fontSize:9,color:"rgba(255,94,170,.3)",lineHeight:1.6,maxWidth:600,margin:"0 auto"}}>
              This Investment Committee Memorandum is confidential and intended solely for the use of the investment committee.
              Projections and forward-looking statements are based on assumptions that may not be realized.
              Past performance is not indicative of future results. All figures are estimates subject to change.
            </div>
          </div>

          <div className="ic-no-print" style={{textAlign:"center",marginTop:20,paddingBottom:40}}>
            <button onClick={()=>setShowPresentation(false)} style={dimBtn}>Close IC Memo</button>
          </div>
        </div>
      </div>
    );
  }

  return(
    <div>
      <PHdr title="Marina Analyzer" sub="Upload financials, build slip/storage mix, run proforma, compare marinas"/>

      {/* ── DEAL LIST + COMPARE ─────────────────────────────── */}
      <Card style={{marginBottom:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <SHdr t="Pipeline"/>
          <div style={{display:"flex",gap:8}}>
            {compareIds.length>=2&&(
              <button onClick={runCompare} disabled={comparing} style={goldBtn}>
                {comparing?"Comparing...":"Compare Selected ("+compareIds.length+")"}
              </button>
            )}
            <button onClick={()=>setCreating(!creating)} style={goldBtn}>+ New Deal</button>
          </div>
        </div>

        {creating&&(
          <div style={{background:"rgba(255,94,170,.06)",border:`1px solid ${C.border}`,borderRadius:6,
            padding:16,marginBottom:14}}>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:10}}>
              {[["name","Marina Name","text",""],["property_type","Marina Type","text","Full-Service Marina"],
                ["market","Market / Region","text",""],["price","Price ($)","number",""],["slips","Slips","number",""]
              ].map(([k,l,t,ph])=>(
                <div key={k} style={{flex:k==="name"?2:1,minWidth:100}}>
                  <div style={{fontSize:9,color:C.goldDim,marginBottom:3,textTransform:"uppercase"}}>{l}</div>
                  <input type={t} value={newDeal[k]} onChange={e=>setNewDeal({...newDeal,[k]:e.target.value})}
                    placeholder={ph} style={{...inputS}}/>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setCreating(false)} style={dimBtn}>Cancel</button>
              <button onClick={createDeal} disabled={!newDeal.name.trim()} style={{...goldBtn,
                opacity:newDeal.name.trim()?1:.4}}>Create Deal</button>
            </div>
          </div>
        )}

        {deals.length===0?(
          <div style={{textAlign:"center",padding:40,color:C.whDim,fontSize:12}}>
            No deals yet. Click "+ New Deal" to add your first deal.
          </div>
        ):(
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>
              <th style={{...thS,width:30}}></th>
              <th style={thS}>Marina</th><th style={thS}>Type</th><th style={thS}>Market</th>
              <th style={thS}>Price</th><th style={thS}>Slips</th><th style={thS}>Files</th><th style={thS}>Status</th>
            </tr></thead>
            <tbody>
              {deals.map(d=>{
                const isSel=selectedDeal?.id===d.id;
                const isComp=compareIds.includes(d.id);
                return(
                  <tr key={d.id} onClick={()=>selectDeal(d.id)} style={{cursor:"pointer",
                    background:isSel?"rgba(255,94,170,.1)":"transparent"}}>
                    <td style={tdS}><input type="checkbox" checked={isComp}
                      onChange={e=>{e.stopPropagation();toggleCompare(d.id);}} style={{cursor:"pointer"}}/></td>
                    <td style={{...tdS,color:isSel?C.gold:C.white,fontWeight:isSel?700:400}}>{d.name}</td>
                    <td style={tdS}>{d.property_type||"—"}</td><td style={tdS}>{d.market||"—"}</td>
                    <td style={tdS}>{d.price?f.$(Number(d.price)):"—"}</td><td style={tdS}>{d.slips||d.units||"—"}</td>
                    <td style={tdS}>{d.financial_count||0}</td>
                    <td style={tdS}><span style={{padding:"2px 8px",borderRadius:10,fontSize:9,fontWeight:600,
                      background:d.status==="active"?"rgba(30,132,73,.2)":d.status==="closed"?"rgba(41,128,185,.2)":"rgba(255,94,170,.12)",
                      color:d.status==="active"?C.green:d.status==="closed"?C.blue:C.gold}}>
                      {(d.status||"pipeline").toUpperCase()}</span></td>
                  </tr>);
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* ── COMPARE RESULTS ───────────────────────────────── */}
      {compareResult&&compareResult.summary&&(
        <Card style={{marginBottom:18}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <SHdr t="Deal Comparison"/>
            <button onClick={()=>setCompareResult(null)} style={dimBtn}>Close</button>
          </div>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><th style={thS}>Metric</th>
              {compareResult.summary.map(s=><th key={s.name} style={{...thS,textAlign:"center"}}>{s.name}</th>)}
            </tr></thead>
            <tbody>
              {[["Price",s=>f.$(s.price)],["Cap Rate",s=>f.p(s.capRate)],["NOI Growth",s=>f.p(s.noiGrowth)],
                ["LP IRR",s=>f.p(s.lpIRR)],["LP MOIC",s=>f.x(s.lpMOIC)],["GP Promote",s=>f.$(s.gpPromote)],
                ["Exit Value",s=>f.$(s.totalExitValue)]
              ].map(([label,fmt])=>(
                <tr key={label} style={{borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                  <td style={{...tdS,color:C.goldDim,fontWeight:600}}>{label}</td>
                  {compareResult.summary.map(s=>{
                    const isBest=label==="LP IRR"&&s.lpIRR===Math.max(...compareResult.summary.map(x=>x.lpIRR));
                    return <td key={s.name} style={{...tdS,textAlign:"center",fontWeight:isBest?700:400,
                      color:isBest?C.gold:C.white}}>{fmt(s)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* ── SELECTED DEAL DETAIL ──────────────────────────── */}
      {selectedDeal&&(
        <Card style={{marginBottom:18}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:C.white,fontFamily:"'Playfair Display',serif"}}>
                {selectedDeal.name}
              </div>
              <div style={{fontSize:10,color:C.goldDim,marginTop:2}}>
                {[selectedDeal.property_type,selectedDeal.market,
                  (selectedDeal.slips||selectedDeal.units)&&`${selectedDeal.slips||selectedDeal.units} slips`,
                  selectedDeal.price&&f.$(Number(selectedDeal.price))
                ].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
              <label style={{...goldBtn,cursor:"pointer",display:"inline-block"}}>
                {uploading?"Uploading...":"Upload Financials"}
                <input type="file" multiple accept=".xlsx,.xls,.xlsm,.csv" onChange={uploadFiles} style={{display:"none"}}/>
              </label>
              <button onClick={runAnalysis} disabled={analyzing}
                style={{...goldBtn,cursor:analyzing?"not-allowed":"pointer"}}>
                {analyzing?"Running Model...":"Analyze"}
              </button>
              <button onClick={()=>setShowVersionPanel(v=>!v)}
                style={{...dimBtn,background:showVersionPanel?"rgba(255,94,170,.15)":"transparent",
                  color:versions.length>0?C.gold:C.whDim}}>
                Versions {versions.length>0?`(${versions.length})`:""}
              </button>
              <button onClick={()=>setShowPresentation(true)} style={dimBtn}>Presentation</button>
              <button onClick={()=>deleteDeal(selectedDeal.id)} style={{...dimBtn,color:C.red}}>Delete</button>
            </div>
          </div>

          {/* ── VERSIONS PANEL ─────────────────────────────── */}
          {showVersionPanel&&(
            <div style={{background:"rgba(255,94,170,.06)",border:`1px solid rgba(255,94,170,.2)`,
              borderRadius:8,padding:14,marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:11,fontWeight:700,color:C.gold,textTransform:"uppercase",letterSpacing:".06em"}}>
                  Saved Versions
                </div>
                <button onClick={()=>setShowVersionInput(v=>!v)}
                  style={{...goldBtn,fontSize:9,padding:"4px 10px"}}>
                  + Save Current
                </button>
              </div>
              {showVersionInput&&(
                <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
                  <input value={versionNameInput} onChange={e=>setVersionNameInput(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&saveVersion()}
                    placeholder="Version name (e.g. Base Case, Bull Scenario)…"
                    style={{flex:1,background:"rgba(255,255,255,.06)",border:`1px solid ${C.border}`,borderRadius:4,
                      color:C.white,fontSize:11,padding:"5px 10px"}}/>
                  <button onClick={saveVersion} disabled={savingVersion}
                    style={{...goldBtn,fontSize:9,padding:"5px 12px"}}>
                    {savingVersion?"Saving…":"Save"}
                  </button>
                  <button onClick={()=>setShowVersionInput(false)} style={{...dimBtn,fontSize:9,padding:"5px 10px"}}>
                    Cancel
                  </button>
                </div>
              )}
              {versions.length===0?(
                <div style={{fontSize:11,color:C.whDim,textAlign:"center",padding:"10px 0"}}>
                  No versions saved yet. Click "+ Save Current" to snapshot this deal.
                </div>
              ):(
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr>
                    <th style={{...thS,textAlign:"left"}}>Name</th>
                    <th style={thS}>Saved</th>
                    <th style={{...thS,width:140}}></th>
                  </tr></thead>
                  <tbody>
                    {versions.map(v=>(
                      <tr key={v.id} style={{borderBottom:`1px solid rgba(255,255,255,.04)`}}>
                        <td style={{...tdS,color:C.white,fontWeight:500}}>{v.version_name}</td>
                        <td style={{...tdS,color:C.whDim,fontSize:10}}>
                          {new Date(v.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})}
                        </td>
                        <td style={{...tdS,textAlign:"right"}}>
                          <button onClick={()=>restoreVersion(v.id)}
                            style={{...dimBtn,fontSize:9,padding:"3px 10px",marginRight:6,color:C.gold}}>
                            Restore
                          </button>
                          <button onClick={()=>deleteVersion(v.id)}
                            style={{background:"transparent",border:"none",color:C.red,cursor:"pointer",fontSize:12,padding:"3px 6px"}}>
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Sub-tabs */}
          <div style={{display:"flex",gap:0,marginBottom:16,borderBottom:`1px solid ${C.border}`}}>
            {dealTabs.map(t=>(
              <button key={t} onClick={()=>setDealTab(t)}
                style={{padding:"8px 18px",fontSize:10,fontWeight:dealTab===t?700:400,color:dealTab===t?C.gold:C.whDim,
                  background:"transparent",border:"none",borderBottom:dealTab===t?`2px solid ${C.gold}`:"2px solid transparent",
                  cursor:"pointer",textTransform:"uppercase",letterSpacing:".06em"}}>{t}</button>
            ))}
          </div>

          {/* ── FINANCIALS SUB-TAB ──────────────────────────── */}
          {dealTab==="financials"&&(
            <div>
              <SHdr t={"Uploaded Financials ("+((selectedDeal.financials||[]).length)+" records)"}/>
              {(!selectedDeal.financials||selectedDeal.financials.length===0)?(
                <div style={{textAlign:"center",padding:24,color:C.whDim,fontSize:11}}>
                  No financials uploaded yet. Upload T12s, slip schedules, or operating statements.
                  <br/><span style={{fontSize:10,color:C.goldDim}}>Supports monthly columns, multi-year files, marina P&Ls with slip/fuel/storage/service detail.</span>
                </div>
              ):(
                <div>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr>
                    <th style={thS}>Type</th><th style={thS}>Year</th><th style={thS}>File</th>
                    <th style={thS}>NOI</th><th style={thS}>Revenue</th><th style={thS}>Occupancy</th>
                    <th style={thS}>Slips</th><th style={{...thS,width:30}}></th>
                  </tr></thead>
                  <tbody>
                    {selectedDeal.financials.map(fin=>{
                      const p=fin.parsed||{};
                      return(
                        <tr key={fin.id}>
                          <td style={tdS}><span style={{padding:"2px 8px",borderRadius:10,fontSize:9,fontWeight:600,
                            background:"rgba(41,128,185,.15)",color:C.blue}}>
                            {(fin.type||"unknown").replace(/_/g," ").toUpperCase()}</span></td>
                          <td style={{...tdS,fontWeight:600}}>{fin.year||"—"}</td>
                          <td style={{...tdS,fontSize:10,color:C.whDim}}>{fin.filename||"—"}</td>
                          <td style={{...tdS,color:p.noi?C.green:C.whDim}}>{p.noi?f.$(p.noi):"—"}</td>
                          <td style={tdS}>{p.revenue?f.$(p.revenue):(p.egi?f.$(p.egi):"—")}</td>
                          <td style={tdS}>{p.occupancy?f.p(p.occupancy):"—"}</td>
                          <td style={tdS}>{p.slips||p.units||"—"}</td>
                          <td style={tdS}><button onClick={(ev)=>{ev.stopPropagation();deleteFinancial(selectedDeal.id,fin.id);}}
                            style={{background:"transparent",border:"none",color:C.red,cursor:"pointer",fontSize:12}}>×</button></td>
                        </tr>);
                    })}
                  </tbody>
                </table>

                {/* Revenue breakdown from parsed data */}
                {selectedDeal.financials.some(fin=>fin.parsed?.revenue_lines?.length>0||fin.parsed?.slip_revenue||fin.parsed?.fuel_revenue)&&(
                  <div style={{marginTop:14}}>
                    <SHdr t="Parsed Revenue Breakdown"/>
                    {selectedDeal.financials.filter(fin=>fin.parsed?.slip_revenue||fin.parsed?.fuel_revenue||fin.parsed?.revenue_lines?.length>0).map(fin=>{
                      const p=fin.parsed;
                      const cats=[
                        p.slip_revenue&&["Slip Revenue",p.slip_revenue],
                        p.dry_storage_revenue&&["Dry Storage",p.dry_storage_revenue],
                        p.fuel_revenue&&["Fuel",p.fuel_revenue],
                        p.service_revenue&&["Service & Repair",p.service_revenue],
                        p.retail_fb_revenue&&["Retail & F&B",p.retail_fb_revenue],
                        p.lift_revenue&&["Lifts & Launch",p.lift_revenue],
                        p.ancillary_revenue&&["Ancillary",p.ancillary_revenue],
                      ].filter(Boolean);
                      if(cats.length===0&&p.revenue_lines?.length>0){
                        // Show individual lines if no category aggregation
                        return <div key={fin.id} style={{marginBottom:10}}>
                          <div style={{fontSize:10,color:C.goldDim,marginBottom:4}}>{fin.year||""} — {fin.filename||"uploaded"}</div>
                          {p.revenue_lines.map((l,i)=>
                            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 12px",fontSize:10,
                              color:C.white,borderBottom:"1px solid rgba(255,255,255,.03)"}}>
                              <span>{l.label}</span><span style={{color:C.green}}>{f.$(l.value)}</span>
                            </div>
                          )}
                        </div>;
                      }
                      return <div key={fin.id} style={{marginBottom:10}}>
                        <div style={{fontSize:10,color:C.goldDim,marginBottom:4}}>{fin.year||""} — {fin.filename||"uploaded"}</div>
                        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                          {cats.map(([label,val])=>
                            <div key={label} style={{background:"rgba(255,255,255,.04)",borderRadius:4,padding:"6px 12px",minWidth:100}}>
                              <div style={{fontSize:8,color:C.goldDim,textTransform:"uppercase"}}>{label}</div>
                              <div style={{fontSize:13,fontWeight:600,color:C.green}}>{f.$(val)}</div>
                              {p.revenue>0&&<div style={{fontSize:8,color:C.whDim}}>{f.p(val/p.revenue)} of rev</div>}
                            </div>
                          )}
                        </div>
                        {p.expense_lines?.length>0&&(
                          <div style={{marginTop:8}}>
                            <div style={{fontSize:9,color:C.goldDim,marginBottom:3}}>TOP EXPENSES</div>
                            {p.expense_lines.sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)).slice(0,8).map((l,i)=>
                              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"2px 12px",fontSize:10,
                                color:C.white,borderBottom:"1px solid rgba(255,255,255,.03)"}}>
                                <span style={{color:C.whDim}}>{l.label}</span><span style={{color:C.red}}>{f.$(Math.abs(l.value))}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>;
                    })}
                  </div>
                )}

                {/* Slip schedule detail */}
                {selectedDeal.financials.filter(fin=>fin.type==="slip_schedule").map(fin=>{
                  const p=fin.parsed||{};
                  const sb=p.size_breakdown||{};
                  return <div key={fin.id} style={{marginTop:14}}>
                    <SHdr t="Slip Schedule Summary"/>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
                      <KPI label="Total Slips" value={p.slips}/>
                      <KPI label="Occupied" value={p.occupied}/>
                      <KPI label="Occupancy" value={p.occupancy?f.p(p.occupancy):"—"}/>
                      <KPI label="Avg Rate" value={p.avg_rate?f.$(p.avg_rate)+"/mo":"—"}/>
                      <KPI label="Avg LOA" value={p.avg_loa?`${Math.round(p.avg_loa)}'`:"—"}/>
                      {p.liveaboard_count>0&&<KPI label="Liveaboards" value={p.liveaboard_count}/>}
                      <KPI label="Annual Slip Rev" value={f.$(p.annual_slip_revenue||0)} gold/>
                    </div>
                    {Object.keys(sb).length>0&&(
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          <th style={thS}>Size</th><th style={thS}>Count</th><th style={thS}>Occupied</th>
                          <th style={thS}>Avg Rate</th><th style={thS}>Annual Rev</th>
                        </tr></thead>
                        <tbody>
                          {Object.entries(sb).sort((a,b)=>(a[0]<b[0]?-1:1)).map(([size,d])=>(
                            <tr key={size}><td style={tdS}>{size}</td><td style={tdS}>{d.count}</td>
                              <td style={tdS}>{d.occupied}</td>
                              <td style={tdS}>{d.count>0?f.$(d.totalRate/d.count)+"/mo":"—"}</td>
                              <td style={{...tdS,color:C.green}}>{f.$(d.totalRate*12)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>;
                })}
                </div>
              )}
            </div>
          )}

          {/* ── REVENUE LINES SUB-TAB ───────────────────────── */}
          {dealTab==="revenue"&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <SHdr t={"Revenue Lines ("+revLines.length+")"}/>
                <div style={{display:"flex",gap:6}}>
                  {Object.keys(REV_LINE_PRESETS).map(p=>(
                    <button key={p} onClick={()=>loadPreset(p)} style={{...dimBtn,fontSize:9,padding:"4px 10px"}}>
                      {p} Preset
                    </button>
                  ))}
                  <button onClick={addRevLine} style={{...goldBtn,fontSize:9,padding:"4px 10px"}}>+ Add Line</button>
                  <button onClick={saveAllLines} disabled={saving} style={{...goldBtn,fontSize:9,padding:"4px 10px",
                    background:revDirty?C.green:saving?"rgba(255,94,170,.4)":"rgba(255,94,170,.3)"}}>{saving?"Saving...":revDirty?"Save":"Saved"}</button>
                  {saveMsg&&<span style={{fontSize:9,color:saveMsg.startsWith("Saved")?C.green:C.red,marginLeft:6}}>{saveMsg}</span>}
                </div>
              </div>

              {revLines.length===0?(
                <div style={{textAlign:"center",padding:30,color:C.whDim,fontSize:11}}>
                  No revenue lines yet. Add lines manually or load a marina preset above.
                </div>
              ):(
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",minWidth:800}}>
                    <thead><tr>
                      <th style={thS}>Category</th><th style={thS}>Type</th><th style={thS}>Count</th>
                      <th style={thS}>Rate ($)</th><th style={thS}>Period</th><th style={thS}>Occ %</th>
                      <th style={thS}>Growth %</th><th style={thS}>Annual Rev</th><th style={{...thS,width:30}}></th>
                    </tr></thead>
                    <tbody>
                      {revLines.map((l,i)=>{
                        const annual=l.rate_period==="monthly"?Number(l.rate)*12:Number(l.rate);
                        const rev=Number(l.unit_count)*annual*(Number(l.occupancy)??1);
                        return(
                          <tr key={i}>
                            <td style={tdS}><input value={l.category||""} onChange={e=>updateRevLine(i,"category",e.target.value)}
                              placeholder="e.g. Slips" style={{...inputS,width:100}}/></td>
                            <td style={tdS}><input value={l.line_type||""} onChange={e=>updateRevLine(i,"line_type",e.target.value)}
                              placeholder="e.g. Wet Slip" style={{...inputS,width:110}}/></td>
                            <td style={tdS}><input type="number" value={l.unit_count||0}
                              onChange={e=>updateRevLine(i,"unit_count",parseInt(e.target.value)||0)}
                              style={{...inputS,width:55,textAlign:"center"}}/></td>
                            <td style={tdS}><input type="number" value={l.rate||0}
                              onChange={e=>updateRevLine(i,"rate",parseFloat(e.target.value)||0)}
                              style={{...inputS,width:80,textAlign:"right"}}/></td>
                            <td style={tdS}>
                              <select value={l.rate_period||"monthly"} onChange={e=>updateRevLine(i,"rate_period",e.target.value)}
                                style={{...inputS,width:75}}>
                                <option value="monthly">Monthly</option>
                                <option value="annual">Annual</option>
                              </select>
                            </td>
                            <td style={tdS}><input type="number" value={Math.round((l.occupancy??1)*100)}
                              onChange={e=>updateRevLine(i,"occupancy",(parseInt(e.target.value)||0)/100)}
                              style={{...inputS,width:50,textAlign:"center"}} min={0} max={100}/></td>
                            <td style={tdS}><input type="number" value={((l.growth_rate||0)*100).toFixed(1)}
                              onChange={e=>updateRevLine(i,"growth_rate",(parseFloat(e.target.value)||0)/100)}
                              style={{...inputS,width:50,textAlign:"center"}} step="0.5"/></td>
                            <td style={{...tdS,color:C.green,fontWeight:600,textAlign:"right"}}>{f.$(rev)}</td>
                            <td style={tdS}><button onClick={()=>removeRevLine(i)}
                              style={{background:"transparent",border:"none",color:C.red,cursor:"pointer",fontSize:12}}>×</button></td>
                          </tr>);
                      })}
                      <tr style={{borderTop:`2px solid ${C.gold}`}}>
                        <td colSpan={7} style={{...tdS,fontWeight:700,color:C.gold,textAlign:"right"}}>Total Year 1 Revenue</td>
                        <td style={{...tdS,fontWeight:700,color:C.gold,textAlign:"right"}}>{f.$(totalRevLineRevenue)}</td>
                        <td style={tdS}></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── EXPENSES SUB-TAB ──────────────────────────── */}
          {dealTab==="expenses"&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <SHdr t={"Operating Expenses ("+expLines.length+")"}/>
                <div style={{display:"flex",gap:6}}>
                  {Object.keys(EXP_LINE_PRESETS).map(p=>(
                    <button key={p} onClick={()=>loadExpPreset(p)} style={{...dimBtn,fontSize:9,padding:"4px 10px"}}>
                      {p} Preset
                    </button>
                  ))}
                  <button onClick={addExpLine} style={{...goldBtn,fontSize:9,padding:"4px 10px"}}>+ Add Line</button>
                  <button onClick={saveAllLines} disabled={saving} style={{...goldBtn,fontSize:9,padding:"4px 10px",
                    background:revDirty?C.green:saving?"rgba(255,94,170,.4)":"rgba(255,94,170,.3)"}}>{saving?"Saving...":revDirty?"Save":"Saved"}</button>
                  {saveMsg&&<span style={{fontSize:9,color:saveMsg.startsWith("Saved")?C.green:C.red,marginLeft:6}}>{saveMsg}</span>}
                </div>
              </div>

              {expLines.length===0?(
                <div style={{textAlign:"center",padding:30,color:C.whDim,fontSize:11}}>
                  No expense lines yet. Add lines manually or load a marina expense preset.
                </div>
              ):(
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}>
                    <thead><tr>
                      <th style={thS}>Category</th><th style={thS}>Type</th><th style={thS}>Amount ($)</th>
                      <th style={thS}>Period</th><th style={thS}>Growth %</th><th style={thS}>% of Rev</th>
                      <th style={thS}>Annual</th><th style={{...thS,width:30}}></th>
                    </tr></thead>
                    <tbody>
                      {expLines.map((l,i)=>{
                        const annual=l.rate_period==="monthly"?l.amount*12:l.amount;
                        return(
                          <tr key={i}>
                            <td style={tdS}><input value={l.category||""} onChange={e=>updateExpLine(i,"category",e.target.value)}
                              placeholder="e.g. Payroll" style={{...inputS,width:110}}/></td>
                            <td style={tdS}><input value={l.line_type||""} onChange={e=>updateExpLine(i,"line_type",e.target.value)}
                              placeholder="e.g. Dock Staff" style={{...inputS,width:130}}/></td>
                            <td style={tdS}><input type="number" value={l.amount||0}
                              onChange={e=>updateExpLine(i,"amount",parseFloat(e.target.value)||0)}
                              style={{...inputS,width:90,textAlign:"right"}}/></td>
                            <td style={tdS}>
                              <select value={l.rate_period||"annual"} onChange={e=>updateExpLine(i,"rate_period",e.target.value)}
                                style={{...inputS,width:75}}>
                                <option value="monthly">Monthly</option>
                                <option value="annual">Annual</option>
                              </select>
                            </td>
                            <td style={tdS}><input type="number" value={((l.growth_rate||0)*100).toFixed(1)}
                              onChange={e=>updateExpLine(i,"growth_rate",(parseFloat(e.target.value)||0)/100)}
                              style={{...inputS,width:50,textAlign:"center"}} step="0.5"/></td>
                            <td style={tdS}>{l.pct_of_revenue?<span style={{color:C.goldDim}}>{(l.pct_of_revenue*100).toFixed(0)}%</span>:
                              <span style={{color:"rgba(255,255,255,.2)"}}>—</span>}</td>
                            <td style={{...tdS,color:C.red,fontWeight:600,textAlign:"right"}}>{f.$(annual)}</td>
                            <td style={tdS}><button onClick={()=>removeExpLine(i)}
                              style={{background:"transparent",border:"none",color:C.red,cursor:"pointer",fontSize:12}}>×</button></td>
                          </tr>);
                      })}
                      <tr style={{borderTop:`2px solid ${C.gold}`}}>
                        <td colSpan={6} style={{...tdS,fontWeight:700,color:C.gold,textAlign:"right"}}>Total Year 1 Expenses</td>
                        <td style={{...tdS,fontWeight:700,color:C.red,textAlign:"right"}}>{f.$(totalExpLineAmount)}</td>
                        <td style={tdS}></td>
                      </tr>
                      {totalRevLineRevenue>0&&(
                        <tr>
                          <td colSpan={6} style={{...tdS,color:C.goldDim,textAlign:"right",fontSize:10}}>Expense Ratio</td>
                          <td style={{...tdS,color:C.goldDim,textAlign:"right",fontSize:10}}>{f.p(totalExpLineAmount/totalRevLineRevenue)}</td>
                          <td style={tdS}></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── PROFORMA SUB-TAB ────────────────────────────── */}
          {dealTab==="proforma"&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <SHdr t="Proforma Projection"/>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <span style={{fontSize:8,color:C.whDim}}>Dbl-click to edit. Right-click to reset.</span>
                  <button onClick={saveAllLines} disabled={saving} style={{...goldBtn,fontSize:10,padding:"5px 14px",
                    background:revDirty?C.green:saving?"rgba(255,94,170,.4)":"rgba(255,94,170,.3)"}}>{saving?"Saving...":revDirty?"Save Changes":"Saved"}</button>
                  {saveMsg&&<span style={{fontSize:9,color:saveMsg.startsWith("Saved")?C.green:C.red,marginLeft:6}}>{saveMsg}</span>}
                  {Object.keys(proformaOverrides).length>0&&(
                    <button onClick={()=>{setProformaOverrides({});setRevDirty(true);}} style={{...dimBtn,fontSize:9,padding:"4px 10px"}}>
                      Clear Overrides ({Object.keys(proformaOverrides).length})
                    </button>
                  )}
                </div>
              </div>
              {/* ── PROFORMA DEAL ASSUMPTIONS ── */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:8,marginBottom:14}}>
                <div style={{background:C.whFaint,border:`1px solid ${C.border}`,borderRadius:4,padding:"8px 10px"}}>
                  <div style={{fontSize:8,color:C.goldDim,textTransform:"uppercase",letterSpacing:".08em",marginBottom:3}}>Acquisition Price</div>
                  <input type="number" value={dealAssumptions.price||""} placeholder="Enter price"
                    onChange={e=>setDealAssumptions(p=>({...p,price:e.target.value?Number(e.target.value):null}))}
                    style={{...inputS,fontSize:12,fontWeight:600,padding:"4px 6px"}}/>
                  {dealAssumptions.price&&<div style={{fontSize:8,color:C.whDim,marginTop:1}}>{f.$(dealAssumptions.price)}</div>}
                </div>
                <div style={{background:C.whFaint,border:`1px solid ${C.border}`,borderRadius:4,padding:"8px 10px"}}>
                  <div style={{fontSize:8,color:C.goldDim,textTransform:"uppercase",letterSpacing:".08em",marginBottom:3}}>Trailing 12 NOI</div>
                  <input type="number" value={dealAssumptions.t12Noi||""} placeholder="T-12 NOI"
                    onChange={e=>setDealAssumptions(p=>({...p,t12Noi:e.target.value?Number(e.target.value):null,
                      goingInCap:e.target.value&&p.price?Number(e.target.value)/p.price:p.goingInCap}))}
                    style={{...inputS,fontSize:12,fontWeight:600,padding:"4px 6px"}}/>
                  {dealAssumptions.t12Noi&&dealAssumptions.price&&<div style={{fontSize:8,color:C.whDim,marginTop:1}}>{f.p(dealAssumptions.t12Noi/dealAssumptions.price)} cap</div>}
                </div>
                <div style={{background:C.whFaint,border:`1px solid ${C.border}`,borderRadius:4,padding:"8px 10px"}}>
                  <Sli label="Exit Cap" value={dealAssumptions.exitCapRate||0.075} min={0.04} max={0.12} step={0.001}
                    disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>setDealAssumptions(p=>({...p,exitCapRate:v}))}/>
                </div>
                <div style={{background:C.whFaint,border:`1px solid ${C.border}`,borderRadius:4,padding:"8px 10px"}}>
                  <Sli label="Leverage" value={dealAssumptions.debtPct||0.6} min={0} max={0.80} step={0.05}
                    disp={v=>`${(v*100).toFixed(0)}%`} onChange={v=>setDealAssumptions(p=>({...p,debtPct:v}))}/>
                </div>
                <div style={{background:C.whFaint,border:`1px solid ${C.border}`,borderRadius:4,padding:"8px 10px"}}>
                  <Sli label="Interest Rate" value={dealAssumptions.interestRate||0.065} min={0.03} max={0.10} step={0.00125}
                    disp={v=>`${(v*100).toFixed(2)}%`} onChange={v=>setDealAssumptions(p=>({...p,interestRate:v}))}/>
                </div>
                <div style={{background:C.whFaint,border:`1px solid ${C.border}`,borderRadius:4,padding:"8px 10px"}}>
                  <Sli label="Hold Period" value={dealAssumptions.holdYears||7} min={3} max={15} step={1}
                    disp={v=>`${v} yrs`} onChange={v=>setDealAssumptions(p=>({...p,holdYears:v}))}/>
                </div>
              </div>

              {/* ── PROFORMA RETURNS KPIs ── */}
              {proformaReturns&&(
                <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
                  <KPI label="Levered IRR" value={f.p(proformaReturns.levIRR)} gold/>
                  <KPI label="Unlevered IRR" value={f.p(proformaReturns.unlvIRR)}/>
                  <KPI label="Equity MOIC" value={f.x(proformaReturns.moic)}/>
                  <KPI label="Exit Value" value={f.$(proformaReturns.exitValue)} sub={`${f.p(proformaReturns.exitCap)} cap`}/>
                  <KPI label="Going-In Cap" value={f.p(proformaReturns.goingInCap)} sub={`Yr1 NOI: ${f.$(proformaReturns.yr1Noi)}`}/>
                  <KPI label="NOI Growth" value={f.p(proformaReturns.noiCAGR)} sub="From proforma"/>
                  <KPI label="Equity" value={f.$(proformaReturns.equity)} sub={`${f.p(proformaReturns.debtPct)} LTV`}/>
                  <KPI label="Annual Debt Service" value={f.$(proformaReturns.annualDS)}/>
                  <KPI label="Sale Proceeds" value={f.$(proformaReturns.saleProceeds)}/>
                </div>
              )}

              {revLines.length===0&&expLines.length===0?(
                <div style={{textAlign:"center",padding:30,color:C.whDim,fontSize:11}}>
                  Add revenue and expense lines first to generate a proforma.
                </div>
              ):(
                <div>
                  {/* ── ANNUAL SUMMARY — click year to expand monthly ── */}
                  <div style={{overflowX:"auto",marginBottom:16}}>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr>
                        <th style={thS}></th><th style={thS}>Year</th><th style={thS}>Revenue</th><th style={thS}>Expenses</th>
                        <th style={thS}>NOI</th><th style={thS}>Margin</th><th style={thS}>NOI YoY</th>
                      </tr></thead>
                      <tbody>
                        {proforma.map((yr,i)=>{
                          const prevNoi=i>0?proforma[i-1].noi:null;
                          const yoy=prevNoi&&prevNoi>0?(yr.noi-prevNoi)/prevNoi:null;
                          const isExpanded=expandedYears[yr.year];
                          return(<React.Fragment key={yr.year}>
                            <tr style={{background:isExpanded?"rgba(255,94,170,.06)":"transparent"}}>
                              <td style={{...tdS,width:24,cursor:"pointer",textAlign:"center",color:C.goldDim,fontSize:13}}
                                onClick={()=>setExpandedYears(p=>({...p,[yr.year]:!p[yr.year]}))}>
                                {isExpanded?"▾":"▸"}
                              </td>
                              <td style={{...tdS,fontWeight:600,cursor:"pointer"}}
                                onClick={()=>setExpandedYears(p=>({...p,[yr.year]:!p[yr.year]}))}>
                                Yr {yr.year}
                              </td>
                              <EditableCell cellKey={`totalRevenue_${yr.year}`} computedValue={yr.totalRevenue} style={{color:C.white}}/>
                              <EditableCell cellKey={`totalExpenses_${yr.year}`} computedValue={yr.totalExpenses} style={{color:"#E57373"}}/>
                              <EditableCell cellKey={`noi_${yr.year}`} computedValue={yr.noi} style={{color:"#66BB6A",fontWeight:600}}/>
                              <td style={tdS}>{yr.totalRevenue>0?f.p(yr.noi/yr.totalRevenue):"—"}</td>
                              <td style={{...tdS,color:yoy&&yoy>0?"#66BB6A":yoy&&yoy<0?"#E57373":C.whDim}}>
                                {yoy!=null?f.p(yoy):"—"}</td>
                            </tr>
                            {/* ── MONTHLY ROWS (expanded) ── */}
                            {isExpanded&&yr.monthlyTotals.map(mt=>(
                              <tr key={`${yr.year}_m${mt.month}`} style={{background:"rgba(255,255,255,.02)"}}>
                                <td style={{...tdS,width:24}}></td>
                                <td style={{...tdS,fontSize:10,color:C.whDim,paddingLeft:24}}>{MONTHS[mt.month]}</td>
                                <EditableCell cellKey={`totalRevenue_${yr.year}_m${mt.month}`}
                                  computedValue={mt.revenue} style={{fontSize:10}}/>
                                <EditableCell cellKey={`totalExpenses_${yr.year}_m${mt.month}`}
                                  computedValue={mt.expenses} style={{fontSize:10,color:"#E57373"}}/>
                                <td style={{...tdS,fontSize:10,color:"#66BB6A"}}>{f.$(mt.noi)}</td>
                                <td style={{...tdS,fontSize:10}}>{mt.revenue>0?f.p(mt.noi/mt.revenue):"—"}</td>
                                <td style={tdS}></td>
                              </tr>
                            ))}
                          </React.Fragment>);
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* ── REVENUE BY LINE — with monthly expand ── */}
                  {revLines.length>0&&(
                    <div>
                      <SHdr t="Revenue by Line"/>
                      <div style={{overflowX:"auto",marginBottom:14}}>
                        <table style={{width:"100%",borderCollapse:"collapse",minWidth:600}}>
                          <thead><tr>
                            <th style={thS}>Line</th>
                            {proforma.map(yr=><th key={yr.year} style={{...thS,textAlign:"center"}}>
                              <span style={{cursor:"pointer"}} onClick={()=>setExpandedYears(p=>({...p,[yr.year]:!p[yr.year]}))}>
                                Yr {yr.year} {expandedYears[yr.year]?"▾":""}
                              </span>
                            </th>)}
                          </tr></thead>
                          <tbody>
                            {revLines.map((l,li)=>(
                              <React.Fragment key={li}>
                                <tr>
                                  <td style={{...tdS,whiteSpace:"nowrap",fontSize:10}}>{l.category} — {l.line_type}</td>
                                  {proforma.map(yr=>{
                                    const line=yr.revLines?.[li];
                                    return <EditableCell key={yr.year} cellKey={`rev_${li}_${yr.year}`}
                                      computedValue={line?.effective||0} style={{textAlign:"center"}}/>;
                                  })}
                                </tr>
                                {/* Growth rate row for this line */}
                                <tr style={{background:"rgba(255,255,255,.02)"}}>
                                  <td style={{...tdS,fontSize:9,color:C.whDim,paddingLeft:16,fontStyle:"italic"}}>↳ Growth %</td>
                                  {proforma.map(yr=>{
                                    const line=yr.revLines?.[li];
                                    const growthKey=`rev_${li}_growth_${yr.year}`;
                                    const isOvr=proformaOverrides[growthKey]!=null;
                                    const pct=line?.growthRate||0;
                                    if(yr.year===1) return <td key={yr.year} style={{...tdS,textAlign:"center",fontSize:9,color:C.whDim}}>—</td>;
                                    if(editingCell?.key===growthKey){
                                      return <td key={yr.year} style={{...tdS,padding:"2px 4px"}}><input type="number" autoFocus
                                        defaultValue={(pct*100).toFixed(1)} step="0.5"
                                        onBlur={e=>{const v=parseFloat(e.target.value);if(!isNaN(v)){setOverride(growthKey,v/100);}setEditingCell(null);}}
                                        onKeyDown={e=>{if(e.key==="Enter")e.target.blur();if(e.key==="Escape")setEditingCell(null);}}
                                        style={{...inputS,width:"100%",textAlign:"center",fontSize:10,padding:"2px 4px"}}/></td>;
                                    }
                                    return <td key={yr.year} style={{...tdS,textAlign:"center",fontSize:9,cursor:"pointer",
                                      color:isOvr?"#5C9BD1":C.whDim,background:isOvr?"rgba(41,128,185,.08)":"transparent"}}
                                      onDoubleClick={()=>setEditingCell({key:growthKey,currentValue:pct})}
                                      onContextMenu={e=>{if(isOvr){e.preventDefault();clearOverride(growthKey);}}}>
                                      {(pct*100).toFixed(1)}%{isOvr&&<span style={{fontSize:7,color:C.blue,marginLeft:2}}>HC</span>}
                                    </td>;
                                  })}
                                </tr>
                                {/* Monthly detail for this rev line */}
                                {proforma.some(yr=>expandedYears[yr.year])&&(
                                  MONTHS.map((mName,mi)=>{
                                    if(!proforma.some(yr=>expandedYears[yr.year])) return null;
                                    return <tr key={`${li}_m${mi}`} style={{background:"rgba(255,255,255,.015)"}}>
                                      <td style={{...tdS,fontSize:9,color:C.whDim,paddingLeft:20}}>{mName}</td>
                                      {proforma.map(yr=>{
                                        if(!expandedYears[yr.year]) return <td key={yr.year} style={{...tdS,textAlign:"center",fontSize:9,color:"rgba(255,255,255,.15)"}}>—</td>;
                                        const line=yr.revLines?.[li];
                                        const mVal=line?.months?.[mi]?.value||0;
                                        return <EditableCell key={yr.year} cellKey={`rev_${li}_${yr.year}_m${mi}`}
                                          computedValue={mVal} style={{textAlign:"center",fontSize:9}}/>;
                                      })}
                                    </tr>;
                                  })
                                )}
                              </React.Fragment>
                            ))}
                            <tr style={{borderTop:`1px solid ${C.gold}`}}>
                              <td style={{...tdS,fontWeight:600,color:C.gold}}>Total Revenue</td>
                              {proforma.map(yr=>(
                                <td key={yr.year} style={{...tdS,textAlign:"center",fontWeight:600,color:C.gold}}>
                                  {f.$(yr.totalRevenue)}</td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ── EXPENSES BY LINE — with monthly expand ── */}
                  {expLines.length>0&&(
                    <div>
                      <SHdr t="Expenses by Line"/>
                      <div style={{overflowX:"auto",marginBottom:14}}>
                        <table style={{width:"100%",borderCollapse:"collapse",minWidth:600}}>
                          <thead><tr>
                            <th style={thS}>Line</th>
                            {proforma.map(yr=><th key={yr.year} style={{...thS,textAlign:"center"}}>
                              Yr {yr.year}
                            </th>)}
                          </tr></thead>
                          <tbody>
                            {expLines.map((l,li)=>(
                              <React.Fragment key={li}>
                                <tr>
                                  <td style={{...tdS,whiteSpace:"nowrap",fontSize:10}}>{l.category} — {l.line_type}</td>
                                  {proforma.map(yr=>{
                                    const line=yr.expLines?.[li];
                                    return <EditableCell key={yr.year} cellKey={`exp_${li}_${yr.year}`}
                                      computedValue={line?.amount||0} style={{textAlign:"center",color:"#E57373"}}/>;
                                  })}
                                </tr>
                                {/* Growth rate row for this expense line */}
                                <tr style={{background:"rgba(255,255,255,.02)"}}>
                                  <td style={{...tdS,fontSize:9,color:C.whDim,paddingLeft:16,fontStyle:"italic"}}>↳ Growth %</td>
                                  {proforma.map(yr=>{
                                    const line=yr.expLines?.[li];
                                    const growthKey=`exp_${li}_growth_${yr.year}`;
                                    const isOvr=proformaOverrides[growthKey]!=null;
                                    const pct=line?.growthRate||0;
                                    if(yr.year===1) return <td key={yr.year} style={{...tdS,textAlign:"center",fontSize:9,color:C.whDim}}>—</td>;
                                    if(editingCell?.key===growthKey){
                                      return <td key={yr.year} style={{...tdS,padding:"2px 4px"}}><input type="number" autoFocus
                                        defaultValue={(pct*100).toFixed(1)} step="0.5"
                                        onBlur={e=>{const v=parseFloat(e.target.value);if(!isNaN(v)){setOverride(growthKey,v/100);}setEditingCell(null);}}
                                        onKeyDown={e=>{if(e.key==="Enter")e.target.blur();if(e.key==="Escape")setEditingCell(null);}}
                                        style={{...inputS,width:"100%",textAlign:"center",fontSize:10,padding:"2px 4px"}}/></td>;
                                    }
                                    return <td key={yr.year} style={{...tdS,textAlign:"center",fontSize:9,cursor:"pointer",
                                      color:isOvr?"#E57373":C.whDim,background:isOvr?"rgba(229,115,115,.08)":"transparent"}}
                                      onDoubleClick={()=>setEditingCell({key:growthKey,currentValue:pct})}
                                      onContextMenu={e=>{if(isOvr){e.preventDefault();clearOverride(growthKey);}}}>
                                      {(pct*100).toFixed(1)}%{isOvr&&<span style={{fontSize:7,color:"#E57373",marginLeft:2}}>HC</span>}
                                    </td>;
                                  })}
                                </tr>
                                {proforma.some(yr=>expandedYears[yr.year])&&(
                                  MONTHS.map((mName,mi)=>{
                                    if(!proforma.some(yr=>expandedYears[yr.year])) return null;
                                    return <tr key={`${li}_m${mi}`} style={{background:"rgba(255,255,255,.015)"}}>
                                      <td style={{...tdS,fontSize:9,color:C.whDim,paddingLeft:20}}>{mName}</td>
                                      {proforma.map(yr=>{
                                        if(!expandedYears[yr.year]) return <td key={yr.year} style={{...tdS,textAlign:"center",fontSize:9,color:"rgba(255,255,255,.15)"}}>—</td>;
                                        const line=yr.expLines?.[li];
                                        const mVal=line?.months?.[mi]?.value||0;
                                        return <EditableCell key={yr.year} cellKey={`exp_${li}_${yr.year}_m${mi}`}
                                          computedValue={mVal} style={{textAlign:"center",fontSize:9,color:"#E57373"}}/>;
                                      })}
                                    </tr>;
                                  })
                                )}
                              </React.Fragment>
                            ))}
                            <tr style={{borderTop:`1px solid ${C.gold}`}}>
                              <td style={{...tdS,fontWeight:600,color:"#E57373"}}>Total Expenses</td>
                              {proforma.map(yr=>(
                                <td key={yr.year} style={{...tdS,textAlign:"center",fontWeight:600,color:"#E57373"}}>
                                  {f.$(yr.totalExpenses)}</td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ── CHART — improved colors ── */}
                  <Card>
                    <CT c="Annual Projection"/>
                    <ResponsiveContainer width="100%" height={240}>
                      <ComposedChart data={proforma} margin={{top:10,right:16,bottom:0,left:0}}>
                        <XAxis dataKey="year" tickFormatter={v=>`Yr ${v}`} tick={{fill:C.white,fontSize:10}}
                          axisLine={false} tickLine={false}/>
                        <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={{fill:C.whDim,fontSize:9}}
                          axisLine={false} tickLine={false} width={50}/>
                        <Tooltip formatter={(v,name)=>[f.$(v),name]} labelFormatter={v=>`Year ${v}`}
                          contentStyle={{background:C.dark,border:`1px solid ${C.border}`,borderRadius:6,fontSize:11}}
                          itemStyle={{color:C.white}} labelStyle={{color:C.gold,fontWeight:600}}/>
                        <Bar dataKey="totalRevenue" fill="#5C9BD1" radius={[4,4,0,0]} name="Revenue"/>
                        <Bar dataKey="totalExpenses" fill="#E57373" radius={[4,4,0,0]} name="Expenses"/>
                        <Line type="monotone" dataKey="noi" stroke={C.gold} strokeWidth={3}
                          dot={{fill:C.gold,r:5,stroke:C.dark,strokeWidth:2}} name="NOI"/>
                      </ComposedChart>
                    </ResponsiveContainer>
                  </Card>

                  {/* ── MONTHLY CHART for expanded year ── */}
                  {Object.entries(expandedYears).filter(([,v])=>v).map(([yrStr])=>{
                    const yrNum=Number(yrStr);
                    const yrData=proforma.find(y=>y.year===yrNum);
                    if(!yrData) return null;
                    const chartData=yrData.monthlyTotals.map(mt=>({
                      month:MONTHS[mt.month], revenue:mt.revenue, expenses:mt.expenses, noi:mt.noi
                    }));
                    return <Card key={yrNum} style={{marginTop:12}}>
                      <CT c={`Year ${yrNum} — Monthly Detail`}/>
                      <ResponsiveContainer width="100%" height={200}>
                        <ComposedChart data={chartData} margin={{top:10,right:16,bottom:0,left:0}}>
                          <XAxis dataKey="month" tick={{fill:C.white,fontSize:9}} axisLine={false} tickLine={false}/>
                          <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={{fill:C.whDim,fontSize:9}}
                            axisLine={false} tickLine={false} width={50}/>
                          <Tooltip formatter={(v,name)=>[f.$(v),name]} labelFormatter={v=>v}
                            contentStyle={{background:C.dark,border:`1px solid ${C.border}`,borderRadius:6,fontSize:11}}
                            itemStyle={{color:C.white}} labelStyle={{color:C.gold,fontWeight:600}}/>
                          <Bar dataKey="revenue" fill="#5C9BD1" radius={[3,3,0,0]} name="Revenue"/>
                          <Bar dataKey="expenses" fill="#E57373" radius={[3,3,0,0]} name="Expenses"/>
                          <Line type="monotone" dataKey="noi" stroke={C.gold} strokeWidth={2.5}
                            dot={{fill:C.gold,r:4,stroke:C.dark,strokeWidth:1}} name="NOI"/>
                        </ComposedChart>
                      </ResponsiveContainer>
                    </Card>;
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── ANALYSIS SUB-TAB ────────────────────────────── */}
          {dealTab==="analysis"&&(
            <div>
              {/* ── DEAL ASSUMPTIONS CONTROLS ── */}
              <div style={{marginBottom:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <SHdr t="Deal Assumptions"/>
                  <button onClick={runAnalysis} disabled={analyzing}
                    style={{...goldBtn,fontSize:10,padding:"6px 18px",
                      background:analyzing?"rgba(255,94,170,.4)":C.gold}}>
                    {analyzing?"Running...":"Run Analysis"}
                  </button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10,marginBottom:12}}>
                  {/* Acquisition Price */}
                  <div style={{background:C.whFaint,border:`1px solid ${C.border}`,borderRadius:4,padding:"10px 12px"}}>
                    <div style={{fontSize:8,color:C.goldDim,textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>Acquisition Price</div>
                    <input type="number" value={dealAssumptions.price||""} placeholder="e.g. 12000000"
                      onChange={e=>setDealAssumptions(p=>({...p,price:e.target.value?Number(e.target.value):null}))}
                      style={{...inputS,fontSize:13,fontWeight:600,padding:"6px 8px"}}/>
                    {dealAssumptions.price&&<div style={{fontSize:9,color:C.whDim,marginTop:2}}>{f.$(dealAssumptions.price)}</div>}
                  </div>
                  {/* T-12 NOI */}
                  <div style={{background:C.whFaint,border:`1px solid ${C.border}`,borderRadius:4,padding:"10px 12px"}}>
                    <div style={{fontSize:8,color:C.goldDim,textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>Trailing 12 NOI</div>
                    <input type="number" value={dealAssumptions.t12Noi||""} placeholder="e.g. 1750000"
                      onChange={e=>setDealAssumptions(p=>({...p,t12Noi:e.target.value?Number(e.target.value):null,
                        goingInCap:e.target.value&&p.price?Number(e.target.value)/p.price:p.goingInCap}))}
                      style={{...inputS,fontSize:13,fontWeight:600,padding:"6px 8px"}}/>
                    {dealAssumptions.t12Noi&&<div style={{fontSize:9,color:C.whDim,marginTop:2}}>
                      {f.$(dealAssumptions.t12Noi)}{dealAssumptions.price?` | ${f.p(dealAssumptions.t12Noi/dealAssumptions.price)} cap`:""}
                    </div>}
                  </div>
                  {/* Going-In Cap */}
                  <div style={{background:C.whFaint,border:`1px solid ${C.border}`,borderRadius:4,padding:"10px 12px"}}>
                    <Sli label="Going-In Cap Rate" value={dealAssumptions.goingInCap||(dealAssumptions.t12Noi&&dealAssumptions.price?dealAssumptions.t12Noi/dealAssumptions.price:0.07)} min={0.03} max={0.12} step={0.001}
                      disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>setDealAssumptions(p=>({...p,goingInCap:v}))}/>
                  </div>
                  {/* Exit Cap Rate */}
                  <div style={{background:C.whFaint,border:`1px solid ${C.border}`,borderRadius:4,padding:"10px 12px"}}>
                    <Sli label="Exit Cap Rate" value={dealAssumptions.exitCapRate||0.075} min={0.04} max={0.12} step={0.001}
                      disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>setDealAssumptions(p=>({...p,exitCapRate:v}))}/>
                  </div>
                  {/* NOI Growth */}
                  <div style={{background:C.whFaint,border:`1px solid ${C.border}`,borderRadius:4,padding:"10px 12px"}}>
                    <Sli label="NOI Growth Rate" value={dealAssumptions.noiGrowth||0.03} min={0} max={0.12} step={0.0025}
                      disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>setDealAssumptions(p=>({...p,noiGrowth:v}))}/>
                  </div>
                  {/* Hold Period */}
                  <div style={{background:C.whFaint,border:`1px solid ${C.border}`,borderRadius:4,padding:"10px 12px"}}>
                    <Sli label="Hold Period" value={dealAssumptions.holdYears||7} min={3} max={15} step={1}
                      disp={v=>`${v} yrs`} onChange={v=>setDealAssumptions(p=>({...p,holdYears:v}))}/>
                  </div>
                  {/* Debt % */}
                  <div style={{background:C.whFaint,border:`1px solid ${C.border}`,borderRadius:4,padding:"10px 12px"}}>
                    <Sli label="Leverage (LTV)" value={dealAssumptions.debtPct||0.6} min={0} max={0.80} step={0.05}
                      disp={v=>`${(v*100).toFixed(0)}%`} onChange={v=>setDealAssumptions(p=>({...p,debtPct:v}))}/>
                  </div>
                  {/* Interest Rate */}
                  <div style={{background:C.whFaint,border:`1px solid ${C.border}`,borderRadius:4,padding:"10px 12px"}}>
                    <Sli label="Interest Rate" value={dealAssumptions.interestRate||0.065} min={0.03} max={0.10} step={0.00125}
                      disp={v=>`${(v*100).toFixed(2)}%`} onChange={v=>setDealAssumptions(p=>({...p,interestRate:v}))}/>
                  </div>
                </div>
                <div style={{fontSize:9,color:C.whDim,marginBottom:6}}>
                  Adjust assumptions above, then click "Run Analysis" to see updated returns.
                </div>
              </div>

              {/* ── LIVE RETURNS (updates instantly with slider changes) ── */}
              {proformaReturns?(
                <div>
                  <SHdr t="Returns Summary"/>
                  <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
                    <KPI label="Levered IRR" value={f.p(proformaReturns.levIRR)} gold/>
                    <KPI label="Unlevered IRR" value={f.p(proformaReturns.unlvIRR)}/>
                    <KPI label="Equity MOIC" value={f.x(proformaReturns.moic)}/>
                    <KPI label="Exit Value" value={f.$(proformaReturns.exitValue)}/>
                    <KPI label="Sale Proceeds" value={f.$(proformaReturns.saleProceeds)}/>
                    <KPI label="Yr1 NOI" value={f.$(proformaReturns.yr1Noi)}/>
                  </div>
                  <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
                    <KPI label="Going-In Cap" value={f.p(proformaReturns.goingInCap)} sub="NOI / Price"/>
                    <KPI label="NOI Growth" value={f.p(proformaReturns.noiCAGR)} sub="Applied to model"/>
                    <KPI label="Debt Service" value={f.$(proformaReturns.annualDS)} sub="Annual"/>
                    <KPI label="Price" value={f.$(proformaReturns.price)}/>
                  </div>
                </div>
              ):(
                <div style={{textAlign:"center",padding:20,color:C.whDim,fontSize:11,marginBottom:10}}>
                  Set acquisition price and T-12 NOI (or add revenue lines) to see live returns.
                </div>
              )}

              {/* ── SERVER ANALYSIS (waterfall, sensitivity, historical) ── */}
              {analysis&&analysis.modelResult?(
                <div>
                  {/* LP/GP Fund-Level Returns */}
                  <SHdr t="Fund-Level LP/GP Returns"/>
                  <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
                    <KPI label="LP IRR" value={f.p(analysis.modelResult.lpIRR)} gold/>
                    <KPI label="LP MOIC" value={f.x(analysis.modelResult.lpMOIC)}/>
                    <KPI label="GP Promote" value={f.$(analysis.modelResult.gpPromote)}/>
                    <KPI label="Total Exit Value" value={f.$(analysis.modelResult.totExitVal)}/>
                    <KPI label="Total Op CF" value={f.$(analysis.modelResult.totOpCF)}/>
                  </div>

                  {analysis.historicalAnalysis&&analysis.historicalAnalysis.yearsOfData>0&&(
                    <div style={{marginBottom:14}}>
                      <SHdr t={"Historical Analysis ("+analysis.historicalAnalysis.yearsOfData+" years)"}/>
                      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:10}}>
                        <KPI label="NOI CAGR" value={f.p(analysis.historicalAnalysis.noiCAGR)} sub="From uploaded data"/>
                        {analysis.historicalAnalysis.revenueGrowth!=null&&
                          <KPI label="Revenue CAGR" value={f.p(analysis.historicalAnalysis.revenueGrowth)}/>}
                        {analysis.historicalAnalysis.expenseGrowth!=null&&
                          <KPI label="Expense CAGR" value={f.p(analysis.historicalAnalysis.expenseGrowth)}/>}
                        {analysis.historicalAnalysis.avgOccupancy!=null&&
                          <KPI label="Avg Occupancy" value={f.p(analysis.historicalAnalysis.avgOccupancy)}/>}
                      </div>
                      {analysis.historicalAnalysis.noiHistory.length>=2&&(
                        <Card style={{marginBottom:10}}>
                          <CT c="Historical NOI Trend"/>
                          <ResponsiveContainer width="100%" height={180}>
                            <BarChart data={analysis.historicalAnalysis.noiHistory} margin={{top:10,right:16,bottom:0,left:0}}>
                              <XAxis dataKey="year" tick={{fill:C.whDim,fontSize:10}} axisLine={false} tickLine={false}/>
                              <YAxis tickFormatter={v=>f.$(v)} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={50}/>
                              <Tooltip content={<TT/>}/>
                              <Bar dataKey="noi" fill={C.gold} radius={[3,3,0,0]} name="NOI"/>
                            </BarChart>
                          </ResponsiveContainer>
                        </Card>
                      )}
                    </div>
                  )}

                  {analysis.modelResult.tierResults&&(
                    <div>
                      <SHdr t="Waterfall Breakdown"/>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          <th style={thS}>Tier</th><th style={thS}>IRR</th><th style={thS}>MOIC</th>
                          <th style={thS}>LP %</th><th style={thS}>GP %</th><th style={thS}>LP $</th><th style={thS}>GP $</th>
                        </tr></thead>
                        <tbody>
                          <tr><td style={{...tdS,fontWeight:600}}>ROC</td><td style={tdS}>—</td><td style={tdS}>—</td>
                            <td style={tdS}>—</td><td style={tdS}>—</td>
                            <td style={{...tdS,color:C.blue}}>{f.$(analysis.modelResult.lpROC)}</td><td style={tdS}>—</td></tr>
                          <tr><td style={{...tdS,fontWeight:600}}>Pref</td><td style={tdS}>—</td><td style={tdS}>—</td>
                            <td style={tdS}>—</td><td style={tdS}>—</td>
                            <td style={{...tdS,color:C.blue}}>{f.$(analysis.modelResult.lpPref)}</td><td style={tdS}>—</td></tr>
                          {analysis.modelResult.tierResults.map((t,i)=>(
                            <tr key={i}><td style={{...tdS,fontWeight:600}}>Tier {i+1}</td>
                              <td style={tdS}>{t.irrHurdle!=null?f.p(t.irrHurdle):"—"}</td>
                              <td style={tdS}>{t.moicHurdle!=null?f.x(t.moicHurdle):"—"}</td>
                              <td style={tdS}>{f.p(t.lpSplit)}</td><td style={tdS}>{f.p(t.gpSplit)}</td>
                              <td style={{...tdS,color:C.blue}}>{f.$(t.lp)}</td>
                              <td style={{...tdS,color:C.gold}}>{f.$(t.gp)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {analysis.sensitivity&&(
                    <div style={{marginTop:14}}>
                      <SHdr t="Sensitivity — LP IRR"/>
                      <div style={{overflowX:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse"}}>
                          <thead><tr>
                            <th style={{...thS,textAlign:"left"}}>Exit Cap ↓ / Growth →</th>
                            {analysis.sensitivity.growthRates.map(g=>(
                              <th key={g} style={{...thS,textAlign:"center"}}>{(g*100).toFixed(0)}%</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {analysis.sensitivity.grid.map(row=>(
                              <tr key={row.exitCap}>
                                <td style={{...tdS,color:C.goldDim,fontWeight:600}}>{(row.exitCap*100).toFixed(1)}%</td>
                                {analysis.sensitivity.growthRates.map(g=>{
                                  const v=row.values[g]?.lpIRR;
                                  const bg=v>.18?"rgba(30,132,73,.25)":v>.14?"rgba(255,94,170,.12)":"rgba(192,57,43,.2)";
                                  const clr=v>.18?C.green:v>.14?C.white:C.red;
                                  return <td key={g} style={{...tdS,textAlign:"center",background:bg,color:clr,
                                    fontWeight:500}}>{v!=null?f.p(v):"—"}</td>;
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ):(
                <div style={{fontSize:9,color:C.goldDim,textAlign:"center",marginTop:8}}>
                  Click "Run Analysis" for full fund-level LP/GP waterfall and sensitivity grid.
                </div>
              )}
            </div>
          )}

          {/* ── PRESENTATION SUB-TAB ────────────────────────── */}
          {dealTab==="presentation"&&(
            <div style={{textAlign:"center",padding:30}}>
              <div style={{color:C.whDim,fontSize:12,marginBottom:14}}>
                Generate an investment memorandum with historicals, revenue breakdown, proforma, and fund returns.
              </div>
              <button onClick={()=>setShowPresentation(true)} style={goldBtn}>Open Presentation View</button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
