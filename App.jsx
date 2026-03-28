import { useState, useMemo, useCallback, useEffect } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, AreaChart, Area, ComposedChart } from "recharts";

const C = {
  // Helm brand palette
  bg:"#FAFAF8",           surface:"#FFFFFF",      surfaceAlt:"#F4F5F7",
  navy:"#0A2342",         navyDim:"rgba(10,35,66,0.06)",
  text:"#1A2E44",         textDim:"#64748B",       textFaint:"#94A3B8",
  accent:"#00D4FF",       accentDim:"rgba(0,212,255,0.12)", accentLight:"rgba(0,212,255,0.08)",
  green:"#059669",        greenL:"rgba(5,150,105,0.08)",
  red:"#DC2626",          redL:"rgba(220,38,38,0.08)",
  blue:"#2563EB",         blueL:"rgba(37,99,235,0.08)",
  gold:"#D4AF37",         goldDim:"rgba(212,175,55,0.5)", goldFaint:"rgba(212,175,55,0.06)",
  border:"#E2E8F0",       borderDark:"#CBD5E1",
  cardBg:"#FFFFFF",       cardBorder:"#E2E8F0",
  // Nav-surface text (white on navy)
  navText:"#FFFFFF",      navTextDim:"rgba(255,255,255,0.55)",
  // Backward-compat aliases
  white:"#1A2E44",   whDim:"#64748B",   whFaint:"#F4F5F7",
  mid:"#64748B",     dark:"#0F172A",
};

// ── DEFAULT STATE ─────────────────────────────────────────────────────────────
const DEF_ASSET_BASE = {
  revenueMode: "topdown",
  price:4500000, cap:.075, growth:.034,
  slips:[],lodging:[],fuelGallons:0,fuelMargin:0,upland:[],otherIncome:0,
  opex:[],capexItems:[],
  noiY1Growth:1.012, noiY2Growth:.03,
  noiPlug:463125,   // Y1 NOI: hotel(15×$325×90×50%margin) + slips(65×$5K×75%margin)
  txCosts:700000,
  ioPeriod:12,    // months of interest-only before amortizing (per deal)
  bwMarketing:50000, bwAccounting:40000, bwIT:35000, bwRevMgmt:0,
  startMonth:1,
};

// Generate 30 marina deals: 3 at closing, then 1 every 2 months
const DEF_ASSETS = Array.from({length:30},(_,i)=>{
  const startMonth = i<3 ? 1 : 1+(i-2)*2; // deals 1-3 at M1, deal 4 at M3, deal 5 at M5...
  return {
    ...DEF_ASSET_BASE,
    name:`Marina ${i+1}`,
    startMonth,
    slips:[
      {type:"Marina Slips (Y1)",count:65,rate:417,occ:1.0,period:"y1"},
      {type:"Marina Slips (Y2+)",count:50,rate:438,occ:1.0,period:"y2"},
    ],
    lodging:[
      {type:"Hotel Units",units:15,adr:325,occ:.247,period:"y1"},   // 90 nights / 365 = .247
      {type:"Hotel Units",units:30,adr:325,occ:.411,period:"y2"},   // 150 nights / 365 = .411
    ],
    opex:[
      {label:"Hotel Operating Costs (50% margin)",amount:219375,growth:.03},
      {label:"Marina Operating Costs (25% margin)",amount:81250,growth:.05},
    ],
    capexItems:[
      {label:"Hotel Conversion Phase 1 (15 units @ $175K)",amount:2600000,year:0},
      {label:"Hotel Conversion Phase 2 (15 units @ $175K)",amount:2600000,year:1},
    ],
  };
});

const DEF_HIRES = [];

const DEF_OVERHEAD = [
  {label:"NewCo Corporate G&A", annual:1500000, start:1, rampMo:1, growth:.075, ramps:false, scope:"global"},
];

const DEF_ONE_TIME = [];

const DEF_PARTNER_SALARIES = [];

const DEFAULT = {
  fundTerm:6, debtPct:.50, interestRate:.07, amortYears:25,
  exitCapRate:.08, saleCosts:.02, carry:.20, prefReturn:.08,
  gpPct:0, amFee:0, pmFee:0, benefitsRate:.22, salaryGrowth:.03,
  partners:3, compoundPref:false, catchUp:false,
  assets:DEF_ASSETS, hires:DEF_HIRES, overhead:DEF_OVERHEAD, oneTime:DEF_ONE_TIME, partnerSalaries:DEF_PARTNER_SALARIES,
};

// ── MATH ──────────────────────────────────────────────────────────────────────
function pmt(r,n,pv){ return r===0?pv/n:(pv*r*Math.pow(1+r,n))/(Math.pow(1+r,n)-1); }
function fvLoan(r,n,pmt,pv){ return r===0?pv-pmt*n:pv*Math.pow(1+r,n)-pmt*(Math.pow(1+r,n)-1)/r; }
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

// ── MODEL ─────────────────────────────────────────────────────────────────────
function run(a){
  const {assets,hires,overhead,fundTerm,debtPct,interestRate,amortYears,
    exitCapRate,saleCosts,carry,prefReturn,gpPct,amFee,pmFee,
    benefitsRate,salaryGrowth,partners,partnerSalaries,oneTime=[],
    compoundPref=false,catchUp=false}=a;
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

  // ── Bottom-up revenue helper (period: "y1" or "y2" to filter) ──
  function calcBottomUpRevenue(a, period){
    const pf = r => !period || !r.period || r.period===period || (period==="y2" && r.period==="y2+");
    const slipRev = (a.slips||[]).filter(pf).reduce((s,r)=>s + r.count*r.rate*12*r.occ, 0);
    const lodgingRev = (a.lodging||[]).filter(pf).reduce((s,r)=>s + r.units*r.adr*365*r.occ, 0);
    const fuel = (a.fuelGallons||0)*(a.fuelMargin||0);
    const uplandRev = (a.upland||[]).reduce((s,r)=>s + r.rent*12, 0);
    const other = a.otherIncome||0;
    return {slipRev,lodgingRev,fuel,uplandRev,other, total:slipRev+lodgingRev+fuel+uplandRev+other};
  }

  // ── BW management fee helper (per deal, per year) ──
  function calcBWFees(a, noiAmt){
    const fixed = (a.bwMarketing||0)+(a.bwAccounting||0)+(a.bwIT||0);
    const revMgmt = noiAmt*(a.bwRevMgmt||0);
    return {fixed, revMgmt, total:fixed+revMgmt,
      marketing:a.bwMarketing||0, accounting:a.bwAccounting||0, it:a.bwIT||0, revMgmtPct:a.bwRevMgmt||0};
  }

  // ── Asset calcs ──
  const assetR=assets.map(asset=>{
    const ioYrs = Math.ceil((asset.ioPeriod||0)/12); // per-deal I/O period in whole years
    const eq=asset.price*(1-debtPct), debt=asset.price*debtPct;
    const ioAnnDS = debt*interestRate; // interest-only annual payment
    const amAnnDS = pmt(interestRate,amortYears,debt); // fully amortizing annual payment
    const annDS = amAnnDS; // legacy reference (amortizing rate)

    // CapEx: sum items by year
    const capexItems = asset.capexItems||[];
    const capexByYear = {};
    capexItems.forEach(c=>{ capexByYear[c.year]=(capexByYear[c.year]||0)+c.amount; });
    const totalCapex = capexItems.reduce((s,c)=>s+c.amount,0);
    const day1Capex = capexByYear[0]||0;

    // OpEx: recurring annual expenses (each can have its own growth rate)
    const opexItems = asset.opex||[];
    const y1Opex = opexItems.reduce((s,o)=>s+o.amount, 0);
    const opexByYear = Array.from({length:fundTerm+1},(_,y)=>{
      if(y===0) return 0;
      return opexItems.reduce((s,o)=>s + o.amount*Math.pow(1+(o.growth||0), y-1), 0);
    });

    // Compute gross revenue and base NOI (Y1 and Y2 separately)
    const buRevY1 = calcBottomUpRevenue(asset, "y1");
    const buRevY2 = calcBottomUpRevenue(asset, "y2");
    const buRev = buRevY1; // default display = Y1
    let grossRev, baseNOI, grossRevY2, baseNOIY2;
    if(asset.noiPlug!=null && asset.noiPlug>0){
      baseNOI = asset.noiPlug;
      grossRev = baseNOI + y1Opex;
      grossRevY2 = grossRev; baseNOIY2 = baseNOI;
    } else if(asset.revenueMode==="bottomup" && buRevY1.total>0){
      grossRev = buRevY1.total;
      baseNOI = grossRev - y1Opex;
      grossRevY2 = buRevY2.total;
      baseNOIY2 = grossRevY2 - y1Opex; // Y2 opex uses same base (growth handled separately)
    } else {
      baseNOI = asset.price*asset.cap;
      grossRev = baseNOI + y1Opex;
      grossRevY2 = grossRev; baseNOIY2 = baseNOI;
    }

    // NOI schedule: Y1 uses noiY1Growth, Y2+ uses noiY2Growth
    const g1 = asset.noiY1Growth!=null ? asset.noiY1Growth : (asset.growth||.05);
    const g2 = asset.noiY2Growth!=null ? asset.noiY2Growth : (asset.growth||.05);
    const noi=Array.from({length:fundTerm+1},(_,y)=>{
      if(y===0) return 0;
      if(y===1) return baseNOI;
      let v = baseNOI * (1+g1);
      for(let yr=3; yr<=y; yr++) v *= (1+g2);
      return v;
    });

    // BW fees per year
    const bwFees = noi.map((n,y)=> y===0 ? {fixed:0,revMgmt:0,total:0} : calcBWFees(asset, n));
    const bwAnn = bwFees.map(f=>f.total);

    // CapEx funded 50/50 debt/equity — each tranche creates additional debt
    const txCosts = asset.txCosts||0;
    const capexEqByYear = {};  // equity portion of capex per year
    const capexDebtByYear = {}; // debt portion of capex per year
    Object.entries(capexByYear).forEach(([yr,amt])=>{
      capexEqByYear[yr] = amt * (1 - debtPct);
      capexDebtByYear[yr] = amt * debtPct;
    });

    // Build annual debt service schedule including capex debt tranches
    // Each capex debt tranche gets its own I/O period then amortizes
    const dsByYear = Array.from({length:fundTerm+1},(_,y)=>{
      if(y===0) return 0;
      // Acquisition debt
      let ds = y<=ioYrs ? ioAnnDS : amAnnDS;
      // CapEx debt tranches — each starts I/O from its deployment year
      Object.entries(capexDebtByYear).forEach(([cy,cd])=>{
        const capYr = Number(cy);
        const yrsActive = y - capYr;
        if(yrsActive<=0) return; // not yet deployed
        const capIO = Math.ceil((asset.ioPeriod||0)/12);
        if(yrsActive<=capIO) ds += cd*interestRate; // I/O
        else ds += pmt(interestRate,amortYears,cd); // amortizing
      });
      return ds;
    });

    // Total loan balance at exit (acquisition + all capex tranches)
    const acqAmYrs = Math.max(0, fundTerm - ioYrs);
    let totalLB = acqAmYrs>0 ? Math.abs(fvLoan(interestRate,acqAmYrs,amAnnDS,debt)) : debt;
    Object.entries(capexDebtByYear).forEach(([cy,cd])=>{
      const capYr = Number(cy);
      const capIO = Math.ceil((asset.ioPeriod||0)/12);
      const yrsHeld = fundTerm - capYr;
      if(yrsHeld<=0){ totalLB += cd; return; }
      const capAmYrs = Math.max(0, yrsHeld - capIO);
      totalLB += capAmYrs>0 ? Math.abs(fvLoan(interestRate,capAmYrs,pmt(interestRate,amortYears,cd),cd)) : cd;
    });

    // Equity cash flow
    const ecf = noi.map((n,y)=>{
      const capEq = capexEqByYear[y]||0; // equity portion of capex
      if(y===0) return -(eq + capEq + txCosts);
      return n - dsByYear[y] - bwAnn[y] - capEq; // deduct capex equity + all debt service
    });

    const exitNOI = noi[fundTerm];
    const exitVal = exitNOI / exitCapRate;
    const lb = totalLB;
    const saleNet = exitVal - lb - exitVal*saleCosts;
    ecf[fundTerm] += saleNet;
    const eqIRR = irr(ecf);
    const totalEquityIn = eq + Object.values(capexEqByYear).reduce((s,v)=>s+v,0) + txCosts;
    const totalDebt = debt + Object.values(capexDebtByYear).reduce((s,v)=>s+v,0);
    // MOIC = total distributions / equity invested
    const moic = ecf.slice(1).reduce((s,v)=>s+v,0) / totalEquityIn;
    const totBWFee = bwAnn.reduce((s,v)=>s+v,0);

    return {...asset, eq, debt, totalDebt, annDS, ioAnnDS, amAnnDS, ioYrs, dsByYear, noi, bwFees, bwAnn, totBWFee,
      totalCapex, day1Capex, capexByYear, capexEqByYear, capexDebtByYear, txCosts,
      buRev, buRevY1, buRevY2, grossRev, grossRevY2, baseNOIY2, y1Opex, opexByYear,
      saleNet, exitVal, lb, irr:eqIRR, moic, baseNOI, totalEquityIn};
  });

  // Monthly portfolio — total equity includes acq equity + capex equity + tx costs
  const totEqDep=assetR.reduce((s,x)=>s+(x.totalEquityIn||0),0);
  const totGPIn=totEqDep*gpPct,totLPIn=totEqDep*(1-gpPct);

  const monthly=Array.from({length:MO},(_,i)=>{
    const mo=i+1;
    let noi=0,invEq=0,ds=0,bwF=0,capxF=0;
    assetR.forEach((ar,ai)=>{
      const x=assets[ai];
      if(mo<x.startMonth)return;
      const yr=Math.floor((mo-x.startMonth)/12)+1;
      const moNOI=(yr<=fundTerm?ar.noi[yr]:ar.noi[fundTerm])/12;
      noi+=moNOI;
      const bwYear = yr<=fundTerm ? ar.bwAnn[yr] : ar.bwAnn[fundTerm];
      bwF+=bwYear/12;
      // Capex equity portion spread across the year's months
      const yrCapexEq = ar.capexEqByYear?.[yr]||0;
      if(yrCapexEq>0) capxF+=yrCapexEq/12;
      invEq+=x.price*(1-debtPct);
      // Total debt service (acq + capex tranches) from precomputed annual schedule
      const yrDS = yr<=fundTerm ? (ar.dsByYear?.[yr]||0) : (ar.dsByYear?.[fundTerm]||0);
      ds+=yrDS/12;
    });
    const ga=gaMonthly[i].total;
    const netOpCF=noi-ds-bwF-capxF-ga;
    const lpCall=assets.reduce((s,x)=>x.startMonth===mo?s+x.price*(1-debtPct)*(1-gpPct):s,0);
    const gpCall=assets.reduce((s,x)=>x.startMonth===mo?s+x.price*(1-debtPct)*gpPct:s,0);
    return{mo,noi,invEq,ds,bwF,netOpCF,lpCall,gpCall,ga};
  });

  // Totals
  const totLPCalled=monthly.reduce((s,x)=>s+x.lpCall,0);
  const totGPCalled=monthly.reduce((s,x)=>s+x.gpCall,0);
  const totSaleProc=assetR.reduce((s,x)=>s+x.saleNet,0);
  const totOpCF=monthly.reduce((s,x)=>s+x.netOpCF,0);  // net of G&A already
  const totGA=gaMonthly.reduce((s,x)=>s+x.total,0);
  const totPartnerSal=gaMonthly.reduce((s,x)=>s+(x.partnerSalCost||0),0);

  // No fees — G&A is deducted directly from operating cash flow
  const totFees=0;
  const totGAShortfall=0;
  const lpActualCapital = totLPCalled;
  const gpActualCapital = totGPCalled;

  // WATERFALL
  const pool=totSaleProc+totOpCF;
  let rem=pool;

  // Tier 1: LP gets back equity + funded shortfall; GP gets back equity only
  const lpROC=Math.min(lpActualCapital,rem); rem-=lpROC;
  const gpROC=Math.min(gpActualCapital,rem); rem-=gpROC;


  // Tier 2: LP preferred return — simple or compound
  // Simple:   lpActualCapital * rate * years
  // Compound: lpActualCapital * ((1+rate)^years - 1)  — standard for institutional LPAs
  const lpPrefDue = compoundPref
    ? lpActualCapital * (Math.pow(1+prefReturn, fundTerm) - 1)
    : lpActualCapital * prefReturn * fundTerm;
  const lpPref=Math.min(lpPrefDue,rem); rem-=lpPref;

  // Tier 3: Catch-up + Promote
  // Without catch-up: GP gets carry% of everything above pref
  // With catch-up: GP first takes 100% until GP total = carry% of (pref+promote pool),
  //   then residual splits carry / (1-carry).
  //   Formula: catch-up amount = (carry * lpPref) / (1 - carry)
  let gpPromote=0, lpResid=0;
  if(catchUp){
    const cuAmt = Math.min(rem, (carry * lpPref) / (1 - carry)); // GP catches up
    rem -= cuAmt;
    gpPromote = cuAmt + Math.max(0,rem*carry);
    lpResid   = Math.max(0,rem*(1-carry));
  } else {
    gpPromote = Math.max(0,rem*carry);
    lpResid   = Math.max(0,rem*(1-carry));
  }

  const lpTotal=lpROC+lpPref+lpResid;
  const gpFundTotal=gpROC+gpPromote;
  const lpMOIC=lpTotal/Math.max(1,lpActualCapital);  // MOIC on actual LP capital deployed

  // LP IRR — annual approximation
  const lpCF=Array(fundTerm+1).fill(0);
  lpCF[0]=-lpActualCapital;  // LP total capital at risk incl. funded shortfall
  const annualInterimLP=(totOpCF*(1-gpPct))/(fundTerm);
  for(let y=1;y<fundTerm;y++)lpCF[y]=annualInterimLP;
  lpCF[fundTerm]=lpTotal-annualInterimLP*(fundTerm-1);
  const lpIRR=irr(lpCF);

  // ── GP ENTITY cash flow (month by month)
  // GP earns: promote at exit + pro-rata share of operating CF
  // GP spends: co-invest capital calls
  // G&A is already deducted from fund operating CF directly
  const gpEntity=monthly.map((m,i)=>{
    const fees=0;
    const opDist=Math.max(0,m.netOpCF)*gpPct; // GP's pro-rata share of net op CF (after G&A)
    const coInvest=-m.gpCall;
    const ga=0;  // G&A already in fund CF
    const net=opDist+coInvest;
    return{mo:m.mo,fees,opDist,coInvest,ga,net,promote:0,shortfallROC:0};
  });
  // Month 84: promote from waterfall
  gpEntity[MO-1].promote=gpPromote;
  gpEntity[MO-1].net+=gpPromote;

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

  // Portfolio NOI chart
  const noiChart=Array.from({length:fundTerm},(_,y)=>({
    year:`Yr ${y+1}`,
    noi:assetR.reduce((s,ar)=>s+(ar.noi[y+1]||0),0),
  }));

  // Fund CF by year
  const fundCFAnnual=Array.from({length:fundTerm},(_,y)=>{
    const s=y*12,e=(y+1)*12;
    const slice=monthly.slice(s,e);
    return{
      year:`Yr ${y+1}`,
      lpCalls:-slice.reduce((t,x)=>t+x.lpCall,0),
      opCF:slice.reduce((t,x)=>t+x.netOpCF,0),
      noi:slice.reduce((t,x)=>t+x.noi,0),
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
    gpROC,gpPromote,gpFundTotal,
    totEqDep,totLPIn,totLPCalled,totGPCalled,totGPIn,
    totGAShortfall,lpActualCapital,gpActualCapital,
    totSaleProc,totOpCF,pool,totFees,totGA,
    gpEntity,gpCumData,gpNetTotal,gpBreakeven,
    promPP,drawsPP,rocPP,coInvPP,totalPP,netPP,
    partnerMonthly,partnerCum,
    totPartnerSal,
    noiChart,fundCFAnnual,deplCurve,gaMonthly,gaChart,monthly,
    waterfall:[
      {name:"LP Capital", value:lpROC,      fill:"#4EA8DE"},
      {name:"LP Pref",    value:lpPref,     fill:"#1E3A5F"},
      {name:"LP Residual",value:lpResid,    fill:"#22D3EE"},
      {name:"GP Co-inv",  value:gpROC,      fill:"#8B7536"},
      {name:"GP Promote", value:gpPromote,  fill:C.gold},
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
  <div style={{background:gold?C.navy:C.surface,border:`1px solid ${gold?C.navy:C.border}`,
    borderRadius:10,padding:"16px 20px",flex:1,minWidth:120,
    boxShadow:gold?"0 2px 8px rgba(10,35,66,0.20)":"0 1px 4px rgba(10,35,66,0.06)"}}>
    <div style={{fontSize:9,letterSpacing:"0.10em",textTransform:"uppercase",
      color:gold?C.navTextDim:C.textDim,marginBottom:5,fontWeight:600,
      fontFamily:"'JetBrains Mono',monospace"}}>{label}</div>
    <div style={{fontSize:22,fontWeight:700,color:gold?C.navText:C.text,
      fontFamily:"'DM Serif Display',serif",lineHeight:1.1}}>{value}</div>
    {sub&&<div style={{fontSize:10,color:gold?"rgba(255,255,255,.45)":C.textFaint,marginTop:4}}>{sub}</div>}
  </div>
);

const Sli=({label,value,min,max,step,disp,onChange,sub})=>{
  const p=Math.min(100,Math.max(0,((value-min)/(max-min))*100));
  return(
    <div style={{marginBottom:15}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
        <span style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"0.07em",fontFamily:"'JetBrains Mono',monospace"}}>{label}</span>
        <span style={{fontSize:11,color:C.navy,fontWeight:600,fontFamily:"'JetBrains Mono',monospace"}}>{disp(value)}</span>
      </div>
      <div style={{position:"relative",height:3,background:C.border,borderRadius:2}}>
        <div style={{position:"absolute",left:0,width:`${p}%`,height:"100%",background:C.navy,borderRadius:2}}/>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e=>onChange(Number(e.target.value))}
          style={{position:"absolute",top:-7,left:0,width:"100%",height:18,opacity:0,cursor:"pointer",margin:0,padding:0}}/>
      </div>
      {sub&&<div style={{fontSize:9,color:C.textFaint,marginTop:2}}>{sub}</div>}
    </div>
  );
};

const MiniSlider=({value,min,max,step,onChange,color=C.accent,width=80})=>{
  const pct=Math.min(100,Math.max(0,((value-min)/(max-min))*100));
  return(
    <div style={{position:"relative",height:4,background:C.border,
      borderRadius:3,width,flexShrink:0}}>
      <div style={{position:"absolute",left:0,width:`${pct}%`,height:"100%",
        background:color,borderRadius:3,pointerEvents:"none"}}/>
      <div style={{position:"absolute",left:`calc(${pct}% - 6px)`,top:-4,
        width:12,height:12,borderRadius:"50%",background:color,
        pointerEvents:"none",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e=>onChange(Number(e.target.value))}
        style={{position:"absolute",top:-7,left:0,width:"100%",height:18,
          opacity:0,cursor:"pointer",margin:0,padding:0}}/>
    </div>
  );
};

const SHdr=({t})=>(
  <div style={{fontSize:9,letterSpacing:"0.14em",textTransform:"uppercase",color:C.gold,
    fontWeight:700,marginBottom:9,paddingBottom:5,borderBottom:"1px solid rgba(212,175,55,0.25)",
    fontFamily:"'JetBrains Mono',monospace"}}>{t}</div>
);

const PHdr=({title,sub})=>(
  <div style={{marginBottom:22}}>
    <div style={{fontSize:22,fontWeight:700,color:C.text,fontFamily:"'DM Serif Display',serif",marginBottom:3,
      letterSpacing:"-0.01em"}}>{title}</div>
    {sub&&<div style={{fontSize:12,color:C.textDim}}>{sub}</div>}
  </div>
);

const Card=({children,style={}})=>(
  <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"18px 20px",
    boxShadow:"0 1px 3px rgba(0,0,0,0.04)",...style}}>{children}</div>
);

const CT=({c})=>(
  <div style={{fontSize:10,color:C.textDim,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12,fontWeight:700}}>{c}</div>
);

const TT=({active,payload,label})=>{
  if(!active||!payload?.length)return null;
  return(
    <div style={{background:"#FFFFFF",border:`1px solid ${C.border}`,
      borderRadius:8,padding:"10px 14px",fontSize:11,fontFamily:"'Inter',sans-serif",
      boxShadow:"0 4px 12px rgba(0,0,0,0.1)"}}>
      {label&&<div style={{color:C.text,marginBottom:4,fontWeight:700}}>{label}</div>}
      {payload.map((p,i)=>(
        <div key={i} style={{color:p.color||C.text}}>
          {p.name}: {typeof p.value==="number"?f.$(p.value):p.value}
        </div>
      ))}
    </div>
  );
};

// ── TABS ──────────────────────────────────────────────────────────────────────
const TABS=["Overview","Deals","Waterfall","Fund CF","G&A Model","GP Partners","Sensitivity","Targets"];

// ── APP ───────────────────────────────────────────────────────────────────────
// ── SCENARIO API HELPERS ──────────────────────────────────────────────────────
async function apiFetchAll(){
  try{
    const r=await fetch("/api/scenarios");
    if(!r.ok) return {};
    const rows=await r.json();
    const map={};
    rows.forEach(row=>{ map[row.name]={...row.data,_savedAt:row.updated_at}; });
    return map;
  }catch{ return {}; }
}
async function apiSave(name,data){
  try{
    await fetch(`/api/scenarios/${encodeURIComponent(name)}`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({data})
    });
  }catch(e){ console.error("Save failed",e); }
}
async function apiDelete(name){
  try{
    await fetch(`/api/scenarios/${encodeURIComponent(name)}`,{method:"DELETE"});
  }catch(e){ console.error("Delete failed",e); }
}

export default function Portal(){
  const [tab,setTab]=useState("Overview");
  const [a,setA]=useState(DEFAULT);
  const [scenarios,setScenarios]=useState({});
  const [scenName,setScenName]=useState("Base Case");
  const [showScen,setShowScen]=useState(false);
  const [editingName,setEditingName]=useState(false);
  const [scenLoading,setScenLoading]=useState(false);

  // Load all scenarios from the backend on mount
  useEffect(()=>{
    apiFetchAll().then(s=>setScenarios(s));
  },[]);

  const saveScenario=useCallback(async()=>{
    const payload={...a,_savedAt:new Date().toISOString()};
    setScenarios(prev=>({...prev,[scenName]:payload}));
    await apiSave(scenName,payload);
  },[scenName,a]);

  const loadScenario=useCallback(async(name)=>{
    setScenLoading(true);
    // Fetch fresh from server
    try{
      const r=await fetch(`/api/scenarios/${encodeURIComponent(name)}`);
      if(r.ok){
        const row=await r.json();
        const {_savedAt,...rest}=row.data||{};
        setA(()=>({...DEFAULT,...rest}));
        setScenarios(prev=>({...prev,[name]:{...row.data,_savedAt:row.updated_at}}));
        setScenName(name); setShowScen(false);
      }
    }catch(e){console.error(e);}
    setScenLoading(false);
  },[]);

  const deleteScenario=useCallback(async(name)=>{
    setScenarios(prev=>{ const u={...prev}; delete u[name]; return u; });
    await apiDelete(name);
  },[]);

  const duplicateScenario=useCallback(async(name)=>{
    const newName=name+" (copy)";
    const payload={...scenarios[name]};
    setScenarios(prev=>({...prev,[newName]:payload}));
    await apiSave(newName,payload);
  },[scenarios]);

  const propagateGlobal=useCallback(async(type,i,k,v)=>{
    const updated={...scenarios};
    Object.keys(updated).forEach(nm=>{
      if(updated[nm][type])
        updated[nm]={...updated[nm],[type]:updated[nm][type].map((x,j)=>j===i?{...x,[k]:v}:x)};
    });
    setScenarios(updated);
    await Promise.all(Object.keys(updated).map(nm=>apiSave(nm,updated[nm])));
  },[scenarios]);

  const set=useCallback((k,v)=>setA(p=>({...p,[k]:v})),[]);

  const setAsset=useCallback((i,k,v)=>setA(p=>({...p,assets:p.assets.map((x,j)=>j===i?{...x,[k]:v}:x)})),[]);
  const addAsset=useCallback(()=>setA(p=>({...p,assets:[...p.assets,{
    ...DEF_ASSET_BASE, name:"Deal "+(p.assets.length+1),
    slips:[{type:"Wet Slip",count:50,rate:500,occ:.85}],
    lodging:[], upland:[], capexItems:[],
    startMonth:Math.min(36,(p.assets.length+1)*3+3)}]})),[]);
  const removeAsset=useCallback((i)=>setA(p=>({...p,assets:p.assets.filter((_,j)=>j!==i)})),[]);

  const setHire=useCallback((i,k,v)=>setA(p=>({...p,hires:p.hires.map((x,j)=>j===i?{...x,[k]:v}:x)})),[]);
  const addHire=useCallback(()=>setA(p=>({...p,hires:[...p.hires,{role:"New Hire",salary:75000,start:12,alloc:1.00}]})),[]);
  const removeHire=useCallback((i)=>setA(p=>({...p,hires:p.hires.filter((_,j)=>j!==i)})),[]);

  const setOhead=useCallback((i,k,v)=>{
    setA(p=>({...p,overhead:p.overhead.map((x,j)=>j===i?{...x,[k]:v}:x)}));
    if(k!=="scope"){
      setA(prev=>{ if(prev.overhead[i]?.scope==="global") propagateGlobal("overhead",i,k,v); return prev; });
    }
  },[propagateGlobal]);
  const addOhead=useCallback(()=>setA(p=>({...p,overhead:[...p.overhead,
    {label:"New Line Item",annual:10000,start:1,rampMo:3,growth:.02,ramps:false,scope:"scenario"}]})),[]);
  const removeOhead=useCallback((i)=>setA(p=>({...p,overhead:p.overhead.filter((_,j)=>j!==i)})),[]);

  const setPartnerSal=useCallback((i,k,v)=>setA(p=>({...p,partnerSalaries:p.partnerSalaries.map((x,j)=>j===i?{...x,[k]:v}:x)})),[]);

  const setOneTime=useCallback((i,k,v)=>{
    setA(p=>({...p,oneTime:p.oneTime.map((x,j)=>j===i?{...x,[k]:v}:x)}));
    if(k!=="scope"){
      setA(prev=>{ if(prev.oneTime[i]?.scope==="global") propagateGlobal("oneTime",i,k,v); return prev; });
    }
  },[propagateGlobal]);
  const addOneTime=useCallback(()=>setA(p=>({...p,oneTime:[...p.oneTime,
    {label:"New Expense",amount:5000,month:1,category:"Other",scope:"scenario"}]})),[]);
  const removeOneTime=useCallback((i)=>setA(p=>({...p,oneTime:p.oneTime.filter((_,j)=>j!==i)})),[]);

  const m=useMemo(()=>{try{return run(a);}catch(e){console.error(e);return null;}},[a]);

  return(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'DM Sans',sans-serif",color:C.text}}>
      {/* NAV */}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"0 24px",
        display:"flex",alignItems:"center",justifyContent:"space-between",
        height:56,position:"sticky",top:0,zIndex:100,gap:16,
        boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>

        {/* Logo */}
        <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
          <div style={{width:32,height:32,background:C.navy,borderRadius:6,
            display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <span style={{fontSize:12,fontWeight:900,color:"#FFFFFF",fontFamily:"'DM Sans',sans-serif"}}>F1</span>
          </div>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:C.text,letterSpacing:"0.01em",lineHeight:1.2,fontFamily:"'DM Sans',sans-serif"}}>GP Fund I</div>
            <div style={{fontSize:10,color:C.textDim,letterSpacing:"0.08em",textTransform:"uppercase",lineHeight:1}}>LP Model</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:0,flex:1,justifyContent:"center",overflowX:"auto",
          scrollbarWidth:"none",msOverflowStyle:"none"}}>
          {TABS.map(t=>{
            const active=tab===t;
            return(
              <button key={t} onClick={()=>setTab(t)} style={{
                display:"flex",alignItems:"center",justifyContent:"center",
                padding:"8px 16px",cursor:"pointer",border:"none",
                borderBottom:active?`2px solid ${C.gold}`:"2px solid transparent",
                borderTop:"2px solid transparent",
                background:"transparent",
                minWidth:72,whiteSpace:"nowrap",flexShrink:0,transition:"background .15s"}}>
                <span style={{fontSize:11,fontWeight:active?700:500,letterSpacing:"0.04em",
                  textTransform:"uppercase",color:active?C.navy:C.textDim,lineHeight:1,
                  fontFamily:"'DM Sans',sans-serif"}}>
                  {t}
                </span>
              </button>
            );
          })}
        </div>

        {/* Badge */}
        <div style={{flexShrink:0,fontSize:9,color:C.textFaint,
          letterSpacing:"0.06em",textTransform:"uppercase",textAlign:"right",lineHeight:1.6}}>
          CONFIDENTIAL<br/>DRAFT
        </div>
      </div>

      {/* SCENARIO BAR */}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,
        padding:"0 24px",display:"flex",alignItems:"center",gap:8,height:38,position:"sticky",top:56,zIndex:99}}>
        <span style={{fontSize:9,color:C.textFaint,textTransform:"uppercase",letterSpacing:".1em",flexShrink:0,fontWeight:600}}>Scenario:</span>
        {editingName
          ? <input autoFocus value={scenName} onChange={e=>setScenName(e.target.value)}
              onBlur={()=>setEditingName(false)} onKeyDown={e=>e.key==="Enter"&&setEditingName(false)}
              style={{background:"transparent",border:"none",borderBottom:`1px solid ${C.accent}`,
                color:C.text,fontSize:12,fontWeight:700,outline:"none",width:140,padding:"1px 0"}}/>
          : <span onClick={()=>setEditingName(true)} style={{fontSize:12,fontWeight:700,color:C.text,
              cursor:"pointer",borderBottom:`1px dashed ${C.borderDark}`,paddingBottom:1,minWidth:80}}>
              {scenName}
            </span>
        }
        <button onClick={saveScenario} style={{background:C.accent,color:"#FFFFFF",border:"none",
          borderRadius:6,padding:"4px 12px",fontSize:10,fontWeight:700,letterSpacing:".04em",
          textTransform:"uppercase",cursor:"pointer",flexShrink:0}}>Save</button>
        <div style={{position:"relative"}}>
          <button onClick={()=>setShowScen(v=>!v)} style={{background:"transparent",
            color:C.textDim,border:`1px solid ${C.border}`,borderRadius:6,
            padding:"4px 12px",fontSize:10,fontWeight:600,letterSpacing:".04em",
            textTransform:"uppercase",cursor:"pointer",flexShrink:0}}>
            Load ▾ {Object.keys(scenarios).length>0&&`(${Object.keys(scenarios).length})`}
          </button>
          {showScen&&(
            <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,
              background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,
              zIndex:200,minWidth:280,boxShadow:"0 8px 24px rgba(0,0,0,0.08)"}}>
              {Object.keys(scenarios).length===0
                ? <div style={{padding:"12px 14px",color:C.textDim,fontSize:11}}>No saved scenarios yet.</div>
                : Object.entries(scenarios).map(([name,s])=>(
                    <div key={name} style={{display:"flex",alignItems:"center",gap:6,
                      padding:"8px 12px",borderBottom:`1px solid ${C.border}`,
                      background:name===scenName?C.accentDim:"transparent"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:11,fontWeight:600,color:name===scenName?C.accent:C.text,
                          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</div>
                        <div style={{fontSize:9,color:C.textFaint}}>{s._savedAt?new Date(s._savedAt).toLocaleString():""}</div>
                      </div>
                      <button onClick={()=>loadScenario(name)}
                        style={{background:C.accentDim,color:C.accent,border:"none",
                          borderRadius:4,padding:"3px 8px",fontSize:9,fontWeight:600,cursor:"pointer",flexShrink:0}}>Load</button>
                      <button onClick={()=>duplicateScenario(name)}
                        style={{background:C.blueL,color:C.blue,border:"none",
                          borderRadius:4,padding:"3px 8px",fontSize:9,fontWeight:600,cursor:"pointer",flexShrink:0}}>Copy</button>
                      <button onClick={()=>deleteScenario(name)}
                        style={{background:C.redL,color:C.red,border:"none",
                          borderRadius:4,padding:"3px 8px",fontSize:9,fontWeight:600,cursor:"pointer",flexShrink:0}}>✕</button>
                    </div>
                  ))
              }
              <div style={{padding:"8px 12px",borderTop:`1px solid ${C.border}`}}>
                <button onClick={()=>{setA(DEFAULT);setScenName("RDM Base Case");setShowScen(false);}}
                  style={{background:"transparent",color:C.textDim,border:`1px solid ${C.border}`,
                    borderRadius:6,padding:"4px 10px",fontSize:10,cursor:"pointer",width:"100%"}}>
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
                background:name===scenName?C.accentDim:C.surfaceAlt,
                color:name===scenName?C.accent:C.textDim,
                border:`1px solid ${name===scenName?C.accent:C.border}`,
                borderRadius:6,padding:"3px 10px",fontSize:10,fontWeight:600,
                cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{display:"flex"}}>
        {/* SIDEBAR */}
        <div style={{width:262,flexShrink:0,background:C.surfaceAlt,
          borderRight:`1px solid ${C.border}`,padding:"18px 14px",
          height:"calc(100vh - 52px)",overflowY:"auto",position:"sticky",top:52}}>

          <SHdr t="Fund Structure"/>
          <Sli label="Exit Cap Rate"  value={a.exitCapRate}  min={.055} max={.12}  step={.005} disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>set("exitCapRate",v)}  sub="All exits"/>
          <Sli label="Interest Rate"  value={a.interestRate} min={.04}  max={.10}  step={.005} disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>set("interestRate",v)}/>
          <Sli label="LTV (Debt %)"   value={a.debtPct}      min={.40}  max={.75}  step={.05}  disp={v=>`${(v*100).toFixed(0)}%`} onChange={v=>set("debtPct",v)}/>
          <Sli label="Hold Period"    value={a.fundTerm}     min={5}    max={10}   step={1}    disp={v=>`${v} yrs`}               onChange={v=>set("fundTerm",v)}/>

          <div style={{height:1,background:C.border,margin:"12px 0"}}/>
          <SHdr t="Waterfall & Carry"/>
          <Sli label="Carried Int."   value={a.carry}        min={.10}  max={.30}  step={.025}  disp={v=>`${(v*100).toFixed(0)}%`} onChange={v=>set("carry",v)}/>
          <Sli label="Preferred Ret." value={a.prefReturn}   min={.05}  max={.10}  step={.005}  disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>set("prefReturn",v)}/>
          {/* Pref type toggle */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:".07em",marginBottom:5,fontWeight:600,fontFamily:"'JetBrains Mono',monospace"}}>Pref Type</div>
            <div style={{display:"flex",gap:4}}>
              {[["Simple","false"],["Compound","true"]].map(([lbl,val])=>{
                const active=String(a.compoundPref)===val;
                return(<button key={lbl} onClick={()=>set("compoundPref",val==="true")}
                  style={{flex:1,padding:"5px 0",fontSize:9,fontWeight:700,letterSpacing:".06em",
                    textTransform:"uppercase",cursor:"pointer",borderRadius:6,
                    background:active?C.navy:"transparent",color:active?"#FFFFFF":C.textDim,
                    border:`1px solid ${active?C.navy:C.border}`}}>{lbl}</button>);
              })}
            </div>
            <div style={{fontSize:8,color:C.textFaint,marginTop:3}}>
              {a.compoundPref?"Compound: capital*(1+r)^n":"Simple: capital*rate*years"}
            </div>
          </div>
          {/* Catch-up toggle */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:".07em",marginBottom:5,fontWeight:600,fontFamily:"'JetBrains Mono',monospace"}}>GP Catch-Up</div>
            <div style={{display:"flex",gap:4}}>
              {[["None","false"],["Full","true"]].map(([lbl,val])=>{
                const active=String(a.catchUp)===val;
                return(<button key={lbl} onClick={()=>set("catchUp",val==="true")}
                  style={{flex:1,padding:"5px 0",fontSize:9,fontWeight:700,letterSpacing:".06em",
                    textTransform:"uppercase",cursor:"pointer",borderRadius:6,
                    background:active?C.navy:"transparent",color:active?"#FFFFFF":C.textDim,
                    border:`1px solid ${active?C.navy:C.border}`}}>{lbl}</button>);
              })}
            </div>
            <div style={{fontSize:8,color:C.textFaint,marginTop:3}}>
              {a.catchUp?"GP catches up to carry% then splits":"GP takes carry% above pref"}
            </div>
          </div>
          <Sli label="GP Commitment"  value={a.gpPct}        min={0}    max={.05}  step={.005}  disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>set("gpPct",v)}/>
          <Sli label="Sale Costs"     value={a.saleCosts}    min={.01}  max={.04}  step={.005}  disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>set("saleCosts",v)}/>

          <div style={{height:1,background:C.border,margin:"12px 0"}}/>
          <SHdr t="G&A Globals"/>
          <Sli label="Benefits Rate"  value={a.benefitsRate} min={.15}  max={.30}  step={.01}  disp={v=>`${(v*100).toFixed(0)}%`} onChange={v=>set("benefitsRate",v)}/>
          <Sli label="Salary Growth"  value={a.salaryGrowth} min={.01}  max={.06}  step={.005} disp={v=>`${(v*100).toFixed(1)}%`} onChange={v=>set("salaryGrowth",v)}/>
          <Sli label="# of Partners"  value={a.partners}     min={1}    max={5}    step={1}    disp={v=>`${v}`}                   onChange={v=>set("partners",v)}/>

          {m&&(
            <div style={{marginTop:10,padding:"12px",background:C.surface,
              borderRadius:8,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:9,color:C.navy,textTransform:"uppercase",letterSpacing:".1em",marginBottom:5,fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>Live Output</div>
              <div style={{fontSize:11,color:C.textDim,lineHeight:1.9,fontFamily:"'JetBrains Mono',monospace"}}>
                <div>LP IRR: <span style={{color:m.lpIRR>a.prefReturn?C.green:"#F87171",fontWeight:700}}>{f.p(m.lpIRR)}</span></div>
                <div>LP MOIC: <span style={{color:C.gold,fontWeight:700}}>{f.x(m.lpMOIC)}</span></div>
                <div>GP Promote: <span style={{color:C.gold,fontWeight:700}}>{f.$(m.gpPromote)}</span></div>
                <div>GP Net 7yr: <span style={{color:m.gpNetTotal>0?C.green:"#F87171",fontWeight:700}}>{f.$(m.gpNetTotal)}</span></div>
              </div>
            </div>
          )}
        </div>

        {/* MAIN CONTENT */}
        <div style={{flex:1,padding:"24px 32px",overflowY:"auto",minHeight:"calc(100vh - 52px)",background:C.bg}}>
          {m&&tab==="Overview"    && <TabOverview    m={m} a={a}/>}
          {m&&tab==="Deals"       && <TabAssets      m={m} a={a} setAsset={setAsset} addAsset={addAsset} removeAsset={removeAsset}/>}
          {m&&tab==="Waterfall"   && <TabWaterfall   m={m} a={a}/>}
          {m&&tab==="Fund CF"     && <TabFundCF      m={m} a={a}/>}
          {m&&tab==="G&A Model"   && <TabGA          m={m} a={a} setHire={setHire} addHire={addHire} removeHire={removeHire} setOhead={setOhead} addOhead={addOhead} removeOhead={removeOhead} setPartnerSal={setPartnerSal} setOneTime={setOneTime} addOneTime={addOneTime} removeOneTime={removeOneTime}/>}
          {m&&tab==="GP Partners" && <TabGPPartners  m={m} a={a}/>}
          {m&&tab==="Sensitivity" && <TabSensitivity m={m} a={a}/>}
          {tab==="Targets" && <TabTargets a={a} setA={setA}/>}
        </div>
      </div>
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
      </div>
      <div style={{height:1,background:C.border,margin:"14px 0"}}/>
      <div style={{fontSize:9,color:C.gold,letterSpacing:".12em",textTransform:"uppercase",marginBottom:7,fontWeight:700}}>GP Economics</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:22}}>
        <KPI label="GP Promote"   value={f.$(m.gpPromote)}    sub={`${f.p(a.carry)} carry above pref`} gold/>
        <KPI label="Total G&A"    value={f.$(m.totGA)}        sub="Fund overhead (7-yr)"/>
        <KPI label="Per Partner"  value={f.$(m.promPP)}       sub={`1 of ${a.partners} partners`}/>
        <KPI label="GP Net 7-yr"  value={f.$(m.gpNetTotal)}   sub="After co-invest"/>
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
// DEALS
// ═══════════════════════════════════════════════════════════════════════════════
function TabAssets({m,a,setAsset,addAsset,removeAsset}){
  const [sel, setSel] = useState(0);
  const [view, setView] = useState("detail"); // detail | table
  const [section, setSection] = useState("overview"); // overview | revenue | bwfees | capex
  const asset = a.assets[sel]||{};
  const r = m.assetR[sel]||{};

  // Per-asset chart data
  const noiData = r.noi ? r.noi.map((n,y)=>({year:`Y${y}`,noi:Math.round(n)})).slice(1) : [];
  const cfData = r.noi ? r.noi.slice(1).map((n,y)=>{
    const bw = r.bwAnn?.[y+1]||0;
    return {year:`Y${y+1}`, noi:Math.round(n), debtService:Math.round(-r.annDS), bwFee:Math.round(-bw),
      netCF:Math.round(n-r.annDS-bw)};
  }) : [];

  const dealColors = ["#2563EB","#7C3AED","#EA580C","#059669","#DB2777","#D97706","#0891B2","#4F46E5"];

  // Portfolio totals — use computed assetR (includes capex, tx costs, debt)
  const totAcqPrice = a.assets.reduce((s,x)=>s+x.price,0);
  const totCost = m.assetR.reduce((s,x)=>s+x.price+(x.totalCapex||0)+(x.txCosts||0),0);
  const totExitVal = m.assetR.reduce((s,x)=>s+(x.exitVal||0),0);
  const wtdCap = a.assets.reduce((s,x)=>s+x.cap*x.price,0)/totAcqPrice;
  const totEq = m.assetR.reduce((s,x)=>s+(x.totalEquityIn||0),0);
  const totDebt = m.assetR.reduce((s,x)=>s+(x.totalDebt||0),0);
  const avgIRR = m.assetR.reduce((s,x)=>s+(x.irr||0),0)/m.assetR.length;
  const avgMOIC = m.assetR.reduce((s,x)=>s+(x.moic||0),0)/m.assetR.length;
  const totBWFee = m.assetR.reduce((s,x)=>s+(x.totBWFee||0),0);

  // Inline slider helper for the assumptions sections
  const DealSlider = ({label,k,min,max,step,disp,color=C.accent})=>{
    const val = asset[k]!=null?asset[k]:0;
    const pct = Math.min(100,Math.max(0,((val-min)/(max-min))*100));
    return(
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <span style={{fontSize:10,color:C.textDim,fontWeight:600}}>{label}</span>
          <span style={{fontSize:12,color,fontWeight:700}}>{disp(val)}</span>
        </div>
        <div style={{position:"relative",height:5,background:C.border,borderRadius:4}}>
          <div style={{position:"absolute",left:0,width:`${pct}%`,height:"100%",background:color,borderRadius:4}}/>
          <div style={{position:"absolute",left:`calc(${pct}% - 6px)`,top:-4,width:12,height:12,borderRadius:"50%",
            background:color,boxShadow:"0 1px 3px rgba(0,0,0,0.2)",pointerEvents:"none"}}/>
          <input type="range" min={min} max={max} step={step} value={val}
            onChange={e=>setAsset(sel,k,Number(e.target.value))}
            style={{position:"absolute",top:-8,left:0,width:"100%",height:22,opacity:0,cursor:"pointer",margin:0,padding:0}}/>
        </div>
      </div>
    );
  };

  // Inline number input for fixed fees
  const FeeInput = ({label,k,color=C.cyan})=>(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
      padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
      <span style={{fontSize:11,color:C.textDim}}>{label}</span>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <span style={{fontSize:10,color:C.textFaint}}>$</span>
        <input type="number" value={asset[k]||0} onChange={e=>setAsset(sel,k,Number(e.target.value))}
          style={{width:70,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,
            padding:"4px 8px",fontSize:11,color,fontWeight:600,textAlign:"right",outline:"none"}}/>
        <span style={{fontSize:9,color:C.textFaint}}>/yr</span>
      </div>
    </div>
  );

  return(
    <div>
      <PHdr title="Deal Underwriting" sub={`${a.assets.length} deals · ${f.$(totCost)} total cost basis · ${f.$(totExitVal)} exit valuation (Y${a.fundTerm} NOI @ ${f.p(a.exitCapRate)} cap)`}/>

      {/* Portfolio KPI Strip */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:8,marginBottom:22}}>
        {[
          {label:"Total Cost Basis", value:f.$(totCost),    accent:C.accent},
          {label:"Exit Valuation",   value:f.$(totExitVal), accent:C.green},
          {label:"Wtd Avg Cap",      value:f.p(wtdCap),     accent:C.purple},
          {label:"Total Equity",     value:f.$(totEq),      accent:C.cyan},
          {label:"Total Debt",       value:f.$(totDebt),    accent:C.orange},
          {label:"Avg Deal IRR",     value:f.p(avgIRR),     accent:"#059669"},
          {label:"Avg MOIC",         value:f.x(avgMOIC),    accent:C.gold},
        ].map(({label,value,accent})=>(
          <div key={label} style={{
            background:C.surface,border:`1px solid ${C.border}`,
            borderTop:`3px solid ${accent}`,
            borderRadius:10,padding:"14px 16px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",
          }}>
            <div style={{fontSize:9,letterSpacing:"0.08em",textTransform:"uppercase",
              color:C.textFaint,marginBottom:6,fontWeight:600}}>{label}</div>
            <div style={{fontSize:20,fontWeight:700,color:C.text,
              fontFamily:"'Inter',sans-serif",lineHeight:1.1}}>{value}</div>
          </div>
        ))}
      </div>

      {/* View Toggle */}
      <div style={{display:"flex",gap:2,marginBottom:18,background:C.surfaceAlt,
        borderRadius:8,padding:3,width:"fit-content",border:`1px solid ${C.border}`}}>
        {[["detail","Deal Detail"],["table","Comparison Table"]].map(([v,l])=>(
          <button key={v} onClick={()=>setView(v)} style={{
            background:view===v?C.surface:"transparent",
            color:view===v?C.text:C.textFaint,
            border:"none",borderRadius:6,padding:"7px 20px",fontSize:11,fontWeight:600,
            cursor:"pointer",boxShadow:view===v?"0 1px 2px rgba(0,0,0,0.06)":"none"}}>
            {l}
          </button>
        ))}
      </div>

      {/* DETAIL VIEW */}
      {view==="detail" && (
        <div style={{display:"grid",gridTemplateColumns:"230px 1fr",gap:18}}>

          {/* Left: Deal List */}
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {a.assets.map((ast,idx)=>{
              const ar = m.assetR[idx];
              const isActive = idx===sel;
              const col = dealColors[idx%dealColors.length];
              return(
                <button key={idx} onClick={()=>setSel(idx)} style={{
                  background:isActive?C.surface:C.surfaceAlt,
                  border:isActive?`1px solid ${C.accent}`:`1px solid ${C.border}`,
                  borderLeft:isActive?`3px solid ${col}`:`3px solid transparent`,
                  borderRadius:10,padding:"12px 14px",cursor:"pointer",textAlign:"left",
                  boxShadow:isActive?"0 2px 6px rgba(37,99,235,0.1)":"none",
                }}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={{fontSize:12,fontWeight:700,color:isActive?C.text:C.textDim}}>{ast.name}</span>
                    <span style={{fontSize:10,color:col,fontWeight:700}}>{f.p(ar?.irr)}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:10}}>
                    <span style={{color:C.textFaint}}>{f.$(ast.price)}</span>
                    <span style={{color:C.textFaint}}>{f.x(ar?.moic)}</span>
                  </div>
                </button>
              );
            })}
            <button onClick={addAsset} style={{
              background:"transparent",border:`1px dashed ${C.borderDark}`,
              borderRadius:10,padding:"10px",cursor:"pointer",
              color:C.textFaint,fontSize:11,fontWeight:600,marginTop:4,
            }}>+ Add Deal</button>
          </div>

          {/* Right: Deal Detail Panel */}
          <div>
            {/* Deal Header */}
            <Card style={{marginBottom:16,padding:"18px 22px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                    <div style={{width:4,height:28,borderRadius:2,background:dealColors[sel%dealColors.length]}}/>
                    <input value={asset.name||""} onChange={e=>setAsset(sel,"name",e.target.value)}
                      style={{background:"transparent",border:"none",color:C.text,fontSize:20,fontWeight:800,
                        outline:"none",fontFamily:"'Inter',sans-serif",width:220}}/>
                    {/* Revenue mode toggle */}
                    <div style={{display:"flex",gap:2,background:C.surfaceAlt,borderRadius:6,padding:2,border:`1px solid ${C.border}`}}>
                      {[["topdown","Top-Down"],["bottomup","Bottom-Up"]].map(([v,l])=>(
                        <button key={v} onClick={()=>setAsset(sel,"revenueMode",v)} style={{
                          background:asset.revenueMode===v?C.surface:"transparent",
                          color:asset.revenueMode===v?C.accent:C.textFaint,border:"none",borderRadius:4,
                          padding:"3px 10px",fontSize:9,fontWeight:600,cursor:"pointer",
                          boxShadow:asset.revenueMode===v?"0 1px 2px rgba(0,0,0,0.06)":"none"}}>{l}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,marginLeft:14,flexWrap:"wrap"}}>
                    {[
                      {l:`IRR ${f.p(r.irr)}`,bg:C.greenL,c:C.green},
                      {l:`MOIC ${f.x(r.moic)}`,bg:C.accentDim,c:C.accent},
                      {l:`Equity ${f.$(r.eq)}`,bg:C.blueL,c:C.blue},
                      {l:`Base NOI ${f.$(r.baseNOI)}`,bg:"rgba(8,145,178,0.08)",c:C.cyan},
                      {l:`BW Fees ${f.$(r.totBWFee)}/7yr`,bg:"rgba(217,119,6,0.08)",c:C.gold},
                    ].map(({l,bg,c})=>(
                      <span key={l} style={{background:bg,color:c,padding:"4px 12px",borderRadius:20,fontSize:10,fontWeight:700}}>{l}</span>
                    ))}
                  </div>
                </div>
                {a.assets.length>1&&(
                  <button onClick={()=>{removeAsset(sel);setSel(Math.max(0,sel-1));}}
                    style={{background:C.redL,border:`1px solid rgba(220,38,38,0.2)`,color:C.red,
                      borderRadius:6,padding:"5px 12px",fontSize:10,fontWeight:600,cursor:"pointer"}}>Remove</button>
                )}
              </div>
            </Card>

            {/* Metric Cards */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:16}}>
              {[
                {label:"Exit Value",       value:f.$(r.exitVal), accent:C.green},
                {label:"Net Proceeds",     value:f.$(r.saleNet), accent:C.cyan},
                {label:"Annual Debt Svc",  value:f.$(r.annDS),   accent:C.orange},
                {label:"Loan Balance",     value:f.$(r.lb),      accent:C.purple},
                {label:"7yr BW Fees",      value:f.$(r.totBWFee),accent:C.gold},
                {label:"Tx Costs",          value:f.$(r.txCosts), accent:C.red},
              ].map(({label,value,accent})=>(
                <div key={label} style={{background:C.surface,border:`1px solid ${C.border}`,
                  borderRadius:10,padding:"10px 12px",borderLeft:`3px solid ${accent}`,
                  boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                  <div style={{fontSize:8,letterSpacing:"0.08em",textTransform:"uppercase",
                    color:C.textFaint,marginBottom:4,fontWeight:600}}>{label}</div>
                  <div style={{fontSize:15,fontWeight:700,color:C.text}}>{value}</div>
                </div>
              ))}
            </div>

            {/* Section Tabs */}
            <div style={{display:"flex",gap:2,marginBottom:16,background:C.surfaceAlt,
              borderRadius:8,padding:3,border:`1px solid ${C.border}`}}>
              {[["overview","Acquisition"],["revenue","Revenue"],["opex","OpEx"],["bwfees","BW Fees"],["noi","NOI Analysis"],["capex","CapEx"]].map(([v,l])=>(
                <button key={v} onClick={()=>setSection(v)} style={{
                  background:section===v?C.surface:"transparent",color:section===v?C.text:C.textFaint,
                  border:"none",borderRadius:6,padding:"6px 16px",fontSize:10,fontWeight:600,
                  cursor:"pointer",boxShadow:section===v?"0 1px 2px rgba(0,0,0,0.06)":"none",flex:1}}>{l}</button>
              ))}
            </div>

            {/* ── ACQUISITION SECTION ── */}
            {section==="overview" && (
              <Card style={{marginBottom:16}}>
                <CT c="Acquisition Assumptions"/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"16px 24px",marginBottom:16}}>
                  <DealSlider label="Acquisition Price" k="price" min={2e6} max={60e6} step={5e5} disp={v=>`$${(v/1e6).toFixed(1)}M`} color={C.accent}/>
                  <DealSlider label="Going-In Cap Rate" k="cap" min={.04} max={.14} step={.005} disp={v=>`${(v*100).toFixed(1)}%`} color={C.purple}/>
                  <DealSlider label="Close Month" k="startMonth" min={1} max={72} step={1} disp={v=>`Month ${v}`} color={C.orange}/>
                  <DealSlider label="I/O Period" k="ioPeriod" min={0} max={36} step={3} disp={v=>`${v} mo`} color={C.cyan}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"16px 28px"}}>
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <span style={{fontSize:10,color:C.textDim,fontWeight:600}}>Transaction / Closing Costs</span>
                      <span style={{fontSize:12,color:C.red,fontWeight:700}}>{f.$(asset.txCosts||0)}</span>
                    </div>
                    <input type="number" value={asset.txCosts||0}
                      onChange={e=>setAsset(sel,"txCosts",Number(e.target.value))}
                      style={{width:"100%",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:6,
                        padding:"7px 10px",fontSize:12,color:C.text,fontWeight:600,outline:"none"}}/>
                    <div style={{fontSize:9,color:C.textFaint,marginTop:3}}>Legal, title, survey, due diligence, lender fees — added to day-1 equity requirement</div>
                  </div>
                  <div style={{padding:"10px 14px",background:C.surfaceAlt,borderRadius:8,border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:9,color:C.textFaint,textTransform:"uppercase",letterSpacing:".06em",marginBottom:6,fontWeight:600}}>Total Equity Required</div>
                    <div style={{fontSize:18,fontWeight:700,color:C.text}}>{f.$(r.totalEquityIn)}</div>
                    <div style={{fontSize:9,color:C.textFaint,marginTop:3}}>
                      Acq Equity {f.$(r.eq)} + CapEx Equity {f.$(Object.values(r.capexEqByYear||{}).reduce((s,v)=>s+v,0))} + Tx {f.$(r.txCosts)}
                    </div>
                    <div style={{fontSize:9,color:C.textFaint,marginTop:2}}>
                      Total Debt: {f.$(r.totalDebt)} (Acq {f.$(r.debt)} + CapEx {f.$(Object.values(r.capexDebtByYear||{}).reduce((s,v)=>s+v,0))})
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {/* ── REVENUE DETAIL SECTION ── */}
            {section==="revenue" && (
              <Card style={{marginBottom:16}}>
                <CT c="Revenue Components"/>
                <div style={{fontSize:10,color:C.textDim,marginBottom:14,padding:"8px 12px",background:C.surfaceAlt,borderRadius:6}}>
                  {asset.revenueMode==="bottomup"
                    ? "Bottom-up mode — NOI driven by unit economics below"
                    : "Top-down mode — these are informational. Switch to Bottom-Up to drive NOI."}
                </div>

                {/* ── Slips (dynamic rows) ── */}
                <div style={{marginBottom:18}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,
                    paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>
                    <span style={{fontSize:10,fontWeight:700,color:C.accent,textTransform:"uppercase",letterSpacing:".06em"}}>Slips / Berths</span>
                    <button onClick={()=>{const s=[...(asset.slips||[]),{type:"New Slip Type",count:20,rate:400,occ:.85,period:"y2"}];setAsset(sel,"slips",s);}}
                      style={{background:C.accentDim,color:C.accent,border:"none",borderRadius:5,padding:"3px 10px",fontSize:9,fontWeight:700,cursor:"pointer"}}>+ Add Type</button>
                  </div>
                  {(asset.slips||[]).map((s,si)=>(
                    <div key={si} style={{display:"grid",gridTemplateColumns:"auto 1.3fr 1fr 1fr 1fr auto",gap:8,alignItems:"center",
                      padding:"8px 0",borderBottom:`1px solid ${C.border}`,
                      background:s.period==="y1"?"rgba(37,99,235,0.03)":"transparent"}}>
                      <select value={s.period||"y2"} onChange={e=>{const arr=[...(asset.slips||[])];arr[si]={...arr[si],period:e.target.value};setAsset(sel,"slips",arr);}}
                        style={{background:s.period==="y1"?"rgba(37,99,235,0.1)":C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,
                          padding:"4px 4px",fontSize:9,color:s.period==="y1"?C.orange:C.accent,fontWeight:700,cursor:"pointer",outline:"none",width:42}}>
                        <option value="y1">Y1</option><option value="y2">Y2+</option>
                      </select>
                      <input value={s.type} onChange={e=>{const arr=[...(asset.slips||[])];arr[si]={...arr[si],type:e.target.value};setAsset(sel,"slips",arr);}}
                        style={{background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",fontSize:11,color:C.text,outline:"none",fontWeight:600}}/>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{fontSize:9,color:C.textFaint}}>Qty</span>
                        <input type="number" value={s.count} onChange={e=>{const arr=[...(asset.slips||[])];arr[si]={...arr[si],count:Number(e.target.value)};setAsset(sel,"slips",arr);}}
                          style={{width:50,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,padding:"4px 6px",fontSize:11,color:C.accent,fontWeight:700,textAlign:"right",outline:"none"}}/>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{fontSize:9,color:C.textFaint}}>$/mo</span>
                        <input type="number" value={s.rate} onChange={e=>{const arr=[...(asset.slips||[])];arr[si]={...arr[si],rate:Number(e.target.value)};setAsset(sel,"slips",arr);}}
                          style={{width:60,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,padding:"4px 6px",fontSize:11,color:C.green,fontWeight:700,textAlign:"right",outline:"none"}}/>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{fontSize:9,color:C.textFaint}}>Occ</span>
                        <input type="number" value={Math.round(s.occ*100)} min={0} max={100} onChange={e=>{const arr=[...(asset.slips||[])];arr[si]={...arr[si],occ:Number(e.target.value)/100};setAsset(sel,"slips",arr);}}
                          style={{width:42,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,padding:"4px 6px",fontSize:11,color:C.cyan,fontWeight:700,textAlign:"right",outline:"none"}}/>
                        <span style={{fontSize:9,color:C.textFaint}}>%</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:10,color:C.green,fontWeight:600,minWidth:55,textAlign:"right"}}>{f.$(s.count*s.rate*12*s.occ)}</span>
                        <button onClick={()=>{const arr=(asset.slips||[]).filter((_,j)=>j!==si);setAsset(sel,"slips",arr);}}
                          style={{background:C.redL,border:"none",color:C.red,borderRadius:4,padding:"2px 6px",fontSize:9,cursor:"pointer"}}>✕</button>
                      </div>
                    </div>
                  ))}
                  {(asset.slips||[]).length>0&&(
                    <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",fontSize:11}}>
                      <div style={{display:"flex",gap:12}}>
                        <span style={{color:C.orange}}>Y1: {f.$((asset.slips||[]).filter(r=>r.period==="y1").reduce((s,r)=>s+r.count*r.rate*12*r.occ,0))}</span>
                        <span style={{color:C.accent}}>Y2+: {f.$((asset.slips||[]).filter(r=>r.period!=="y1").reduce((s,r)=>s+r.count*r.rate*12*r.occ,0))}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Lodging (dynamic rows) ── */}
                <div style={{marginBottom:18}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,
                    paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>
                    <span style={{fontSize:10,fontWeight:700,color:C.orange,textTransform:"uppercase",letterSpacing:".06em"}}>Hotel / Lodging</span>
                    <button onClick={()=>{const l=[...(asset.lodging||[]),{type:"New Room Type",units:5,adr:200,occ:.70,period:"y2"}];setAsset(sel,"lodging",l);}}
                      style={{background:"rgba(234,88,12,0.08)",color:C.orange,border:"none",borderRadius:5,padding:"3px 10px",fontSize:9,fontWeight:700,cursor:"pointer"}}>+ Add Type</button>
                  </div>
                  {(asset.lodging||[]).map((l,li)=>(
                    <div key={li} style={{display:"grid",gridTemplateColumns:"auto 1.3fr 1fr 1fr 1fr auto",gap:8,alignItems:"center",
                      padding:"8px 0",borderBottom:`1px solid ${C.border}`,
                      background:l.period==="y1"?"rgba(234,88,12,0.03)":"transparent"}}>
                      <select value={l.period||"y2"} onChange={e=>{const arr=[...(asset.lodging||[])];arr[li]={...arr[li],period:e.target.value};setAsset(sel,"lodging",arr);}}
                        style={{background:l.period==="y1"?"rgba(234,88,12,0.1)":C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,
                          padding:"4px 4px",fontSize:9,color:l.period==="y1"?C.orange:C.accent,fontWeight:700,cursor:"pointer",outline:"none",width:42}}>
                        <option value="y1">Y1</option><option value="y2">Y2+</option>
                      </select>
                      <input value={l.type} onChange={e=>{const arr=[...(asset.lodging||[])];arr[li]={...arr[li],type:e.target.value};setAsset(sel,"lodging",arr);}}
                        style={{background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",fontSize:11,color:C.text,outline:"none",fontWeight:600}}/>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{fontSize:9,color:C.textFaint}}>Units</span>
                        <input type="number" value={l.units} onChange={e=>{const arr=[...(asset.lodging||[])];arr[li]={...arr[li],units:Number(e.target.value)};setAsset(sel,"lodging",arr);}}
                          style={{width:42,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,padding:"4px 6px",fontSize:11,color:C.orange,fontWeight:700,textAlign:"right",outline:"none"}}/>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{fontSize:9,color:C.textFaint}}>ADR</span>
                        <input type="number" value={l.adr} onChange={e=>{const arr=[...(asset.lodging||[])];arr[li]={...arr[li],adr:Number(e.target.value)};setAsset(sel,"lodging",arr);}}
                          style={{width:55,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,padding:"4px 6px",fontSize:11,color:C.green,fontWeight:700,textAlign:"right",outline:"none"}}/>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{fontSize:9,color:C.textFaint}}>Occ%</span>
                        <input type="number" value={Math.round(l.occ*100)} min={0} max={100} onChange={e=>{const arr=[...(asset.lodging||[])];arr[li]={...arr[li],occ:Number(e.target.value)/100};setAsset(sel,"lodging",arr);}}
                          style={{width:42,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,padding:"4px 6px",fontSize:11,color:C.cyan,fontWeight:700,textAlign:"right",outline:"none"}}/>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:10,color:C.green,fontWeight:600,minWidth:55,textAlign:"right"}}>{f.$(l.units*l.adr*365*l.occ)}</span>
                        <button onClick={()=>{const arr=(asset.lodging||[]).filter((_,j)=>j!==li);setAsset(sel,"lodging",arr);}}
                          style={{background:C.redL,border:"none",color:C.red,borderRadius:4,padding:"2px 6px",fontSize:9,cursor:"pointer"}}>✕</button>
                      </div>
                    </div>
                  ))}
                  {(asset.lodging||[]).length>0&&(
                    <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",fontSize:11}}>
                      <div style={{display:"flex",gap:12}}>
                        <span style={{color:C.orange}}>Y1: {f.$((asset.lodging||[]).filter(r=>r.period==="y1").reduce((s,r)=>s+r.units*r.adr*365*r.occ,0))}</span>
                        <span style={{color:C.accent}}>Y2+: {f.$((asset.lodging||[]).filter(r=>r.period!=="y1").reduce((s,r)=>s+r.units*r.adr*365*r.occ,0))}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Fuel ── */}
                <div style={{marginBottom:18}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.gold,textTransform:"uppercase",letterSpacing:".06em",marginBottom:10,
                    paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>Fuel Operations</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"12px 24px"}}>
                    <DealSlider label="Annual Gallons" k="fuelGallons" min={0} max={1000000} step={10000} disp={v=>v>=1e6?`${(v/1e6).toFixed(1)}M`:`${(v/1000).toFixed(0)}K`} color={C.gold}/>
                    <DealSlider label="Margin / Gallon" k="fuelMargin" min={0} max={1.50} step={.05} disp={v=>`$${v.toFixed(2)}`} color={C.green}/>
                    <div style={{fontSize:11,color:C.textFaint,alignSelf:"end",paddingBottom:2}}>
                      Profit: <span style={{color:C.green,fontWeight:700}}>{f.$((asset.fuelGallons||0)*(asset.fuelMargin||0))}/yr</span>
                    </div>
                  </div>
                </div>

                {/* ── Upland Tenants (dynamic rows) ── */}
                <div style={{marginBottom:18}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,
                    paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>
                    <span style={{fontSize:10,fontWeight:700,color:C.cyan,textTransform:"uppercase",letterSpacing:".06em"}}>Upland Tenants</span>
                    <button onClick={()=>{const u=[...(asset.upland||[]),{name:"New Tenant",rent:2000}];setAsset(sel,"upland",u);}}
                      style={{background:"rgba(8,145,178,0.08)",color:C.cyan,border:"none",borderRadius:5,padding:"3px 10px",fontSize:9,fontWeight:700,cursor:"pointer"}}>+ Add Tenant</button>
                  </div>
                  {(asset.upland||[]).map((u,ui)=>(
                    <div key={ui} style={{display:"grid",gridTemplateColumns:"2fr 1fr auto",gap:8,alignItems:"center",
                      padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>
                      <input value={u.name} onChange={e=>{const arr=[...(asset.upland||[])];arr[ui]={...arr[ui],name:e.target.value};setAsset(sel,"upland",arr);}}
                        style={{background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",fontSize:11,color:C.text,outline:"none",fontWeight:600}}/>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{fontSize:9,color:C.textFaint}}>$/mo</span>
                        <input type="number" value={u.rent} onChange={e=>{const arr=[...(asset.upland||[])];arr[ui]={...arr[ui],rent:Number(e.target.value)};setAsset(sel,"upland",arr);}}
                          style={{width:65,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,padding:"4px 6px",fontSize:11,color:C.cyan,fontWeight:700,textAlign:"right",outline:"none"}}/>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:10,color:C.green,fontWeight:600}}>{f.$(u.rent*12)}/yr</span>
                        <button onClick={()=>{const arr=(asset.upland||[]).filter((_,j)=>j!==ui);setAsset(sel,"upland",arr);}}
                          style={{background:C.redL,border:"none",color:C.red,borderRadius:4,padding:"2px 6px",fontSize:9,cursor:"pointer"}}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Other Income + NOI Plug */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px 24px",marginBottom:12}}>
                  <DealSlider label="Other Annual Income" k="otherIncome" min={0} max={500000} step={5000} disp={v=>f.$(v)} color={C.green}/>
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <span style={{fontSize:10,color:C.textDim,fontWeight:600}}>NOI Override (Plug)</span>
                      <span style={{fontSize:9,color:C.textFaint}}>{asset.noiPlug?"Active":"Off"}</span>
                    </div>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <input type="number" value={asset.noiPlug||""} placeholder="Leave blank for computed"
                        onChange={e=>setAsset(sel,"noiPlug",e.target.value?Number(e.target.value):null)}
                        style={{flex:1,background:C.surfaceAlt,border:`1px solid ${asset.noiPlug?C.orange:C.border}`,borderRadius:5,
                          padding:"6px 10px",fontSize:11,color:C.orange,fontWeight:700,outline:"none"}}/>
                      {asset.noiPlug&&<button onClick={()=>setAsset(sel,"noiPlug",null)}
                        style={{background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.textFaint,borderRadius:5,
                          padding:"4px 8px",fontSize:9,cursor:"pointer"}}>Clear</button>}
                    </div>
                    <div style={{fontSize:9,color:C.textFaint,marginTop:3}}>Overrides both top-down and bottom-up NOI</div>
                  </div>
                </div>

                {/* Revenue Summary */}
                {r.buRev && (
                  <div style={{marginTop:12,padding:"12px 14px",background:C.surfaceAlt,borderRadius:8,border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:10,fontWeight:700,color:C.text,marginBottom:8}}>Revenue Summary (Annual)</div>
                    <div style={{fontSize:11}}>
                      {[
                        {l:"Slips / Berths",c:C.accent,v:r.buRev.slipRev},
                        {l:"Lodging",c:C.orange,v:r.buRev.lodgingRev},
                        {l:"Fuel",c:C.gold,v:r.buRev.fuel},
                        {l:"Upland Tenants",c:C.cyan,v:r.buRev.uplandRev},
                        {l:"Other",c:C.textDim,v:r.buRev.other},
                      ].filter(x=>x.v>0).map(({l,c,v})=>(
                        <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${C.border}`}}>
                          <span style={{color:c,fontWeight:600}}>{l}</span>
                          <span style={{color:C.text,fontWeight:600}}>{f.$(v)}</span>
                        </div>
                      ))}
                      <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",
                        borderTop:`2px solid ${C.borderDark}`,marginTop:4}}>
                        <span style={{color:C.text,fontWeight:700}}>Total Bottom-Up Revenue</span>
                        <span style={{color:C.green,fontWeight:700,fontSize:14}}>{f.$(r.buRev.total)}</span>
                      </div>
                      {asset.noiPlug&&(
                        <div style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}>
                          <span style={{color:C.orange,fontWeight:700}}>NOI Override Active</span>
                          <span style={{color:C.orange,fontWeight:700}}>{f.$(asset.noiPlug)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* ── BW FEES SECTION ── */}
            {section==="bwfees" && (
              <Card style={{marginBottom:16}}>
                <CT c="Bluewater Management Fee Structure"/>
                <div style={{fontSize:10,color:C.textDim,marginBottom:14,padding:"8px 12px",background:C.surfaceAlt,borderRadius:6}}>
                  Fixed fees are annual amounts. Revenue management is a % of NOI.
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 28px"}}>
                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:C.text,marginBottom:8}}>Fixed Annual Fees</div>
                    <FeeInput label="Marketing" k="bwMarketing"/>
                    <FeeInput label="Accounting" k="bwAccounting"/>
                    <FeeInput label="IT / Technology" k="bwIT"/>
                    <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0",
                      borderTop:`2px solid ${C.borderDark}`,marginTop:4}}>
                      <span style={{fontSize:11,fontWeight:700,color:C.text}}>Total Fixed</span>
                      <span style={{fontSize:11,fontWeight:700,color:C.cyan}}>{f.$((asset.bwMarketing||0)+(asset.bwAccounting||0)+(asset.bwIT||0))}/yr</span>
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:C.text,marginBottom:8}}>Revenue-Based Fee</div>
                    <DealSlider label="Rev Mgmt Fee %" k="bwRevMgmt" min={0} max={.10} step={.005}
                      disp={v=>`${(v*100).toFixed(1)}%`} color={C.gold}/>
                    <div style={{fontSize:10,color:C.textFaint,marginTop:8}}>
                      Y1 Rev Mgmt: <span style={{color:C.gold,fontWeight:700}}>{f.$(r.baseNOI*(asset.bwRevMgmt||0))}</span>
                    </div>
                    <div style={{marginTop:16,padding:"12px 14px",background:C.surfaceAlt,borderRadius:8}}>
                      <div style={{fontSize:10,fontWeight:700,color:C.text,marginBottom:6}}>7-Year BW Fee Total</div>
                      <div style={{fontSize:20,fontWeight:700,color:C.cyan}}>{f.$(r.totBWFee)}</div>
                      <div style={{fontSize:9,color:C.textFaint,marginTop:4}}>
                        Fixed: {f.$((((asset.bwMarketing||0)+(asset.bwAccounting||0)+(asset.bwIT||0))*a.fundTerm))} + Rev Mgmt: {f.$(r.totBWFee-((asset.bwMarketing||0)+(asset.bwAccounting||0)+(asset.bwIT||0))*a.fundTerm)}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {/* ── OPEX SECTION ── */}
            {section==="opex" && (
              <Card style={{marginBottom:16}}>
                <CT c="Operating Expenses"/>
                <div style={{fontSize:10,color:C.textDim,marginBottom:14,padding:"8px 12px",background:C.surfaceAlt,borderRadius:6}}>
                  Annual recurring property-level expenses. In bottom-up mode, NOI = Gross Revenue − OpEx. Each line can have its own annual growth rate.
                </div>

                {/* Header row */}
                <div style={{display:"grid",gridTemplateColumns:"2.5fr 1fr 1fr 1fr auto",gap:8,padding:"6px 0",
                  borderBottom:`1px solid ${C.borderDark}`,marginBottom:4}}>
                  <span style={{fontSize:9,color:C.textFaint,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em"}}>Expense</span>
                  <span style={{fontSize:9,color:C.textFaint,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}>Annual $</span>
                  <span style={{fontSize:9,color:C.textFaint,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}>Growth/yr</span>
                  <span style={{fontSize:9,color:C.textFaint,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}>Y7 Cost</span>
                  <span/>
                </div>

                {(asset.opex||[]).length===0&&(
                  <div style={{fontSize:10,color:C.textFaint,padding:"12px 0"}}>No expenses added. Click "+ Add Expense" below.</div>
                )}

                {(asset.opex||[]).map((o,oi)=>{
                  const y7 = o.amount*Math.pow(1+(o.growth||0),a.fundTerm-1);
                  return(
                    <div key={oi} style={{display:"grid",gridTemplateColumns:"2.5fr 1fr 1fr 1fr auto",gap:8,alignItems:"center",
                      padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>
                      <input value={o.label} onChange={e=>{const arr=[...(asset.opex||[])];arr[oi]={...arr[oi],label:e.target.value};setAsset(sel,"opex",arr);}}
                        style={{background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",fontSize:11,color:C.text,outline:"none",fontWeight:600}}/>
                      <input type="number" value={o.amount} onChange={e=>{const arr=[...(asset.opex||[])];arr[oi]={...arr[oi],amount:Number(e.target.value)};setAsset(sel,"opex",arr);}}
                        style={{width:"100%",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,padding:"4px 6px",fontSize:11,color:C.red,fontWeight:700,textAlign:"right",outline:"none"}}/>
                      <div style={{display:"flex",alignItems:"center",gap:3,justifyContent:"flex-end"}}>
                        <input type="number" value={((o.growth||0)*100).toFixed(1)} step="0.5"
                          onChange={e=>{const arr=[...(asset.opex||[])];arr[oi]={...arr[oi],growth:Number(e.target.value)/100};setAsset(sel,"opex",arr);}}
                          style={{width:48,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,padding:"4px 4px",fontSize:11,color:C.orange,fontWeight:700,textAlign:"right",outline:"none"}}/>
                        <span style={{fontSize:9,color:C.textFaint}}>%</span>
                      </div>
                      <span style={{fontSize:11,color:C.textDim,textAlign:"right"}}>{f.$(y7)}</span>
                      <button onClick={()=>{const arr=(asset.opex||[]).filter((_,j)=>j!==oi);setAsset(sel,"opex",arr);}}
                        style={{background:C.redL,border:"none",color:C.red,borderRadius:4,padding:"2px 6px",fontSize:9,cursor:"pointer"}}>✕</button>
                    </div>
                  );
                })}

                {(asset.opex||[]).length>0&&(
                  <div style={{display:"grid",gridTemplateColumns:"2.5fr 1fr 1fr 1fr auto",gap:8,padding:"8px 0",
                    borderTop:`2px solid ${C.borderDark}`,marginTop:4}}>
                    <span style={{fontSize:11,fontWeight:700,color:C.text}}>Total OpEx</span>
                    <span style={{fontSize:11,fontWeight:700,color:C.red,textAlign:"right"}}>{f.$((asset.opex||[]).reduce((s,o)=>s+o.amount,0))}</span>
                    <span/>
                    <span style={{fontSize:11,fontWeight:700,color:C.red,textAlign:"right"}}>{f.$((asset.opex||[]).reduce((s,o)=>s+o.amount*Math.pow(1+(o.growth||0),a.fundTerm-1),0))}</span>
                    <span/>
                  </div>
                )}

                <button onClick={()=>{const arr=[...(asset.opex||[]),{label:"New Expense",amount:10000,growth:.02}];setAsset(sel,"opex",arr);}}
                  style={{marginTop:8,background:C.redL,color:C.red,border:`1px dashed rgba(220,38,38,0.3)`,
                    borderRadius:6,padding:"8px",width:"100%",fontSize:10,fontWeight:600,cursor:"pointer"}}>+ Add Expense</button>

                {/* Quick-add common expenses */}
                <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:8}}>
                  {[
                    {label:"Property Taxes",amount:80000,growth:.02},
                    {label:"Insurance",amount:40000,growth:.03},
                    {label:"Utilities",amount:30000,growth:.02},
                    {label:"R&M / Maintenance",amount:45000,growth:.02},
                    {label:"On-Site Payroll",amount:150000,growth:.03},
                    {label:"Landscaping",amount:12000,growth:.02},
                    {label:"Security",amount:18000,growth:.02},
                    {label:"Waste / Sanitation",amount:8000,growth:.02},
                  ].filter(q=>!(asset.opex||[]).some(o=>o.label===q.label)).map(q=>(
                    <button key={q.label} onClick={()=>{const arr=[...(asset.opex||[]),q];setAsset(sel,"opex",arr);}}
                      style={{background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:20,padding:"3px 10px",
                        fontSize:9,color:C.textDim,cursor:"pointer",fontWeight:500}}>+ {q.label}</button>
                  ))}
                </div>
              </Card>
            )}

            {/* ── NOI ANALYSIS SECTION ── */}
            {section==="noi" && (
              <Card style={{marginBottom:16}}>
                <CT c="NOI Analysis"/>

                {/* NOI Build-Up */}
                <div style={{padding:"14px 16px",background:C.surfaceAlt,borderRadius:8,border:`1px solid ${C.border}`,marginBottom:16}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.text,marginBottom:10}}>Year 1 NOI Build-Up</div>
                  <div style={{fontSize:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.border}`}}>
                      <span style={{color:C.textDim}}>Gross Revenue {asset.revenueMode==="bottomup"?"(Bottom-Up)":"(Cap Rate Implied)"}</span>
                      <span style={{color:C.green,fontWeight:700}}>{f.$(r.grossRev)}</span>
                    </div>
                    {(asset.opex||[]).map((o,oi)=>(
                      <div key={oi} style={{display:"flex",justifyContent:"space-between",padding:"4px 0 4px 16px",borderBottom:`1px solid ${C.border}`}}>
                        <span style={{color:C.textFaint,fontSize:11}}>− {o.label}</span>
                        <span style={{color:C.red,fontWeight:600,fontSize:11}}>({f.$(o.amount)})</span>
                      </div>
                    ))}
                    {(asset.opex||[]).length>0&&(
                      <div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.border}`}}>
                        <span style={{color:C.textDim}}>Total OpEx</span>
                        <span style={{color:C.red,fontWeight:700}}>({f.$(r.y1Opex)})</span>
                      </div>
                    )}
                    <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",
                      borderTop:`2px solid ${C.borderDark}`,marginTop:4}}>
                      <span style={{color:C.text,fontWeight:700,fontSize:14}}>Net Operating Income (Y1)</span>
                      <span style={{color:C.accent,fontWeight:700,fontSize:14}}>{f.$(r.baseNOI)}</span>
                    </div>
                    {asset.noiPlug&&(
                      <div style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}>
                        <span style={{color:C.orange,fontWeight:600,fontSize:11}}>NOI Override Active</span>
                        <span style={{color:C.orange,fontWeight:700}}>{f.$(asset.noiPlug)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Y1 NOI Adjustment */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"16px 28px",marginBottom:18}}>
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <span style={{fontSize:10,color:C.textDim,fontWeight:600}}>Y1 NOI (Plug Override)</span>
                    </div>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <input type="number" value={asset.noiPlug||""} placeholder={`${f.$(r.baseNOI)} computed`}
                        onChange={e=>setAsset(sel,"noiPlug",e.target.value?Number(e.target.value):null)}
                        style={{flex:1,background:C.surfaceAlt,border:`1px solid ${asset.noiPlug?C.orange:C.border}`,borderRadius:5,
                          padding:"7px 10px",fontSize:12,color:asset.noiPlug?C.orange:C.textDim,fontWeight:700,outline:"none"}}/>
                      {asset.noiPlug&&<button onClick={()=>setAsset(sel,"noiPlug",null)}
                        style={{background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.textFaint,borderRadius:5,
                          padding:"5px 10px",fontSize:9,cursor:"pointer"}}>Clear</button>}
                    </div>
                  </div>
                  <DealSlider label="Y1→Y2 Growth" k="noiY1Growth" min={-.10} max={.20} step={.005}
                    disp={v=>`${(v*100).toFixed(1)}%`} color={C.orange}/>
                  <DealSlider label="Y2+ Annual Growth" k="noiY2Growth" min={.01} max={.12} step={.005}
                    disp={v=>`${(v*100).toFixed(1)}%`} color={C.green}/>
                </div>

                {/* Full NOI Schedule */}
                <div style={{padding:"14px 16px",background:C.surfaceAlt,borderRadius:8,border:`1px solid ${C.border}`}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.text,marginBottom:10}}>NOI Schedule — {a.fundTerm} Year Hold</div>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <thead>
                      <tr style={{borderBottom:`1px solid ${C.borderDark}`}}>
                        {["","NOI","Growth","OpEx (embedded)","BW Fees","Net CF (pre-debt)"].map(h=>(
                          <th key={h} style={{padding:"5px 8px",fontSize:9,color:C.textFaint,fontWeight:700,
                            textTransform:"uppercase",letterSpacing:".06em",textAlign:h===""?"left":"right"}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {r.noi && r.noi.slice(1).map((n,y)=>{
                        const opx = r.opexByYear?.[y+1]||0;
                        const bw = r.bwAnn?.[y+1]||0;
                        const netCF = n - bw; // opex already embedded in NOI
                        const yoyGrowth = y>0 ? n/r.noi[y]-1 : null;
                        return(
                          <tr key={y} style={{borderBottom:`1px solid ${C.border}`,
                            background:y%2===0?"transparent":C.surfaceAlt}}>
                            <td style={{padding:"6px 8px",fontWeight:700,color:C.accent}}>Year {y+1}</td>
                            <td style={{padding:"6px 8px",textAlign:"right",fontWeight:700,color:C.text}}>{f.$(n)}</td>
                            <td style={{padding:"6px 8px",textAlign:"right",color:yoyGrowth!=null?(yoyGrowth>=0?C.green:C.red):C.textFaint,fontWeight:600}}>
                              {yoyGrowth!=null?`${yoyGrowth>=0?"+":""}${(yoyGrowth*100).toFixed(1)}%`:"—"}
                            </td>
                            <td style={{padding:"6px 8px",textAlign:"right",color:C.red}}>{opx>0?`(${f.$(opx)})`:"—"}</td>
                            <td style={{padding:"6px 8px",textAlign:"right",color:C.gold}}>{bw>0?`(${f.$(bw)})`:"—"}</td>
                            <td style={{padding:"6px 8px",textAlign:"right",fontWeight:700,color:netCF>=0?C.green:C.red}}>{f.$(netCF)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* ── CAPEX SECTION ── */}
            {section==="capex" && (
              <Card style={{marginBottom:16}}>
                <CT c="Capital Expenditures"/>

                {/* CapEx Items (dynamic rows) */}
                <div style={{marginBottom:18}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,
                    paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>
                    <span style={{fontSize:10,fontWeight:700,color:C.red,textTransform:"uppercase",letterSpacing:".06em"}}>Capital Expenditures</span>
                    <button onClick={()=>{const c=[...(asset.capexItems||[]),{label:"New CapEx",amount:100000,year:0}];setAsset(sel,"capexItems",c);}}
                      style={{background:C.redL,color:C.red,border:"none",borderRadius:5,padding:"3px 10px",fontSize:9,fontWeight:700,cursor:"pointer"}}>+ Add CapEx</button>
                  </div>
                  {(asset.capexItems||[]).length===0&&(
                    <div style={{fontSize:10,color:C.textFaint,padding:"8px 0"}}>No CapEx items. Click "+ Add CapEx" to add renovation or capital costs.</div>
                  )}
                  {(asset.capexItems||[]).map((c,ci)=>(
                    <div key={ci} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr auto",gap:8,alignItems:"center",
                      padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>
                      <input value={c.label} onChange={e=>{const arr=[...(asset.capexItems||[])];arr[ci]={...arr[ci],label:e.target.value};setAsset(sel,"capexItems",arr);}}
                        style={{background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",fontSize:11,color:C.text,outline:"none",fontWeight:600}}/>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{fontSize:9,color:C.textFaint}}>$</span>
                        <input type="number" value={c.amount} onChange={e=>{const arr=[...(asset.capexItems||[])];arr[ci]={...arr[ci],amount:Number(e.target.value)};setAsset(sel,"capexItems",arr);}}
                          style={{width:75,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,padding:"4px 6px",fontSize:11,color:C.red,fontWeight:700,textAlign:"right",outline:"none"}}/>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{fontSize:9,color:C.textFaint}}>Year</span>
                        <select value={c.year} onChange={e=>{const arr=[...(asset.capexItems||[])];arr[ci]={...arr[ci],year:Number(e.target.value)};setAsset(sel,"capexItems",arr);}}
                          style={{background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:5,padding:"4px 6px",fontSize:11,color:C.text,cursor:"pointer",outline:"none"}}>
                          <option value={0}>Day-1</option>
                          {Array.from({length:a.fundTerm},(_,i)=><option key={i+1} value={i+1}>Year {i+1}</option>)}
                        </select>
                      </div>
                      <button onClick={()=>{const arr=(asset.capexItems||[]).filter((_,j)=>j!==ci);setAsset(sel,"capexItems",arr);}}
                        style={{background:C.redL,border:"none",color:C.red,borderRadius:4,padding:"2px 6px",fontSize:9,cursor:"pointer"}}>✕</button>
                    </div>
                  ))}
                  {(asset.capexItems||[]).length>0&&(
                    <div style={{display:"flex",justifyContent:"flex-end",padding:"8px 0",fontSize:11,borderTop:`1px solid ${C.border}`,marginTop:4}}>
                      <span style={{color:C.textDim}}>Total CapEx: </span>
                      <span style={{color:C.red,fontWeight:700,marginLeft:6}}>{f.$((asset.capexItems||[]).reduce((s,c)=>s+c.amount,0))}</span>
                    </div>
                  )}
                </div>

                {/* CapEx summary by year */}
                {(asset.capexItems||[]).length>0&&(
                  <div style={{padding:"12px 14px",background:C.surfaceAlt,borderRadius:8,border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:10,fontWeight:700,color:C.text,marginBottom:8}}>CapEx by Year</div>
                    <div style={{display:"grid",gridTemplateColumns:`auto repeat(${a.fundTerm},1fr)`,gap:6}}>
                      <div style={{fontSize:9,color:C.textFaint,padding:"4px 8px"}}>Day-1</div>
                      {Array.from({length:a.fundTerm},(_,y)=>(
                        <div key={y} style={{fontSize:9,color:C.textFaint,padding:"4px",textAlign:"center"}}>Y{y+1}</div>
                      ))}
                      <div style={{fontSize:11,fontWeight:700,color:r.capexByYear?.[0]?C.red:C.textFaint,padding:"0 8px"}}>
                        {r.capexByYear?.[0]?f.$(r.capexByYear[0]):"—"}
                      </div>
                      {Array.from({length:a.fundTerm},(_,y)=>(
                        <div key={y} style={{fontSize:11,fontWeight:700,color:r.capexByYear?.[y+1]?C.red:C.textFaint,textAlign:"center"}}>
                          {r.capexByYear?.[y+1]?f.$(r.capexByYear[y+1]):"—"}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* Charts Row */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <Card>
                <CT c="NOI Trajectory"/>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={noiData}>
                    <defs>
                      <linearGradient id={`noi-g-${sel}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.green} stopOpacity={0.2}/>
                        <stop offset="95%" stopColor={C.green} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="year" tick={{fill:C.textFaint,fontSize:9}} axisLine={false} tickLine={false}/>
                    <YAxis tickFormatter={v=>`$${(v/1e6).toFixed(1)}M`} tick={{fill:C.textFaint,fontSize:9}} axisLine={false} tickLine={false} width={48}/>
                    <Tooltip content={<TT/>}/>
                    <Area type="monotone" dataKey="noi" stroke={C.green} strokeWidth={2.5}
                      fill={`url(#noi-g-${sel})`} name="NOI" dot={{fill:C.green,r:3,strokeWidth:0}}/>
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <CT c="Annual Cash Flow Breakdown"/>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={cfData}>
                    <XAxis dataKey="year" tick={{fill:C.textFaint,fontSize:9}} axisLine={false} tickLine={false}/>
                    <YAxis tickFormatter={v=>v>=0?`$${(v/1e6).toFixed(1)}M`:`-$${(Math.abs(v)/1e6).toFixed(1)}M`}
                      tick={{fill:C.textFaint,fontSize:9}} axisLine={false} tickLine={false} width={52}/>
                    <Tooltip content={<TT/>}/>
                    <ReferenceLine y={0} stroke={C.border}/>
                    <Bar dataKey="noi" name="NOI" fill={C.green} radius={[3,3,0,0]} stackId="pos"/>
                    <Bar dataKey="debtService" name="Debt Service" fill={C.red} radius={[0,0,3,3]} stackId="neg"/>
                    <Bar dataKey="bwFee" name="BW Fees" fill={C.gold} radius={[0,0,3,3]} stackId="neg"/>
                  </BarChart>
                </ResponsiveContainer>
                <div style={{display:"flex",gap:14,marginTop:8,justifyContent:"center"}}>
                  {[{l:"NOI",c:C.green},{l:"Debt Svc",c:C.red},{l:"BW Fees",c:C.gold}].map(({l,c})=>(
                    <div key={l} style={{display:"flex",alignItems:"center",gap:5,fontSize:9,color:C.textFaint}}>
                      <div style={{width:8,height:8,borderRadius:2,background:c}}/>{l}
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* TABLE VIEW */}
      {view==="table" && (
        <Card style={{overflow:"hidden",padding:0}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead>
                <tr style={{background:C.surfaceAlt}}>
                  {["Deal","Acq Price","CapEx","Total Cost","Cap","Close","Slips","Hotel","Equity","Debt","Exit Val","IRR","MOIC",""].map(h=>(
                    <th key={h} style={{padding:"8px 10px",color:C.textFaint,fontSize:8,
                      textTransform:"uppercase",letterSpacing:".06em",fontWeight:700,
                      textAlign:h==="Deal"?"left":"center",
                      borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.assets.map((ast,idx)=>{
                  const ar = m.assetR[idx];
                  const col = dealColors[idx%dealColors.length];
                  const dealCost = ast.price + (ar?.totalCapex||0) + (ast.txCosts||0);
                  return(
                    <tr key={idx} onClick={()=>{setSel(idx);setView("detail");}}
                      style={{cursor:"pointer",borderBottom:`1px solid ${C.border}`,
                        background:idx%2===0?"transparent":C.surfaceAlt}}>
                      <td style={{padding:"8px 10px",minWidth:120}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <div style={{width:3,height:20,borderRadius:2,background:col,flexShrink:0}}/>
                          <input value={ast.name} onClick={e=>e.stopPropagation()}
                            onChange={e=>setAsset(idx,"name",e.target.value)}
                            style={{background:"transparent",border:"none",borderBottom:`1px solid transparent`,
                              color:C.text,fontSize:11,fontWeight:600,outline:"none",width:"100%",padding:"2px 0"}}
                            onFocus={e=>{e.target.style.borderBottom=`1px solid ${C.accent}`;}}
                            onBlur={e=>{e.target.style.borderBottom="1px solid transparent";}}/>
                        </div>
                      </td>
                      <td style={{padding:"8px 10px",textAlign:"center",color:C.text,fontSize:11}}>{f.$(ast.price)}</td>
                      <td style={{padding:"8px 10px",textAlign:"center",color:C.red,fontSize:11}}>{f.$(ar?.totalCapex)}</td>
                      <td style={{padding:"8px 10px",textAlign:"center",color:C.text,fontWeight:700,fontSize:11}}>{f.$(dealCost)}</td>
                      <td style={{padding:"8px 10px",textAlign:"center",color:C.purple,fontSize:11}}>{f.p(ast.cap)}</td>
                      <td style={{padding:"8px 10px",textAlign:"center",color:C.orange,fontSize:11}}>M{ast.startMonth}</td>
                      <td style={{padding:"8px 10px",textAlign:"center",color:C.accent,fontSize:11}}>{(ast.slips||[]).reduce((s,r)=>s+r.count,0)||"—"}</td>
                      <td style={{padding:"8px 10px",textAlign:"center",color:C.orange,fontSize:11}}>{(ast.lodging||[]).reduce((s,r)=>s+r.units,0)||"—"}</td>
                      <td style={{padding:"8px 10px",textAlign:"center",color:C.cyan,fontSize:11}}>{f.$(ar?.totalEquityIn)}</td>
                      <td style={{padding:"8px 10px",textAlign:"center",color:C.textDim,fontSize:11}}>{f.$(ar?.totalDebt)}</td>
                      <td style={{padding:"8px 10px",textAlign:"center",color:C.green,fontSize:11}}>{f.$(ar?.exitVal)}</td>
                      <td style={{padding:"8px 10px",textAlign:"center"}}>
                        <span style={{background:ar?.irr>=a.prefReturn?C.greenL:C.redL,
                          color:ar?.irr>=a.prefReturn?C.green:C.red,
                          padding:"2px 7px",borderRadius:20,fontSize:10,fontWeight:700}}>
                          {f.p(ar?.irr)}
                        </span>
                      </td>
                      <td style={{padding:"8px 10px",textAlign:"center",color:C.accent,fontWeight:700,fontSize:11}}>{f.x(ar?.moic)}</td>
                      <td style={{padding:"8px 10px",textAlign:"center"}}>
                        {a.assets.length>1&&(
                          <button onClick={e=>{e.stopPropagation();removeAsset(idx);if(sel>=a.assets.length-1)setSel(Math.max(0,sel-1));}}
                            style={{background:C.redL,border:"none",
                              color:C.red,borderRadius:5,padding:"2px 6px",fontSize:9,cursor:"pointer"}}>✕</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{borderTop:`2px solid ${C.borderDark}`,background:C.surfaceAlt}}>
                  <td style={{padding:"8px 10px",color:C.accent,fontWeight:700}}>Portfolio Total</td>
                  <td style={{padding:"8px 10px",textAlign:"center",color:C.accent,fontWeight:700}}>{f.$(totAcqPrice)}</td>
                  <td style={{padding:"8px 10px",textAlign:"center",color:C.red,fontWeight:700}}>{f.$(m.assetR.reduce((s,x)=>s+(x.totalCapex||0),0))}</td>
                  <td style={{padding:"8px 10px",textAlign:"center",color:C.accent,fontWeight:700}}>{f.$(totCost)}</td>
                  <td style={{padding:"8px 10px",textAlign:"center",color:C.purple,fontWeight:700}}>{f.p(wtdCap)}</td>
                  <td/>
                  <td style={{padding:"8px 10px",textAlign:"center",color:C.accent,fontWeight:700}}>{a.assets.reduce((s,x)=>s+(x.slips||[]).reduce((t,r)=>t+r.count,0),0)}</td>
                  <td style={{padding:"8px 10px",textAlign:"center",color:C.orange,fontWeight:700}}>{a.assets.reduce((s,x)=>s+(x.lodging||[]).reduce((t,r)=>t+r.units,0),0)||"—"}</td>
                  <td style={{padding:"8px 10px",textAlign:"center",color:C.cyan,fontWeight:700}}>{f.$(totEq)}</td>
                  <td style={{padding:"8px 10px",textAlign:"center",color:C.textDim,fontWeight:700}}>{f.$(totDebt)}</td>
                  <td style={{padding:"8px 10px",textAlign:"center",color:C.green,fontWeight:700}}>{f.$(totExitVal)}</td>
                  <td style={{padding:"8px 10px",textAlign:"center"}}>
                    <span style={{background:C.greenL,color:C.green,padding:"2px 7px",borderRadius:20,fontSize:10,fontWeight:700}}>{f.p(avgIRR)}</span>
                  </td>
                  <td style={{padding:"8px 10px",textAlign:"center",color:C.accent,fontWeight:700}}>{f.x(avgMOIC)}</td>
                  <td/>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{padding:"12px 16px",borderTop:`1px solid ${C.border}`}}>
            <button onClick={addAsset} style={{
              background:"transparent",border:`1px dashed ${C.borderDark}`,
              borderRadius:6,padding:"8px 18px",cursor:"pointer",
              color:C.textFaint,fontSize:10,fontWeight:600}}>+ Add Deal</button>
          </div>
        </Card>
      )}

      {/* Deal IRR Comparison */}
      <Card style={{marginTop:18}}>
        <CT c="Deal IRR Comparison"/>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={m.assetR.map((ar,i)=>({name:ar.name,irr:ar.irr,idx:i}))} layout="vertical"
            margin={{left:10,right:20,top:0,bottom:0}}>
            <XAxis type="number" tickFormatter={v=>`${(v*100).toFixed(0)}%`}
              tick={{fill:C.textFaint,fontSize:9}} axisLine={false} tickLine={false}/>
            <YAxis type="category" dataKey="name" width={70}
              tick={{fill:C.textDim,fontSize:9}} axisLine={false} tickLine={false}/>
            <Tooltip content={<TT/>} formatter={v=>`${(v*100).toFixed(1)}%`}/>
            <ReferenceLine x={a.prefReturn} stroke={C.gold} strokeDasharray="4 4"
              label={{value:`${(a.prefReturn*100)}% Pref`,fill:C.gold,fontSize:9,position:"top"}}/>
            <Bar dataKey="irr" name="IRR" radius={[0,4,4,0]}>
              {m.assetR.map((e,i)=>(
                <Cell key={i} fill={i===sel?dealColors[i%dealColors.length]:
                  e.irr>=a.prefReturn?"rgba(5,150,105,0.35)":"rgba(220,38,38,0.3)"}/>
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WATERFALL
// ═══════════════════════════════════════════════════════════════════════════════
function TabWaterfall({m,a}){
  const tiers=[
    {tier:"Tier 1",label:"Return of Capital",lp:m.lpROC,gp:m.gpROC,color:"#2980B9",
      note:`LP equity + funded G&A shortfall · GP equity co-invest only`},
    {tier:"Tier 2",label:`Preferred Return (${f.p(a.prefReturn)} ${a.compoundPref?"compound":"simple"})`,lp:m.lpPref,gp:0,color:C.mid,note:`LP only · ${a.compoundPref?"compound accrual":"simple interest"}`},
    {tier:"Tier 3",label:`Promote (${f.p(1-a.carry)} LP / ${f.p(a.carry)} GP${a.catchUp?" + catch-up":""})`,lp:m.lpResid,gp:m.gpPromote,color:C.gold,note:a.catchUp?"GP catch-up then residual split":"Residual after pref"},
  ];
  return(
    <div>
      <PHdr title="Distribution Waterfall" sub={`3-tier · ${f.$(m.pool)} total pool · ${f.$(m.totSaleProc)} sale proceeds + ${f.$(m.totOpCF)} op CF`}/>

            {/* LP shortfall explainer */}
      <div style={{background:"rgba(201,168,76,.06)",border:`1px solid rgba(201,168,76,.25)`,
        borderRadius:5,padding:"11px 15px",marginBottom:16,fontSize:11,color:C.whDim}}>
        <span style={{color:C.gold,fontWeight:700}}>How the G&A shortfall works: </span>
        When GP G&A exceeds fee income (AM+PM fees), the gap is funded by the LP as an additional capital contribution.
        G&A shortfall: <span style={{color:C.gold}}>{f.$(m.totGAShortfall)}</span> added to LP basis.
        Total LP capital at risk: <span style={{color:C.gold,fontWeight:700}}>{f.$(m.lpActualCapital)}</span> (equity{" "}
        <span style={{color:C.whDim}}>{f.$(m.totLPCalled)}</span> + shortfall{" "}
        <span style={{color:C.whDim}}>{f.$(m.totGAShortfall)}</span>).
        LP pref and MOIC calculated on full basis. GP ROC = equity co-invest only.
        {m.totGAShortfall <= 0 && <span style={{color:C.green}}> Fees cover G&A fully — no shortfall.</span>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1.4fr",gap:20}}>
        <div>
          {tiers.map(row=>(
            <div key={row.tier} style={{background:C.whFaint,border:`1px solid ${C.border}`,
              borderRadius:5,padding:"13px 15px",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:9}}>
                <div style={{width:3,height:28,background:row.color,borderRadius:2}}/>
                <div>
                  <div style={{fontSize:9,color:C.gold,textTransform:"uppercase",letterSpacing:".1em"}}>{row.tier}</div>
                  <div style={{fontSize:12,color:C.white,fontWeight:600}}>{row.label}</div>
                  <div style={{fontSize:9,color:C.whDim}}>{row.note}</div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div style={{background:"rgba(41,128,185,.12)",borderRadius:3,padding:"7px 10px"}}>
                  <div style={{fontSize:9,color:"rgba(41,128,185,.7)",textTransform:"uppercase"}}>LP</div>
                  <div style={{fontSize:16,color:"#5DADE2",fontWeight:700,fontFamily:"'DM Serif Display',serif"}}>{f.$(row.lp)}</div>
                </div>
                <div style={{background:"rgba(201,168,76,.08)",borderRadius:3,padding:"7px 10px"}}>
                  <div style={{fontSize:9,color:C.goldDim,textTransform:"uppercase"}}>GP</div>
                  <div style={{fontSize:16,color:C.gold,fontWeight:700,fontFamily:"'DM Serif Display',serif"}}>{f.$(row.gp)}</div>
                </div>
              </div>
            </div>
          ))}
          <div style={{background:C.navy,border:`1px solid ${C.gold}`,borderRadius:8,padding:"13px 15px"}}>
            <div style={{fontSize:9,color:C.gold,textTransform:"uppercase",letterSpacing:".1em",marginBottom:7,fontFamily:"'JetBrains Mono',monospace"}}>Totals</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div>
                <div style={{fontSize:9,color:"rgba(93,173,226,.7)",textTransform:"uppercase",fontFamily:"'JetBrains Mono',monospace"}}>LP Total</div>
                <div style={{fontSize:19,color:"#5DADE2",fontWeight:700,fontFamily:"'DM Serif Display',serif"}}>{f.$(m.lpTotal)}</div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.55)"}}>MOIC: {f.x(m.lpMOIC)}</div>
              </div>
              <div>
                <div style={{fontSize:9,color:C.gold,textTransform:"uppercase",fontFamily:"'JetBrains Mono',monospace"}}>GP Total</div>
                <div style={{fontSize:19,color:C.gold,fontWeight:700,fontFamily:"'DM Serif Display',serif"}}>{f.$(m.gpFundTotal)}</div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.55)"}}>{f.$(m.gpPromote)} promote</div>
              </div>
            </div>
          </div>
        </div>
        <Card>
          <CT c="Proceeds by Recipient"/>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={m.waterfall} margin={{top:10,right:10,bottom:10,left:10}}>
              <XAxis dataKey="name" tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
              <YAxis tickFormatter={v=>`$${(v/1e6).toFixed(0)}M`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={40}/>
              <Tooltip content={<TT/>}/>
              <Bar dataKey="value" name="Amount" radius={[3,3,0,0]}>
                {m.waterfall.map((e,i)=><Cell key={i} fill={e.fill}/>)}
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

  // Monthly fund CF — built from model monthly data (G&A already deducted from netOpCF)
  const moDetail = (m.monthly||[]).map((x,i)=>{
    const portOpCF = x.netOpCF;  // net of DS + G&A
    return {
      mo: x.mo,
      portOpCF: Math.round(portOpCF),
      ga: Math.round(x.ga),
      lpShare:  Math.round(portOpCF*(1-a.gpPct)),
      gpShare:  Math.round(portOpCF*a.gpPct),
      cumLP:    0,
    };
  });
  let cumLP=0;
  moDetail.forEach(r=>{cumLP+=r.lpShare;r.cumLP=Math.round(cumLP);});

  return(
    <div>
      <PHdr title="Fund Cash Flow" sub="LP capital calls, operating CF, and monthly distribution detail"/>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
        <KPI label="Total LP Called"   value={f.$(m.totLPCalled)} sub="Investment period"/>
        <KPI label="Total Op CF"       value={f.$(m.totOpCF)}     sub="Net of DS + G&A"/>
        <KPI label="Sale Proceeds"     value={f.$(m.totSaleProc)} sub="All exits" gold/>
        <KPI label="Total Pool"        value={f.$(m.pool)}        sub="Available for distribution"/>
      </div>

      <div style={{display:"flex",gap:4,marginBottom:14}}>
        {[["charts","Charts"],["quarterly","Quarterly"],["monthly","Monthly Detail"]].map(([v,l])=>(
          <button key={v} onClick={()=>setView(v)} style={{
            background:view===v?C.gold:"transparent",color:view===v?C.navy:C.goldDim,
            border:`1px solid ${view===v?C.gold:"rgba(201,168,76,.2)"}`,
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
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:14}}>
            {[
              {col:"Portfolio CF",    color:C.green,   desc:"Fund cash flow net of DS + G&A overhead"},
              {col:"LP Distribution", color:"#5DADE2", desc:`LP ${f.p(1-a.gpPct)} share of portfolio cash flow`},
              {col:"GP Distribution", color:C.gold,    desc:`GP ${f.p(a.gpPct)} co-invest share`},
              {col:"LP Called (cumul)", color:C.whDim,  desc:"Cumulative LP capital drawn through end of quarter"},
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
                  const qtrs=[];
                  let cumLP2=0;
                  for(let q=0;q<a.fundTerm*4;q++){
                    const mos=moDetail.slice(q*3,(q+1)*3);
                    const portCF=mos.reduce((s,r)=>s+r.portOpCF,0);
                    const lp=mos.reduce((s,r)=>s+r.lpShare,0);
                    const gp=mos.reduce((s,r)=>s+r.gpShare,0);
                    cumLP2+=lp;
                    const yr=Math.floor(q/4)+1;
                    const qn=(q%4)+1;
                    qtrs.push({label:`Y${yr} Q${qn}`,portCF,lp,gp,cumLP:Math.round(cumLP2)});
                  }
                  return qtrs.map((row,i)=>{
                    const isYrEnd=(i+1)%4===0;
                    return(
                      <tr key={i} style={{
                        borderBottom:isYrEnd?`1px solid rgba(201,168,76,.2)`:"1px solid rgba(255,255,255,.04)",
                        background:isYrEnd?"rgba(201,168,76,.04)":i%2===0?"transparent":"rgba(255,255,255,.015)"}}>
                        <td style={{padding:"5px 10px",color:isYrEnd?C.gold:C.white,
                          fontWeight:isYrEnd?700:400}}>{row.label}</td>
                        <td style={{padding:"5px 10px",textAlign:"right",
                          color:row.portCF>=0?C.green:C.red}}>{f.$(row.portCF)}</td>
                        <td style={{padding:"5px 10px",textAlign:"right",color:"#5DADE2"}}>{f.$(row.lp)}</td>
                        <td style={{padding:"5px 10px",textAlign:"right",color:C.gold}}>{f.$(row.gp)}</td>
                        <td style={{padding:"5px 10px",textAlign:"right",color:C.whDim}}>{f.$(row.cumLP)}</td>
                      </tr>
                    );
                  });
                })()}
                <tr style={{borderTop:`2px solid ${C.border}`,background:"rgba(201,168,76,.06)"}}>
                  <td style={{padding:"7px 10px",color:C.gold,fontWeight:700}}>7-YR TOTAL</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:C.green,fontWeight:700}}>{f.$(m.totOpCF)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:"#5DADE2",fontWeight:700}}>{f.$(m.totOpCF*(1-a.gpPct))}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:C.gold,fontWeight:700}}>{f.$(m.totOpCF*a.gpPct)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:C.whDim,fontWeight:700}}>{f.$(m.lpActualCapital)}</td>
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
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:14}}>
            {[
              {col:"Portfolio Cash Flow", color:C.green,
                desc:"NOI from all properties minus debt service and G&A overhead. Net cash the fund produces each month."},
              {col:"LP Cash Flow", color:"#5DADE2",
                desc:`LP's ${f.p(1-a.gpPct)} share of portfolio cash flow. Running income return distributed to LP investors.`},
              {col:"GP Cash Flow", color:C.gold,
                desc:`GP's ${f.p(a.gpPct)} co-invest share of portfolio cash flow. Return on equity invested alongside LPs.`},
              {col:"Cumul. LP Called", color:C.whDim,
                desc:"Running total of LP capital drawn down. Grows as each asset closes."},
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
                    <td style={{padding:"5px 10px",textAlign:"right",color:"#5DADE2"}}>{f.$(row.lpShare)}</td>
                    <td style={{padding:"5px 10px",textAlign:"right",color:C.gold}}>{f.$(row.gpShare)}</td>
                    <td style={{padding:"5px 10px",textAlign:"right",color:C.whDim}}>{f.$(row.cumLP)}</td>
                  </tr>
                ))}
                <tr style={{borderTop:`2px solid ${C.border}`,background:"rgba(201,168,76,.06)"}}>
                  <td style={{padding:"7px 10px",color:C.gold,fontWeight:700}}>7-YR TOTAL</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:C.green,fontWeight:700}}>{f.$(m.totOpCF)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:"#5DADE2",fontWeight:700}}>{f.$(m.totOpCF*(1-a.gpPct))}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:C.gold,fontWeight:700}}>{f.$(m.totOpCF*a.gpPct)}</td>
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
function TabGA({m,a,setHire,addHire,removeHire,setOhead,addOhead,removeOhead,setPartnerSal,setOneTime,addOneTime,removeOneTime}){
  const [gaView, setGaView] = useState("chart"); // chart | gantt | monthly

  // Build full 84-month G&A detail table with all expense categories
  const monthlyTable = m.gaMonthly.map((x,i)=>({
    mo:         x.mo,
    partnerSal: Math.round(x.partnerSalCost||0),
    staff:      Math.round(x.personnel - (x.partnerSalCost||0)),
    overhead:   Math.round(x.fix),
    oneTime:    Math.round(x.oneTimeHit||0),
    total:      Math.round(x.total),
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
    };
  });

  // Gantt: each hire gets a color band
  const hireColors = ["#2980B9","#1E8449","#C9A84C","#8E44AD","#E74C3C",
    "#16A085","#D35400","#2C3E50","#27AE60","#7F8C8D","#F39C12"];
  const partnerColors = ["#C9A84C","#E8D5A3","#A0845A"];

  return(
    <div>
      <PHdr title="G&A Model" sub="Hire timing, salaries, and overhead — flows directly as fund operating expense"/>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
        <KPI label="Total G&A (7yr)"       value={f.$(m.totGA)}             sub="All-in incl. partner salaries" gold/>
        <KPI label="Partner Salaries (7yr)" value={f.$(m.totPartnerSal)}    sub="Base comp, excl. promote"/>
        <KPI label="Staff & Overhead"       value={f.$(m.totGA-m.totPartnerSal)} sub="Non-partner G&A"/>
        <KPI label="Monthly Avg"            value={f.$(m.totGA/(a.fundTerm*12))} sub="G&A run-rate"/>
      </div>

      {/* View toggle */}
      <div style={{display:"flex",gap:4,marginBottom:14}}>
        {[["chart","Charts"],["gantt","Hire Gantt"],["quarterly","Quarterly CF"],["monthly","Monthly CF"]].map(([v,l])=>(
          <button key={v} onClick={()=>setGaView(v)} style={{
            background:gaView===v?C.gold:"transparent",
            color:gaView===v?C.navy:C.goldDim,
            border:`1px solid ${gaView===v?C.gold:"rgba(201,168,76,.2)"}`,
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
              <CT c="Cumulative G&A — Running Total"/>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={m.gaMonthly.map((x,i)=>{
                  const cumGA=m.gaMonthly.slice(0,i+1).reduce((s,g)=>s+g.total,0);
                  return{mo:x.mo,cumGA:Math.round(cumGA)};
                })}>
                  <defs>
                    <linearGradient id="gcum" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.orange} stopOpacity={.3}/><stop offset="95%" stopColor={C.orange} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="mo" tickFormatter={v=>v%12===0?`M${v}`:""} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
                  <YAxis tickFormatter={v=>`$${(v/1e6).toFixed(1)}M`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={48}/>
                  <Tooltip content={<TT/>}/>
                  <Area type="monotone" dataKey="cumGA" stroke={C.orange} strokeWidth={2} fill="url(#gcum)" name="Cumul. G&A"/>
                </AreaChart>
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
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5,marginBottom:14}}>
            {[
              {col:"Partner Salaries", color:"#E8D5A3", desc:"CEO/COO/CIO base comp + benefits"},
              {col:"Staff G&A",        color:C.blue,    desc:"All hires x salary x benefits allocation %"},
              {col:"Overhead",         color:C.whDim,   desc:"Recurring overhead ramping to full run-rate"},
              {col:"One-Time",         color:"#A569BD", desc:"Setup, build-out, implementation costs"},
              {col:"Total G&A",        color:C.white,   desc:"All expenses combined — flows as fund overhead"},
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
        ];

        const renderRow = (row, key, label, isYrEnd=false, isTotals=false) => (
          <tr key={key} style={{
            borderBottom: isYrEnd?`1px solid rgba(201,168,76,.25)`:"1px solid rgba(255,255,255,.04)",
            background: isTotals?"rgba(201,168,76,.07)":isYrEnd?"rgba(201,168,76,.04)":
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
          </tr>
        );

        const totals = {
          partnerSal: monthlyTable.reduce((s,r)=>s+r.partnerSal,0),
          staff:      monthlyTable.reduce((s,r)=>s+r.staff,0),
          overhead:   monthlyTable.reduce((s,r)=>s+r.overhead,0),
          oneTime:    monthlyTable.reduce((s,r)=>s+r.oneTime,0),
          total:      monthlyTable.reduce((s,r)=>s+r.total,0),
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
              {["Role","Annual Salary","Start Month","7-Yr Total (w/ benefits)"].map(h=>(
                <th key={h} style={{padding:"5px 8px",color:C.goldDim,fontSize:9,textTransform:"uppercase",
                  letterSpacing:".06em",textAlign:h==="Role"?"left":"center"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {a.partnerSalaries.map((p,idx)=>{
              const total7=Array.from({length:84},(_,i)=>{
                if(i+1<p.start)return 0;
                const y=Math.floor(i/12);
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
        <button onClick={addHire} style={{
          width:"100%",padding:"9px",marginTop:8,
          background:"rgba(41,128,185,.06)",border:`1px dashed rgba(41,128,185,.3)`,
          color:"#5DADE2",borderRadius:5,fontSize:10,fontWeight:600,cursor:"pointer"}}>
          + Add Staff Hire
        </button>
      </Card>

      {/* STAFF TABLE */}
      <Card style={{marginBottom:16}}>
        <CT c="Staff Headcount — Hire Timing &amp; Salaries"/>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${C.border}`}}>
              {["Role","Annual Salary","Hire Month","G&A Alloc","7-Yr Cost"].map(h=>(
                <th key={h} style={{padding:"5px 8px",color:C.goldDim,fontSize:9,textTransform:"uppercase",
                  letterSpacing:".06em",textAlign:h==="Role"?"left":"center"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {a.hires.map((h,idx)=>{
              const total7=m.gaMonthly.reduce((s,x,i)=>{
                if(i+1<h.start)return s;
                const y=Math.floor(i/12);
                return s+(h.salary*Math.pow(1+a.salaryGrowth,y)/12)*h.alloc*(1+a.benefitsRate);
              },0);
              return(
                <tr key={idx} style={{borderBottom:"1px solid rgba(255,255,255,.04)",
                  background:idx%2===0?"transparent":"rgba(255,255,255,.015)"}}>
                  <td style={{padding:"7px 8px",color:C.white}}>{h.role}</td>
                  <td style={{padding:"7px 8px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"center"}}>
                      <MiniSlider value={h.salary} min={40000} max={250000} step={5000} onChange={v=>setHire(idx,"salary",v)} color={C.gold} width={75}/>
                      <span style={{color:C.gold,minWidth:56,fontSize:11}}>{f.$(h.salary)}</span>
                    </div>
                  </td>
                  <td style={{padding:"7px 8px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"center"}}>
                      <MiniSlider value={h.start} min={1} max={84} step={1} onChange={v=>setHire(idx,"start",v)} color={C.blue} width={65}/>
                      <span style={{color:"#5DADE2",minWidth:26,fontSize:11}}>M{h.start}</span>
                    </div>
                  </td>
                  <td style={{padding:"7px 8px",color:C.whDim,textAlign:"center"}}>{f.p(h.alloc)}</td>
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
        <button onClick={addHire} style={{
          width:"100%",padding:"9px",marginTop:8,
          background:"rgba(41,128,185,.06)",border:`1px dashed rgba(41,128,185,.3)`,
          color:"#5DADE2",borderRadius:5,fontSize:10,fontWeight:600,cursor:"pointer"}}>
          + Add Staff Hire
        </button>
      </Card>

      {/* OVERHEAD TABLE */}
      <Card style={{marginBottom:16}}>
        <CT c="Recurring Overhead — Budget, Start Month &amp; Ramp-Up Period"/>
        <div style={{fontSize:10,color:C.goldDim,marginBottom:10}}>
          Ramp = months to reach full annual run-rate from start (linear scale). Year 1 expenses build gradually, not full-rate on day 1.
        </div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${C.border}`}}>
              {["Line Item","Full Annual $","Start","Ramp Period","Growth/Yr","Scope","7-Yr Total",""].map(h=>(
                <th key={h} style={{padding:"5px 8px",color:C.goldDim,fontSize:9,textTransform:"uppercase",
                  letterSpacing:".06em",textAlign:h==="Line Item"?"left":"center"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {a.overhead.map((o,idx)=>{
              const total7=Array.from({length:84},(_,i)=>{
                if(i+1<o.start) return 0;
                const yr=Math.floor(i/12);
                let base=o.annual;
                if(o.ramps){const props=a.assets.filter(x=>x.startMonth<=i+1).length;base=props*250*12;}
                const ramp=o.rampMo&&o.rampMo>1?Math.min(1,(i+1-o.start+1)/o.rampMo):1;
                return(base*Math.pow(1+o.growth,yr)/12)*ramp;
              }).reduce((s,v)=>s+v,0);
              // Show what month 1 actually costs vs full run-rate
              const mo1pct=o.rampMo&&o.rampMo>1?Math.min(1,1/o.rampMo):1;
              return(
                <tr key={idx} style={{borderBottom:"1px solid rgba(255,255,255,.04)",
                  background:idx%2===0?"transparent":"rgba(255,255,255,.015)"}}>
                  <td style={{padding:"6px 8px",color:C.white}}>{o.label}</td>
                  <td style={{padding:"6px 8px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:5,justifyContent:"center"}}>
                      <MiniSlider value={o.annual} min={2000} max={200000} step={1000} onChange={v=>setOhead(idx,"annual",v)} color={C.gold} width={70}/>
                      <span style={{color:C.gold,minWidth:52,fontSize:11}}>{f.$(o.annual)}</span>
                    </div>
                  </td>
                  <td style={{padding:"6px 8px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"center"}}>
                      <MiniSlider value={o.start} min={1} max={36} step={1} onChange={v=>setOhead(idx,"start",v)} color={C.blue} width={50}/>
                      <span style={{color:"#5DADE2",minWidth:24,fontSize:11}}>M{o.start}</span>
                    </div>
                  </td>
                  <td style={{padding:"6px 8px"}}>
                    {!o.ramps&&(
                      <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"center"}}>
                        <MiniSlider value={o.rampMo||1} min={1} max={24} step={1} onChange={v=>setOhead(idx,"rampMo",v)} color={"#A569BD"} width={50}/>
                        <span style={{color:"#A569BD",minWidth:40,fontSize:10}}>{o.rampMo||1} mo</span>
                        <span style={{color:C.goldDim,fontSize:9}}>({(mo1pct*100).toFixed(0)}% M1)</span>
                      </div>
                    )}
                    {o.ramps&&<span style={{color:C.goldDim,fontSize:10,display:"block",textAlign:"center"}}>w/ deals</span>}
                  </td>
                  <td style={{padding:"6px 8px",color:C.whDim,textAlign:"center",fontSize:10}}>
                    {o.ramps?"deal-linked":`${(o.growth*100).toFixed(0)}%/yr`}
                  </td>
                  <td style={{padding:"6px 8px",textAlign:"center"}}>
                    <button onClick={()=>setOhead(idx,"scope",o.scope==="global"?"scenario":"global")}
                      title={o.scope==="global"?"Global: change applies to all scenarios":"Scenario: change only affects current scenario"}
                      style={{padding:"2px 7px",borderRadius:3,fontSize:8,fontWeight:700,cursor:"pointer",
                        letterSpacing:".06em",textTransform:"uppercase",
                        background:o.scope==="global"?"rgba(201,168,76,.2)":"rgba(255,255,255,.06)",
                        color:o.scope==="global"?C.gold:C.whDim,
                        border:`1px solid ${o.scope==="global"?"rgba(201,168,76,.4)":"rgba(255,255,255,.1)"}`}}>
                      {o.scope==="global"?"Global":"Scen."}
                    </button>
                  </td>
                  <td style={{padding:"6px 8px",color:C.gold,textAlign:"center",fontWeight:600}}>{f.$(total7)}</td>
                  <td style={{padding:"6px 8px",textAlign:"center"}}>
                    <button onClick={()=>removeOhead(idx)}
                      style={{background:"rgba(192,57,43,.15)",border:`1px solid rgba(192,57,43,.3)`,
                        color:C.red,borderRadius:3,padding:"2px 7px",fontSize:9,cursor:"pointer"}}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <button onClick={addOhead} style={{
        width:"100%",padding:"9px",marginBottom:16,
        background:"rgba(201,168,76,.06)",border:`1px dashed rgba(201,168,76,.25)`,
        color:C.goldDim,borderRadius:5,fontSize:10,fontWeight:600,cursor:"pointer"}}>
        + Add Overhead Line Item
      </button>

      {/* ONE-TIME EXPENSES */}
      <Card>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <CT c="One-Time &amp; Irregular Expenses"/>
          <button onClick={addOneTime} style={{
            background:C.gold,color:C.navy,border:"none",borderRadius:3,
            padding:"4px 12px",fontSize:9,fontWeight:700,letterSpacing:".08em",
            textTransform:"uppercase",cursor:"pointer"}}>+ Add</button>
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
                        background:e.scope==="global"?"rgba(201,168,76,.2)":"rgba(255,255,255,.06)",
                        color:e.scope==="global"?C.gold:C.whDim,
                        border:`1px solid ${e.scope==="global"?"rgba(201,168,76,.4)":"rgba(255,255,255,.1)"}`}}>
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
              <tr style={{borderTop:`1px solid ${C.border}`,background:"rgba(201,168,76,.05)"}}>
                <td style={{padding:"7px 8px",color:C.gold,fontWeight:700,fontSize:11}}>Total One-Time</td>
                <td colSpan={3} style={{padding:"7px 8px",color:C.gold,fontWeight:700,textAlign:"center"}}>
                  {f.$((a.oneTime||[]).reduce((s,e)=>s+e.amount,0))}
                </td>
                <td/>
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

      <div style={{background:"rgba(201,168,76,.06)",border:`1px solid rgba(201,168,76,.2)`,
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
            <tr style={{borderTop:`1px solid ${C.border}`,background:"rgba(201,168,76,.06)"}}>
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
                    const bg=v>.18?"rgba(30,132,73,.25)":v>.14?"rgba(201,168,76,.12)":"rgba(192,57,43,.2)";
                    const clr=v>.18?C.green:v>.14?C.white:C.red;
                    return(
                      <td key={g} style={{padding:"9px 14px",textAlign:"center",fontSize:12,
                        background:isCur?"rgba(201,168,76,.22)":bg,color:clr,fontWeight:isCur?700:500,
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
          {[["rgba(30,132,73,.3)","> 18%"],["rgba(201,168,76,.15)","14–18%"],["rgba(192,57,43,.25)","< 14%"]].map(([bg,l])=>(
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
                      background:isCur?"rgba(201,168,76,.18)":"rgba(255,255,255,.04)",
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

// ═══════════════════════════════════════════════════════════════════════════════
// TARGETS — Marina Database & Deal Pipeline
// ═══════════════════════════════════════════════════════════════════════════════
function parseMarinaRecord(rec){
  const r={id:null,name:"",city:"",state:"",address:"",lat:null,lon:null,
    phone:"",vhf:"",website:"",harbor:"",reviews:0,slips:null,moorings:null,linear_ft:null,
    max_loa:null,approach_depth:null,dock_depth:null,
    has_fuel_dock:false,diesel:null,gas:null,gas_type:null,fuel_updated:null,
    amenities:[],amenity_count:0,about:"",source_url:"",scraped_at:""};
  const url=rec["Origin URL"]||"";r.source_url=url;
  const idM=url.match(/\/marina\/([^_/]+)/);if(idM)r.id=idM[1];
  const stM=url.match(/_([A-Z]{2})_United_States/);if(stM)r.state=stM[1];
  r.scraped_at=rec["Extract Date"]||"";
  const nm=(rec["Name"]||"").split("\n").map(s=>s.trim());
  r.name=nm[0]||"";if(nm.length>=4)r.city=nm[3];
  const revM=(rec["Name"]||"").match(/(\d+)\s+Reviews?/);if(revM)r.reviews=parseInt(revM[1]);
  const det=rec["details"]||"";
  const addrM=det.match(/(?:^|\n)\t?([^\n\t]{2,80})\n\t?([A-Za-z][^\n\t]{2,50},\s*[A-Z]{2}[\s-]+\d{5}(?:-\d{4})?)/);
  if(addrM){const skip=/http|www\.|Last Updated|Edit |Services & Amenities|Contact Marina|Book Reservation/i;
    if(!skip.test(addrM[1]))r.address=`${addrM[1].replace(/^\t/,"")}, ${addrM[2].replace(/^\t/,"")}`;}
  const coordM=det.match(/([\d]+)°\s*([\d]+)'\s*([\d.]+)''\s*,\s*-?([\d]+)°\s*([\d]+)'\s*([\d.]+)''/);
  if(coordM){r.lat=parseFloat(coordM[1])+parseFloat(coordM[2])/60+parseFloat(coordM[3])/3600;
    r.lon=-(parseFloat(coordM[4])+parseFloat(coordM[5])/60+parseFloat(coordM[6])/3600);}
  const phM=det.match(/\t(\+\d{10,12})/);if(phM)r.phone=phM[1];
  const vhfM=det.match(/VHF Ch\.\s*(\d+)/);if(vhfM)r.vhf=`VHF Ch. ${vhfM[1]}`;
  const webM=det.match(/\t(www\.[^\n\t]+)/);if(webM)r.website=webM[1];
  const harbM=det.match(/\t([A-Z][^\n\t]{2,40})\nContact Marina/);if(harbM)r.harbor=harbM[1];
  const loaM=det.match(/Max\.\s*Vessel LOA:([\d.]+)/);if(loaM)r.max_loa=parseFloat(loaM[1]);
  if(det.includes("Services & Amenities")){const flags=det.match(/(\w[\w\s/&]+):Yes/g);
    if(flags)r.amenities=flags.map(f=>f.replace(":Yes","").trim());}
  if(/Fuel Dock:Yes|Gas:Yes|Diesel:Yes/.test(det))r.has_fuel_dock=true;
  const abt=rec["about"]||"";
  const slipsM=abt.match(/Slips:(\d+)/);if(slipsM)r.slips=parseInt(slipsM[1]);
  const moorM=abt.match(/Moorings:(\d+)/);if(moorM)r.moorings=parseInt(moorM[1]);
  const linM=abt.match(/Linear Docks:(\d+)/);if(linM)r.linear_ft=parseInt(linM[1]);
  const apM=abt.match(/Minimum Approach Depth:([\d.]+)/);if(apM&&parseFloat(apM[1])>0)r.approach_depth=parseFloat(apM[1]);
  const dkM=abt.match(/Mean Low Water Dock Depth:([\d.]+)/);if(dkM&&parseFloat(dkM[1])>0)r.dock_depth=parseFloat(dkM[1]);
  let desc=abt.replace(/^(?:Awards\s*\n+)+/,"").replace(/^(?:Is this your Marina\?[\s\S]*?Claim this Marina\s*\n*)+/,"")
    .replace(/^(?:Berth Capacity[\s\S]*?Edit Berth Capacity\s*\n*)+/,"").replace(/^(?:Approach[\s\S]*?Edit Approach\s*\n*)+/,"")
    .replace(/^About\s*\n+/,"").replace(/\s*(?:Berth Capacity|Reviews?\s*\nWrite a Review|Write a Review|No reviews yet)[\s\S]*$/,"")
    .replace(/\n+/g," ").replace(/\s{2,}/g," ").trim();
  if(desc.length<40)desc="";if(desc.length>800)desc=desc.slice(0,800)+"...";r.about=desc;
  const ft=String(rec["fuel"]||"");
  if(ft.startsWith("Fuel\n")){r.has_fuel_dock=true;
    const dM=ft.match(/Diesel\s+\$([\d.]+)/);if(dM)r.diesel=parseFloat(dM[1]);
    const gM=ft.match(/Gas\s+(Regular|Premium|Ethanol Free|Non-Ethanol|E10|E0)?\s*\$([\d.]+)/);
    if(gM){r.gas=parseFloat(gM[2]);r.gas_type=(gM[1]||"Regular").trim();}
    const uM=ft.match(/Last Updated:\s*([^\n]+)/);if(uM)r.fuel_updated=uM[1].trim();}
  r.amenity_count=r.amenities.length;
  if(!r.id)r.id=`m_${Math.random().toString(36).slice(2,10)}`;return r;
}
function parseMarinasJSON(raw){
  // v2 format: { meta:{...}, marinas:[{id,name,city,...}] } — records already clean
  if(raw.marinas&&Array.isArray(raw.marinas)){
    return raw.marinas.filter(r=>r.id);
  }
  // Legacy Browse.ai format: { data:[...] } or raw array
  const data=raw.data||raw;if(!Array.isArray(data))return[];
  const seen=new Set();return data.filter(r=>(r["Status"]||"Successful")==="Successful")
    .map(parseMarinaRecord).filter(r=>{if(!r.id||seen.has(r.id))return false;seen.add(r.id);return true;});
}

function TabTargets({a,setA}){
  const [marinas,setMarinas]=useState(()=>{try{const d=localStorage.getItem("gpfund_marinas");return d?JSON.parse(d):[];}catch{return[];}});
  const [search,setSearch]=useState("");const [stateFilter,setStateFilter]=useState("");
  const [fuelOnly,setFuelOnly]=useState(false);const [slipsOnly,setSlipsOnly]=useState(false);
  const [sortBy,setSortBy]=useState("name");const [page,setPage]=useState(0);
  const [selected,setSelected]=useState(null);const [uploading,setUploading]=useState(false);
  const [uploadMsg,setUploadMsg]=useState("");const PG=50;

  useEffect(()=>{if(marinas.length>0)return;
    fetch("/data/Main.json").then(r=>r.ok?r.json():null).then(raw=>{
      if(raw){const p=parseMarinasJSON(raw);if(p.length>0){setMarinas(p);
        try{localStorage.setItem("gpfund_marinas",JSON.stringify(p));}catch{}}}}).catch(()=>{});},[]);

  const handleUpload=useCallback(async(file)=>{if(!file)return;setUploading(true);setUploadMsg("Parsing...");
    try{const text=await file.text();const raw=JSON.parse(text);const p=parseMarinasJSON(raw);
      setMarinas(p);try{localStorage.setItem("gpfund_marinas",JSON.stringify(p));}catch{}
      try{await fetch(`/api/upload/${encodeURIComponent(file.name)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:text});}catch{}
      setUploadMsg(`Loaded ${p.length.toLocaleString()} marinas`);setPage(0);
    }catch(e){setUploadMsg(`Error: ${e.message}`);}setUploading(false);},[]);

  const filtered=useMemo(()=>{let list=marinas;
    if(search){const s=search.toLowerCase();list=list.filter(m=>(m.name+m.city+m.state+m.address+m.harbor).toLowerCase().includes(s));}
    if(stateFilter)list=list.filter(m=>m.state===stateFilter);
    if(fuelOnly)list=list.filter(m=>m.has_fuel_dock);
    if(slipsOnly)list=list.filter(m=>m.slips!=null&&m.slips>0);
    if(sortBy==="name")list=[...list].sort((a,b)=>a.name.localeCompare(b.name));
    else if(sortBy==="slips")list=[...list].sort((a,b)=>(b.slips||0)-(a.slips||0));
    else if(sortBy==="reviews")list=[...list].sort((a,b)=>b.reviews-a.reviews);
    else if(sortBy==="state")list=[...list].sort((a,b)=>a.state.localeCompare(b.state)||a.name.localeCompare(b.name));
    return list;},[marinas,search,stateFilter,fuelOnly,slipsOnly,sortBy]);

  const paged=filtered.slice(page*PG,(page+1)*PG);const totalPages=Math.ceil(filtered.length/PG);
  const stateCounts=useMemo(()=>{const c={};marinas.forEach(m=>{c[m.state]=(c[m.state]||0)+1;});
    return Object.entries(c).sort((a,b)=>b[1]-a[1]);},[marinas]);

  const addToDeal=useCallback((marina)=>{
    const deal={...DEF_ASSET_BASE,name:marina.name,price:4500000,cap:.075,
      startMonth:Math.min(72,Math.max(1,(a.assets||[]).length*2+1)),
      slips:marina.slips?[{type:"Marina Slips",count:marina.slips,rate:417,occ:.85,period:"y2"}]:[],
      lodging:[{type:"Hotel Units",units:15,adr:325,occ:.247,period:"y1"},{type:"Hotel Units",units:30,adr:325,occ:.411,period:"y2"}],
      upland:[],opex:[{label:"Hotel Operating Costs",amount:219375,growth:.03},{label:"Marina Operating Costs",amount:81250,growth:.05}],
      capexItems:[{label:"Hotel Conversion Ph1",amount:2600000,year:0},{label:"Hotel Conversion Ph2",amount:2600000,year:1}],
      targetSource:{id:marina.id,name:marina.name,city:marina.city,state:marina.state,slips:marina.slips,url:marina.source_url}};
    setA(p=>({...p,assets:[...p.assets,deal]}));setSelected(null);},[a,setA]);
  const isInDeals=useCallback((m)=>(a.assets||[]).some(d=>d.targetSource?.id===m.id),[a]);

  if(marinas.length===0)return(
    <div><PHdr title="Acquisition Targets" sub="Upload your marina database to browse and filter targets"/>
      <Card style={{padding:"48px 32px",textAlign:"center",maxWidth:560,margin:"40px auto"}}>
        <div style={{fontSize:40,marginBottom:16}}>🎯</div>
        <div style={{fontSize:18,fontWeight:700,color:C.text,marginBottom:8}}>Upload Marina Database</div>
        <div style={{fontSize:12,color:C.textDim,marginBottom:24,lineHeight:1.6}}>
          Drop your <strong>Main.json</strong> Browse.ai export here to load 5,500+ marinas across 14 East Coast states.</div>
        <label style={{display:"inline-block",padding:"12px 32px",background:C.accent,color:"#FFF",
          borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer"}}>
          Choose File<input type="file" accept=".json" style={{display:"none"}}
            onChange={e=>{if(e.target.files[0])handleUpload(e.target.files[0]);}}/>
        </label>
        {uploadMsg&&<div style={{marginTop:12,fontSize:12,color:uploading?C.accent:uploadMsg.startsWith("Error")?C.red:C.green,fontWeight:600}}>{uploadMsg}</div>}
      </Card>
    </div>);

  return(<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
      <PHdr title="Acquisition Targets"
        sub={`${marinas.length.toLocaleString()} marinas · ${stateCounts.length} states · ${marinas.filter(m=>m.has_fuel_dock).length.toLocaleString()} fuel docks · ${marinas.filter(m=>m.slips).length.toLocaleString()} with slip data`}/>
      <label style={{padding:"6px 14px",background:C.surfaceAlt,border:`1px solid ${C.border}`,
        borderRadius:6,fontSize:10,fontWeight:600,color:C.textDim,cursor:"pointer",flexShrink:0}}>
        Re-upload<input type="file" accept=".json" style={{display:"none"}}
          onChange={e=>{if(e.target.files[0])handleUpload(e.target.files[0]);}}/>
      </label>
    </div>
    <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
      <input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} placeholder="Search name, city, address..."
        style={{flex:1,minWidth:200,padding:"8px 14px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,fontSize:12,color:C.text,outline:"none"}}/>
      <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
        style={{padding:"8px 12px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,fontSize:11,color:C.text,cursor:"pointer",outline:"none"}}>
        <option value="name">Sort: Name</option><option value="slips">Sort: Most Slips</option>
        <option value="reviews">Sort: Reviews</option><option value="state">Sort: State</option></select>
      <button onClick={()=>{setFuelOnly(!fuelOnly);setPage(0);}} style={{padding:"6px 12px",borderRadius:6,fontSize:10,fontWeight:600,
        cursor:"pointer",background:fuelOnly?C.accentDim:C.surfaceAlt,color:fuelOnly?C.accent:C.textDim,
        border:`1px solid ${fuelOnly?C.accent:C.border}`}}>⛽ Fuel Dock</button>
      <button onClick={()=>{setSlipsOnly(!slipsOnly);setPage(0);}} style={{padding:"6px 12px",borderRadius:6,fontSize:10,fontWeight:600,
        cursor:"pointer",background:slipsOnly?C.accentDim:C.surfaceAlt,color:slipsOnly?C.accent:C.textDim,
        border:`1px solid ${slipsOnly?C.accent:C.border}`}}>⚓ Has Slips</button>
      <span style={{fontSize:11,color:C.textFaint,fontWeight:600}}>{filtered.length.toLocaleString()} results</span>
    </div>
    <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:16}}>
      <button onClick={()=>{setStateFilter("");setPage(0);}} style={{padding:"4px 12px",borderRadius:20,fontSize:10,fontWeight:600,
        cursor:"pointer",background:!stateFilter?C.accent:C.surfaceAlt,color:!stateFilter?"#FFF":C.textDim,
        border:`1px solid ${!stateFilter?C.accent:C.border}`}}>All</button>
      {stateCounts.map(([st,cnt])=>(<button key={st} onClick={()=>{setStateFilter(stateFilter===st?"":st);setPage(0);}}
        style={{padding:"4px 10px",borderRadius:20,fontSize:10,fontWeight:600,cursor:"pointer",
          background:stateFilter===st?C.accent:C.surfaceAlt,color:stateFilter===st?"#FFF":C.textDim,
          border:`1px solid ${stateFilter===st?C.accent:C.border}`}}>{st} ({cnt})</button>))}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:10,marginBottom:16}}>
      {paged.map(m=>{const inD=isInDeals(m);return(
        <div key={m.id} onClick={()=>setSelected(m)} style={{background:C.surface,border:`1px solid ${inD?C.green:C.border}`,
          borderRadius:10,padding:"14px 16px",cursor:"pointer",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",position:"relative"}}>
          {inD&&<div style={{position:"absolute",top:8,right:10,background:C.greenL,color:C.green,
            padding:"2px 8px",borderRadius:12,fontSize:8,fontWeight:700}}>IN DEALS</div>}
          <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:3,overflow:"hidden",
            textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:inD?60:0}}>{m.name}</div>
          <div style={{fontSize:11,color:C.textDim,marginBottom:8}}>{m.city}{m.city&&m.state?", ":""}{m.state}</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
            {m.slips!=null&&<span style={{background:C.accentDim,color:C.accent,padding:"2px 7px",borderRadius:12,fontSize:9,fontWeight:700}}>{m.slips} slips</span>}
            {m.slips==null&&m.linear_ft&&<span style={{background:C.accentDim,color:C.accent,padding:"2px 7px",borderRadius:12,fontSize:9,fontWeight:700}}>{m.linear_ft} ft</span>}
            {m.max_loa&&<span style={{background:C.surfaceAlt,color:C.textDim,padding:"2px 7px",borderRadius:12,fontSize:9,fontWeight:600}}>LOA {m.max_loa}'</span>}
            {m.has_fuel_dock&&<span style={{background:"rgba(8,145,178,0.08)",color:C.cyan,padding:"2px 7px",borderRadius:12,fontSize:9,fontWeight:700}}>
              {m.diesel?`⛽ $${m.diesel.toFixed(2)}`:"⛽ Fuel"}</span>}
            {m.reviews>0&&<span style={{background:C.surfaceAlt,color:C.textFaint,padding:"2px 7px",borderRadius:12,fontSize:9,fontWeight:600}}>★ {m.reviews}</span>}
          </div>
          {m.about&&<div style={{fontSize:10,color:C.textFaint,lineHeight:1.4,overflow:"hidden",
            display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{m.about}</div>}
        </div>);})}
    </div>
    {totalPages>1&&<div style={{display:"flex",justifyContent:"center",gap:6,marginBottom:16,alignItems:"center"}}>
      <button disabled={page===0} onClick={()=>setPage(p=>p-1)} style={{padding:"6px 14px",borderRadius:6,fontSize:11,fontWeight:600,
        border:`1px solid ${C.border}`,background:C.surface,color:C.textDim,cursor:page===0?"default":"pointer",opacity:page===0?.4:1}}>← Prev</button>
      <span style={{fontSize:11,color:C.textDim,minWidth:100,textAlign:"center"}}>Page {page+1} of {totalPages}</span>
      <button disabled={page>=totalPages-1} onClick={()=>setPage(p=>p+1)} style={{padding:"6px 14px",borderRadius:6,fontSize:11,fontWeight:600,
        border:`1px solid ${C.border}`,background:C.surface,color:C.textDim,cursor:page>=totalPages-1?"default":"pointer",opacity:page>=totalPages-1?.4:1}}>Next →</button>
    </div>}
    {selected&&<div onClick={()=>setSelected(null)} style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.12)",zIndex:999}}/>}
    {selected&&(<div style={{position:"fixed",top:0,right:0,bottom:0,width:520,background:C.surface,
      borderLeft:`1px solid ${C.border}`,boxShadow:"-8px 0 32px rgba(0,0,0,0.08)",zIndex:1000,overflowY:"auto",
      padding:"24px 28px",display:"flex",flexDirection:"column"}}>
      <button onClick={()=>setSelected(null)} style={{position:"absolute",top:14,right:14,background:C.surfaceAlt,
        border:`1px solid ${C.border}`,borderRadius:8,width:30,height:30,display:"flex",alignItems:"center",
        justifyContent:"center",fontSize:14,cursor:"pointer",color:C.textDim}}>✕</button>
      <div style={{fontSize:18,fontWeight:700,color:C.text,marginBottom:3,paddingRight:36}}>{selected.name}</div>
      <div style={{fontSize:12,color:C.textDim,marginBottom:16}}>{selected.city}{selected.city&&selected.state?", ":""}{selected.state}
        {selected.harbor&&<span style={{color:C.textFaint}}> · {selected.harbor}</span>}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:16}}>
        {[{l:"Slips",v:selected.slips!=null?selected.slips:(selected.linear_ft?`${selected.linear_ft} ft`:"—")},
          {l:"Moorings",v:selected.moorings||"—"},{l:"Max LOA",v:selected.max_loa?`${selected.max_loa}'`:"—"},
          {l:"Approach",v:selected.approach_depth?`${selected.approach_depth} ft`:"—"},
          {l:"Dock Depth",v:selected.dock_depth?`${selected.dock_depth} ft`:"—"},
          {l:"Reviews",v:selected.reviews||"—"}].map(({l,v})=>(
          <div key={l} style={{background:C.surfaceAlt,borderRadius:8,padding:"8px 10px"}}>
            <div style={{fontSize:8,color:C.textFaint,textTransform:"uppercase",letterSpacing:".06em",fontWeight:700,marginBottom:2}}>{l}</div>
            <div style={{fontSize:13,fontWeight:700,color:C.text}}>{v}</div></div>))}
      </div>
      {selected.has_fuel_dock&&<div style={{background:"rgba(8,145,178,0.05)",border:"1px solid rgba(8,145,178,0.12)",
        borderRadius:8,padding:"10px 12px",marginBottom:14}}>
        <div style={{fontSize:9,fontWeight:700,color:C.cyan,textTransform:"uppercase",marginBottom:4}}>Fuel Dock</div>
        <div style={{fontSize:12,color:C.text}}>
          {selected.diesel&&<span>Diesel: <strong>${selected.diesel.toFixed(2)}/gal</strong></span>}
          {selected.diesel&&selected.gas&&" · "}
          {selected.gas&&<span>{selected.gas_type||"Gas"}: <strong>${selected.gas.toFixed(2)}/gal</strong></span>}
          {!selected.diesel&&!selected.gas&&<span style={{color:C.textDim}}>Fuel available — price not in dataset</span>}
        </div>
        {selected.fuel_updated&&<div style={{fontSize:9,color:C.textFaint,marginTop:2}}>Updated: {selected.fuel_updated}</div>}
      </div>}
      {selected.amenities.length>0&&<div style={{marginBottom:14}}>
        <div style={{fontSize:9,fontWeight:700,color:C.textDim,textTransform:"uppercase",marginBottom:4}}>Amenities ({selected.amenity_count})</div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{selected.amenities.map((am,i)=>(
          <span key={i} style={{background:i<3?C.accentDim:C.surfaceAlt,color:i<3?C.accent:C.textDim,
            padding:"2px 8px",borderRadius:14,fontSize:9,fontWeight:600}}>{am}</span>))}</div></div>}
      {selected.about&&<div style={{marginBottom:14}}>
        <div style={{fontSize:9,fontWeight:700,color:C.textDim,textTransform:"uppercase",marginBottom:4}}>About</div>
        <div style={{fontSize:11,color:C.textDim,lineHeight:1.6}}>{selected.about}</div></div>}
      <div style={{marginBottom:16}}>
        <div style={{fontSize:9,fontWeight:700,color:C.textDim,textTransform:"uppercase",marginBottom:4}}>Contact</div>
        <div style={{fontSize:11,color:C.textDim,lineHeight:1.8}}>
          {selected.address?<div>{selected.address}</div>
            :selected.lat?<div><a href={`https://maps.google.com/?q=${selected.lat},${selected.lon}`} target="_blank" rel="noopener" style={{color:C.accent}}>View on Map</a></div>
            :<div>{selected.city}, {selected.state}</div>}
          {selected.phone&&<div>{selected.phone}</div>}{selected.vhf&&<div>{selected.vhf}</div>}
          {selected.website&&<div><a href={`https://${selected.website}`} target="_blank" rel="noopener" style={{color:C.accent}}>{selected.website}</a></div>}
        </div>
      </div>
      <div style={{marginTop:"auto",position:"sticky",bottom:0,background:C.surface,paddingTop:12,
        borderTop:`1px solid ${C.border}`,display:"flex",gap:8}}>
        {isInDeals(selected)?<div style={{flex:1,padding:"10px",background:C.greenL,color:C.green,borderRadius:8,
          textAlign:"center",fontSize:12,fontWeight:700}}>Already in Deals</div>
          :<button onClick={()=>addToDeal(selected)} style={{flex:1,padding:"10px",background:C.accent,color:"#FFF",
            border:"none",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>Add to Deals</button>}
        <a href={selected.source_url} target="_blank" rel="noopener"
          style={{padding:"10px 14px",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,
            fontSize:10,fontWeight:600,color:C.textDim,textDecoration:"none"}}>Marinas.com ↗</a>
      </div>
    </div>)}
  </div>);
}
