import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, AreaChart, Area, ComposedChart } from "recharts";
import * as XLSX from "xlsx";

const C = {
  // Helm brand palette
  bg:"#FAFAF8",           surface:"#FFFFFF",      surfaceAlt:"#F4F5F7",
  navy:"#0A2342",         navyDim:"rgba(10,35,66,0.06)",
  text:"#1A2E44",         textDim:"#64748B",       textFaint:"#94A3B8",
  accent:"#00D4FF",       accentDim:"rgba(0,212,255,0.12)", accentLight:"rgba(0,212,255,0.08)",
  green:"#059669",        greenL:"rgba(5,150,105,0.08)",
  red:"#DC2626",          redL:"rgba(220,38,38,0.08)",
  orange:"#EA580C",       orangeL:"rgba(234,88,12,0.08)",
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
  txCosts:0,
  ioPeriod:12,    // months of interest-only before amortizing (per deal)
  bwMarketing:50000, bwAccounting:40000, bwIT:35000, bwRevMgmt:.06,
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
      {label:"Deferred Maintenance & R&M",amount:700000,year:0},
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
  // Year 1: fixed fee only ($125K). Year 2+: revMgmt % of REVENUE (no fixed).
  function calcBWFees(a, revAmt, dealYr){
    if(dealYr<=1){
      const fixed=(a.bwMarketing||0)+(a.bwAccounting||0)+(a.bwIT||0);
      return{fixed,revMgmt:0,total:fixed};
    }
    const revMgmt=revAmt*(a.bwRevMgmt||0);
    return{fixed:0,revMgmt,total:revMgmt};
  }

  // ── Asset calcs — each deal has its own hold period based on closing month ──
  const assetR=assets.map(asset=>{
    // Hold period = fund exit - closing month (in whole years, minimum 1)
    const holdMonths = Math.max(1, MO - asset.startMonth + 1);
    const holdYrs = Math.max(1, Math.ceil(holdMonths / 12));

    const ioYrs = Math.ceil((asset.ioPeriod||0)/12);
    const eq=asset.price*(1-debtPct), debt=asset.price*debtPct;
    const ioAnnDS = debt*interestRate;
    const amAnnDS = pmt(interestRate,amortYears,debt);
    const annDS = amAnnDS;

    // CapEx: only include items that deploy within the hold period
    const capexItems = (asset.capexItems||[]).filter(c=>c.year<=holdYrs);
    const capexByYear = {};
    capexItems.forEach(c=>{ capexByYear[c.year]=(capexByYear[c.year]||0)+c.amount; });
    const totalCapex = capexItems.reduce((s,c)=>s+c.amount,0);
    const day1Capex = capexByYear[0]||0;

    // OpEx
    const opexItems = asset.opex||[];
    const y1Opex = opexItems.reduce((s,o)=>s+o.amount, 0);
    const opexByYear = Array.from({length:holdYrs+1},(_,y)=>{
      if(y===0) return 0;
      return opexItems.reduce((s,o)=>s + o.amount*Math.pow(1+(o.growth||0), y-1), 0);
    });

    // Revenue & NOI
    const buRevY1 = calcBottomUpRevenue(asset, "y1");
    const buRevY2 = calcBottomUpRevenue(asset, "y2");
    const buRev = buRevY1;
    let grossRev, baseNOI, grossRevY2, baseNOIY2;
    if(asset.noiPlug!=null && asset.noiPlug>0){
      baseNOI = asset.noiPlug; grossRev = baseNOI + y1Opex;
      grossRevY2 = grossRev; baseNOIY2 = baseNOI;
    } else if(asset.revenueMode==="bottomup" && buRevY1.total>0){
      grossRev = buRevY1.total; baseNOI = grossRev - y1Opex;
      grossRevY2 = buRevY2.total; baseNOIY2 = grossRevY2 - y1Opex;
    } else {
      baseNOI = asset.price*asset.cap; grossRev = baseNOI + y1Opex;
      grossRevY2 = grossRev; baseNOIY2 = baseNOI;
    }

    // NOI schedule — length matches THIS deal's hold period
    const g1 = asset.noiY1Growth!=null ? asset.noiY1Growth : (asset.growth||.05);
    const g2 = asset.noiY2Growth!=null ? asset.noiY2Growth : (asset.growth||.05);
    const noi=Array.from({length:holdYrs+1},(_,y)=>{
      if(y===0) return 0;
      if(y===1) return baseNOI;
      let v = baseNOI * (1+g1);
      for(let yr=3; yr<=y; yr++) v *= (1+g2);
      return v;
    });

    // BW fees — Y1 = $125K fixed, Y2+ = 6% of REVENUE (NOI + OpEx = gross revenue)
    const bwFees = noi.map((n,y)=>{
      if(y===0) return{fixed:0,revMgmt:0,total:0};
      const rev = n + (opexByYear[y]||0); // gross revenue = NOI + operating expenses
      return calcBWFees(asset, rev, y);
    });
    const bwAnn = bwFees.map(f=>f.total);

    // CapEx 50/50 debt/equity
    const txCosts = asset.txCosts||0;
    const capexEqByYear = {};
    const capexDebtByYear = {};
    Object.entries(capexByYear).forEach(([yr,amt])=>{
      capexEqByYear[yr] = amt * (1 - debtPct);
      capexDebtByYear[yr] = amt * debtPct;
    });

    // Debt service schedule — length matches hold period
    const dsByYear = Array.from({length:holdYrs+1},(_,y)=>{
      if(y===0) return 0;
      let ds = y<=ioYrs ? ioAnnDS : amAnnDS;
      Object.entries(capexDebtByYear).forEach(([cy,cd])=>{
        const capYr = Number(cy);
        const yrsActive = y - capYr;
        if(yrsActive<=0) return;
        const capIO = Math.ceil((asset.ioPeriod||0)/12);
        if(yrsActive<=capIO) ds += cd*interestRate;
        else ds += pmt(interestRate,amortYears,cd);
      });
      return ds;
    });

    // Loan balance at exit — monthly precision
    const ioMoCount = asset.ioPeriod||0;
    const moAmPmt = Math.abs(pmt(interestRate/12, amortYears*12, debt));
    const acqAmMo = Math.max(0, holdMonths - ioMoCount);
    let totalLB = acqAmMo>0 ? Math.abs(fvLoan(interestRate/12, acqAmMo, moAmPmt, debt)) : debt;
    Object.entries(capexDebtByYear).forEach(([cy,cd])=>{
      const capMo = Number(cy)*12; // month of deployment (deal-relative)
      const moHeld = holdMonths - capMo;
      if(moHeld<=0){ totalLB += cd; return; }
      const capAmMo = Math.max(0, moHeld - ioMoCount);
      const capMoPmt = Math.abs(pmt(interestRate/12, amortYears*12, cd));
      totalLB += capAmMo>0 ? Math.abs(fvLoan(interestRate/12, capAmMo, capMoPmt, cd)) : cd;
    });

    // Exit calculations (needed for monthly ECF)
    const exitNOI = noi[holdYrs];
    const exitVal = exitNOI / exitCapRate;
    const lb = totalLB;
    const saleNet = exitVal - lb - exitVal*saleCosts;

    // ── MONTHLY EQUITY CASH FLOW aligned to fund calendar ──
    // Each deal gets a (holdMonths+1) array: month 0 = closing, month N = exit
    const ioMo = asset.ioPeriod||0;
    const moRate = interestRate/12;
    const moAmDS = Math.abs(pmt(interestRate/12, amortYears*12, debt)); // monthly amortizing
    const moIODS = debt*interestRate/12; // monthly I/O

    // Monthly capex debt service per tranche
    const capexDebtTranches = Object.entries(capexDebtByYear).map(([cy,cd])=>({
      deployMonth: Number(cy)*12, // deal-month when deployed
      debt: cd,
      moIO: cd*interestRate/12,
      moAm: Math.abs(pmt(interestRate/12, amortYears*12, cd)),
    }));

    // Build monthly ECF: index 0 = deal close month, index holdMonths = exit month
    const moECF = Array.from({length:holdMonths+1},(_,mi)=>{
      if(mi===0){
        // Closing: equity + day-1 capex equity + tx costs
        return -(eq + (capexEqByYear[0]||0) + txCosts);
      }
      // Which deal-year is this month in? (mi=1 is first operating month = deal Y1)
      const dealYr = Math.floor((mi-1)/12)+1;
      // Monthly NOI from annual schedule
      const annNOI = dealYr<=holdYrs ? (noi[dealYr]||0) : (noi[holdYrs]||0);
      const moNOI = annNOI/12;
      // Monthly acq debt service (I/O vs amortizing)
      const acqDS = mi<=ioMo ? moIODS : moAmDS;
      // Monthly capex debt service
      let capDS = 0;
      capexDebtTranches.forEach(t=>{
        const moActive = mi - t.deployMonth;
        if(moActive<=0) return;
        capDS += moActive<=ioMo ? t.moIO : t.moAm;
      });
      // Monthly BW fees
      const annBW = dealYr<=holdYrs ? (bwAnn[dealYr]||0) : (bwAnn[holdYrs]||0);
      const moBW = annBW/12;
      // Capex equity calls at deployment month
      let capEq = 0;
      Object.entries(capexEqByYear).forEach(([cy,ceq])=>{
        if(Number(cy)===0) return; // day-1 already in mi=0
        if(mi === Number(cy)*12) capEq = ceq; // deploy at start of deal-year
      });
      let cf = moNOI - acqDS - capDS - moBW - capEq;
      // Exit month: add net sale proceeds
      if(mi===holdMonths) cf += saleNet;
      return cf;
    });

    // IRR from monthly CF, annualized
    const moIRR = irr(moECF, 0.01); // monthly IRR with lower initial guess
    const eqIRR = Math.pow(1+moIRR, 12)-1; // annualized
    const totalEquityIn = eq + Object.values(capexEqByYear).reduce((s,v)=>s+v,0) + txCosts;
    const totalDebt = debt + Object.values(capexDebtByYear).reduce((s,v)=>s+v,0);
    const moic = moECF.slice(1).reduce((s,v)=>s+v,0) / totalEquityIn;
    const totBWFee = bwAnn.reduce((s,v)=>s+v,0);

    return {...asset, eq, debt, totalDebt, annDS, ioAnnDS, amAnnDS, ioYrs, holdYrs, holdMonths, dsByYear, noi, bwFees, bwAnn, totBWFee,
      totalCapex, day1Capex, capexByYear, capexEqByYear, capexDebtByYear, txCosts,
      buRev, buRevY1, buRevY2, grossRev, grossRevY2, baseNOIY2, y1Opex, opexByYear,
      saleNet, exitVal, lb, irr:eqIRR, moic, baseNOI, totalEquityIn, moECF};
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
      if(mo>x.startMonth+ar.holdMonths-1) return; // deal already exited
      const yr=Math.floor((mo-x.startMonth)/12)+1;
      const hY=ar.holdYrs;
      const moNOI=(yr<=hY?ar.noi[yr]:(ar.noi[hY]||0))/12;
      noi+=moNOI;
      const bwYear = yr<=hY ? (ar.bwAnn[yr]||0) : (ar.bwAnn[hY]||0);
      bwF+=bwYear/12;
      // CapEx equity — tracked as a separate capital call, NOT deducted from operating CF
      const yrCapexEq = ar.capexEqByYear?.[yr]||0;
      if(yrCapexEq>0) capxF+=yrCapexEq/12;
      invEq+=x.price*(1-debtPct);
      // Total debt service from precomputed annual schedule
      const yrDS = yr<=hY ? (ar.dsByYear?.[yr]||0) : (ar.dsByYear?.[hY]||0);
      ds+=yrDS/12;
    });
    const ga=gaMonthly[i].total;
    const netOpCF=noi-ds-bwF-ga;
    // LP/GP capital calls — acquisition equity + capex equity + tx costs at deployment
    let lpCallMo=0, gpCallMo=0;
    assetR.forEach((ar,ai)=>{
      const x=assets[ai];
      if(x.startMonth===mo){
        const day1Eq = x.price*(1-debtPct) + (ar.capexEqByYear?.[0]||0) + (x.txCosts||0);
        lpCallMo += day1Eq*(1-gpPct);
        gpCallMo += day1Eq*gpPct;
      }
      if(ar.capexEqByYear){
        Object.entries(ar.capexEqByYear).forEach(([cy,ceq])=>{
          const capYr=Number(cy); if(capYr===0) return;
          const deployMonth = x.startMonth + capYr*12;
          if(deployMonth===mo){ lpCallMo+=ceq*(1-gpPct); gpCallMo+=ceq*gpPct; }
        });
      }
    });
    return{mo,noi,invEq,ds,bwF,netOpCF,lpCall:lpCallMo,gpCall:gpCallMo,ga};
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

  // LP IRR — proper year-by-year timing of capital calls AND distributions
  // Capital calls are negative in the year they occur (NOT all dumped into year 0)
  // This fixes the post-CapEx distortion where CapEx equity (called in yrs 1-2) was
  // incorrectly shown as a year-0 outflow, artificially suppressing IRR.
  const lpCF=Array(fundTerm+1).fill(0);
  let interimLPSum=0;
  for(let y=0;y<fundTerm;y++){
    const slice=monthly.slice(y*12,(y+1)*12);
    const annOpLP=slice.reduce((t,x)=>t+x.netOpCF*(1-gpPct),0);
    const annLPCalls=slice.reduce((t,x)=>t+x.lpCall,0);
    lpCF[y]-=annLPCalls;       // capital outflows in the year they are called
    if(y<fundTerm-1){
      lpCF[y+1]+=annOpLP;      // operating distributions received end of year
      interimLPSum+=annOpLP;
    }
  }
  // Final year gets remaining waterfall payout (exit + last year op CF)
  lpCF[fundTerm]+=lpTotal-interimLPSum;
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

  // Per-partner — capital at risk is GP co-invest (acq + capex)
  const promPP=gpPromote/partners;
  // drawsPP: sum actual positive operating distributions, separate from capital calls
  const opDrawsTotal=gpEntity.reduce((s,x)=>s+Math.max(0,x.opDist),0);
  const drawsPP=opDrawsTotal/partners;
  const rocPP=gpROC/partners;
  const coInvPP=totGPCalled/partners;
  const totalPP=promPP+drawsPP+rocPP;
  const netPP=totalPP-coInvPP;

  // Monthly partner data — track capital calls separately for true net position
  const partnerMonthly=gpEntity.map(x=>({
    mo:x.mo,
    draw:Math.max(0,x.opDist)/partners,    // positive operating distributions only
    coInvest:x.coInvest/partners,           // capital calls (negative) per partner
    promote:(x.promote||0)/partners,
  }));
  let pCum=0;
  // Cumulative includes capital calls so chart correctly goes negative early then recovers
  const partnerCum=partnerMonthly.map(x=>{pCum+=x.draw+x.coInvest+x.promote;return{mo:x.mo,cum:pCum};});

  // Portfolio NOI chart — prorated for partial years, only active deals per fund year
  const noiChart=Array.from({length:fundTerm},(_,fy)=>{
    const fyStart=fy*12+1, fyEnd=(fy+1)*12;
    let totalNOI=0;
    assetR.forEach((ar,ai)=>{
      const x=assets[ai];
      if(x.startMonth>fyEnd) return; // not yet acquired
      const opStart=Math.max(x.startMonth, fyStart);
      const opEnd=Math.min(x.startMonth+ar.holdMonths-1, fyEnd);
      const opMonths=Math.max(0, opEnd-opStart+1);
      if(opMonths<=0) return;
      const midMo=Math.floor((opStart+opEnd)/2);
      const dealYr=Math.floor((midMo-x.startMonth)/12)+1;
      const annNOI=dealYr>=1&&dealYr<=ar.holdYrs?(ar.noi[dealYr]||0):0;
      totalNOI+=annNOI*(opMonths/12);
    });
    return{year:`Yr ${fy+1}`,noi:totalNOI};
  });

  // Fund CF by year — lpCalls includes acq + capex; capexCalls shown separately for charting
  const fundCFAnnual=Array.from({length:fundTerm},(_,y)=>{
    const s=y*12,e=(y+1)*12;
    const slice=monthly.slice(s,e);
    return{
      year:`Yr ${y+1}`,
      lpCalls:-slice.reduce((t,x)=>t+x.lpCall,0),
      lpAcqCalls:-slice.reduce((t,x)=>t+(x.lpCall-x.capxLP),0),
      lpCapexCalls:-slice.reduce((t,x)=>t+x.capxLP,0),
      opCF:slice.reduce((t,x)=>t+x.netOpCF,0),
      noi:slice.reduce((t,x)=>t+x.noi,0),
    };
  });

  // Deployment curve
  // Deployment curve — cumulative LP capital called
  let deplCum=0;
  const deplCurve=monthly.map(m=>{deplCum+=m.lpCall;return{mo:m.mo,lp:deplCum};});

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

// ── EXCEL EXPORT ─────────────────────────────────────────────────────────────
function exportToExcel(m,a){
  const wb=XLSX.utils.book_new();
  const ft=a.fundTerm;
  const n=a.assets.length;
  const maxH=Math.max(...m.assetR.map(x=>x.holdYrs));

  // Column letter helper (0=A, 25=Z, 26=AA)
  const CL=c=>{let s="";c++;while(c>0){c--;s=String.fromCharCode(65+c%26)+s;c=Math.floor(c/26);}return s;};

  // Write a cell with formula AND cached value so Excel shows data immediately
  function W(ws,r,c,v,fmt,cv){
    const ref=CL(c)+(r+1);
    if(v===null||v===undefined||v===""){ws[ref]={t:"z"};return;}
    if(typeof v==="string"&&v.startsWith("=")){
      // Formula cell — include cached value if provided
      const cell={t:"n",f:v.slice(1)};
      if(cv!==undefined&&cv!==null&&typeof cv==="number"&&isFinite(cv)) cell.v=cv;
      ws[ref]=cell;
    } else if(typeof v==="number"){
      ws[ref]={t:"n",v};
    } else {
      ws[ref]={t:"s",v:String(v)};
    }
    if(fmt) ws[ref].z=fmt;
    const range=XLSX.utils.decode_range(ws["!ref"]||"A1");
    if(r>range.e.r)range.e.r=r; if(c>range.e.c)range.e.c=c;
    ws["!ref"]=XLSX.utils.encode_range(range);
  }

  // Write a row of values
  function WR(ws,r,vals,fmts){vals.forEach((v,c)=>W(ws,r,c,v,fmts?.[c]));}

  // ═══════════════════════════════════════════════════════════════════════
  // SHEET 1: INPUTS
  // ═══════════════════════════════════════════════════════════════════════
  const inp={"!ref":"A1","!cols":[{wch:22},{wch:16},...Array(16).fill({wch:14})]};
  W(inp,0,0,"RDM BASE CASE — MODEL INPUTS");
  W(inp,2,0,"FUND STRUCTURE"); W(inp,2,1,"Value");
  const fundLabels=["Hold Period (years)","LTV (Debt %)","Interest Rate","Amort Period (years)",
    "Exit Cap Rate","Sale Costs %","Pref Return","Carry %","GP Commitment %"];
  const fundVals=[ft,a.debtPct,a.interestRate,a.amortYears,a.exitCapRate,a.saleCosts,a.prefReturn,a.carry,a.gpPct];
  const fundFmts=[null,"0.0%","0.00%",null,"0.0%","0.0%","0.0%","0.0%","0.0%"];
  fundLabels.forEach((l,i)=>{W(inp,3+i,0,l);W(inp,3+i,1,fundVals[i],fundFmts[i]);});

  // Per-deal inputs starting row 14 (0-indexed=13)
  const DR=15; // first deal data row (0-indexed)
  W(inp,13,0,"PER-DEAL ASSUMPTIONS");
  const dCols=["#","Name","Acq Price","Cap Rate","Close Mo","I/O (mo)","Tx Costs",
    "NOI Plug","Y1 Growth","Y2+ Growth","BW Mktg $","BW Acct $","BW IT $","BW Rev%",
    "CapEx D1","CapEx Y1","CapEx Y2","CapEx Y3"];
  dCols.forEach((h,c)=>W(inp,14,c,h));
  const dFmts=[null,null,"$#,##0","0.0%","#,##0","#,##0","$#,##0","$#,##0","0.0%","0.0%",
    "$#,##0","$#,##0","$#,##0","0.0%","$#,##0","$#,##0","$#,##0","$#,##0"];
  a.assets.forEach((d,i)=>{
    const cx=d.capexItems||[];
    const cxByYr=[0,0,0,0]; cx.forEach(c=>{if(c.year<=3)cxByYr[c.year]+=c.amount;});
    const vals=[i+1,d.name,d.price,d.cap,d.startMonth,d.ioPeriod||12,d.txCosts||0,
      d.noiPlug||0,d.noiY1Growth,d.noiY2Growth,
      d.bwMarketing||0,d.bwAccounting||0,d.bwIT||0,d.bwRevMgmt||0,
      cxByYr[0],cxByYr[1],cxByYr[2],cxByYr[3]];
    vals.forEach((v,c)=>W(inp,DR+i,c,v,dFmts[c]));
  });
  XLSX.utils.book_append_sheet(wb,inp,"Inputs");

  // Inputs references (Excel notation — row is 1-indexed so DR+i+1)
  const I={hold:"Inputs!$B$4",ltv:"Inputs!$B$5",rate:"Inputs!$B$6",amort:"Inputs!$B$7",
    exitCap:"Inputs!$B$8",saleCost:"Inputs!$B$9",pref:"Inputs!$B$10",carry:"Inputs!$B$11",gpPct:"Inputs!$B$12"};
  // Per-deal input cell (0-indexed col) → "Inputs!$C$16" etc
  const DI=(di,c)=>`Inputs!$${CL(c)}$${DR+di+1}`;

  // ═══════════════════════════════════════════════════════════════════════
  // SHEET 2: DEAL CALCS — formula-driven
  // ═══════════════════════════════════════════════════════════════════════
  const dc={"!ref":"A1","!cols":[]};
  W(dc,0,0,"DEAL CALCULATIONS — formulas reference Inputs sheet");

  // Layout: fixed cols A-P, then NOI cols, then DS cols, then ECF cols
  // A=#, B=Name, C=Price, D=LTV, E=Equity, F=AcqDebt, G=CloseMo, H=HoldMo, I=HoldYrs, J=IOYrs
  // K=CapExTot, L=CapExEq, M=CapExDebt, N=TxCosts, O=TotEqIn, P=TotDebt
  // Q=BaseNOI, R..=NOI Yr1..YrN, then ExitNOI, ExitVal
  // Then IO_DS, Am_DS, DS Yr1..YrN, LoanBal, NetSale
  // Then ECF Y0..YN, IRR, MOIC

  const NOI_START=17; // col Q (0-indexed=16), but baseNOI is 16, NOI starts 17
  const BASE_NOI=16;
  const NOI_END=BASE_NOI+1+maxH; // after last NOI year
  const EXIT_NOI=NOI_END;
  const EXIT_VAL=EXIT_NOI+1;
  const IO_DS=EXIT_VAL+1;
  const AM_DS=IO_DS+1;
  const DS_START=AM_DS+1;
  const DS_END=DS_START+maxH;
  const LB=DS_END;
  const NS=LB+1;
  const ECF_START=NS+1;
  const ECF_END=ECF_START+maxH+1;
  const IRR_COL=ECF_END;
  const MOIC_COL=IRR_COL+1;

  // Headers (row 2, 0-indexed=1)
  const hdrs=["#","Name","Acq Price","LTV","Equity","Acq Debt","Close Mo","Hold Mo","Hold Yrs","I/O Yrs",
    "CapEx Tot","CapEx Eq","CapEx Debt","Tx Costs","Tot Eq In","Tot Debt","Base NOI"];
  for(let y=0;y<maxH;y++) hdrs.push(`NOI Y${y+1}`);
  hdrs.push("Exit NOI","Exit Value","IO DS","Am DS");
  for(let y=0;y<maxH;y++) hdrs.push(`DS Y${y+1}`);
  hdrs.push("Loan Bal","Net Sale","ECF Y0");
  for(let y=0;y<maxH;y++) hdrs.push(`ECF Y${y+1}`);
  hdrs.push("IRR","MOIC");
  hdrs.forEach((h,c)=>W(dc,1,c,h));

  // Per-deal formulas
  m.assetR.forEach((ar,i)=>{
    const r=2+i; // 0-indexed row
    const R=r+1;  // 1-indexed for formulas
    const $=(c)=>`${CL(c)}${R}`; // this row cell ref
    const di=(c)=>DI(i,c); // inputs cell ref

    // A-P: fixed columns — formula + cached value from model
    W(dc,r,0,i+1);
    W(dc,r,1,ar.name);
    W(dc,r,2,`=${di(2)}`,"$#,##0",ar.price);
    W(dc,r,3,`=${I.ltv}`,"0.0%",a.debtPct);
    W(dc,r,4,`=${$(2)}*(1-${$(3)})`,"$#,##0",ar.eq);
    W(dc,r,5,`=${$(2)}*${$(3)}`,"$#,##0",ar.debt);
    W(dc,r,6,`=${di(4)}`,null,ar.startMonth);
    W(dc,r,7,`=${I.hold}*12-${$(6)}+1`,null,ar.holdMonths);
    W(dc,r,8,`=CEILING(${$(7)}/12,1)`,null,ar.holdYrs);
    W(dc,r,9,`=CEILING(${di(5)}/12,1)`,null,ar.ioYrs);
    W(dc,r,10,`=${di(14)}+${di(15)}+${di(16)}+${di(17)}`,"$#,##0",ar.totalCapex);
    W(dc,r,11,`=${$(10)}*(1-${I.ltv})`,"$#,##0",ar.totalCapex*(1-a.debtPct));
    W(dc,r,12,`=${$(10)}*${I.ltv}`,"$#,##0",ar.totalCapex*a.debtPct);
    W(dc,r,13,`=${di(6)}`,"$#,##0",ar.txCosts);
    W(dc,r,14,`=${$(4)}+${$(11)}+${$(13)}`,"$#,##0",ar.totalEquityIn);
    W(dc,r,15,`=${$(5)}+${$(12)}`,"$#,##0",ar.totalDebt);

    // Q: base NOI
    W(dc,r,BASE_NOI,`=IF(${di(7)}>0,${di(7)},${$(2)}*${di(3)})`,"$#,##0",ar.baseNOI);

    // NOI schedule
    for(let y=0;y<maxH;y++){
      const c=BASE_NOI+1+y;
      const cv=y<ar.holdYrs?(ar.noi[y+1]||0):null;
      if(y===0)
        W(dc,r,c,`=IF(${y+1}<=${$(8)},${$(BASE_NOI)},"")`,"$#,##0",cv);
      else if(y===1)
        W(dc,r,c,`=IF(${y+1}<=${$(8)},${$(BASE_NOI)}*(1+${di(8)}),"")`,"$#,##0",cv);
      else
        W(dc,r,c,`=IF(${y+1}<=${$(8)},${$(c-1)}*(1+${di(9)}),"")`,"$#,##0",cv);
    }

    // Exit NOI & Value
    W(dc,r,EXIT_NOI,`=INDEX(${$(BASE_NOI+1)}:${$(BASE_NOI+maxH)},1,${$(8)})`,"$#,##0",ar.noi[ar.holdYrs]);
    W(dc,r,EXIT_VAL,`=${$(EXIT_NOI)}/${I.exitCap}`,"$#,##0",ar.exitVal);

    // Debt service
    W(dc,r,IO_DS,`=${$(5)}*${I.rate}`,"$#,##0",ar.ioAnnDS);
    W(dc,r,AM_DS,`=-PMT(${I.rate},${I.amort},${$(5)})`,"$#,##0",ar.amAnnDS);

    for(let y=0;y<maxH;y++){
      const c=DS_START+y;
      if(y<ar.holdYrs){
        const capexDelta=ar.dsByYear[y+1] - (y+1<=ar.ioYrs ? ar.ioAnnDS : ar.amAnnDS);
        const capexAdd=Math.abs(capexDelta)>1?`+${Math.round(capexDelta)}`:"";
        W(dc,r,c,`=IF(${y+1}<=${$(9)},${$(IO_DS)},${$(AM_DS)})${capexAdd}`,"$#,##0",ar.dsByYear[y+1]);
      }
    }

    // Loan balance
    W(dc,r,LB,ar.lb,"$#,##0");

    // Net sale proceeds
    W(dc,r,NS,`=${$(EXIT_VAL)}-${$(LB)}-${$(EXIT_VAL)}*${I.saleCost}`,"$#,##0",ar.saleNet);

    // ECF Y0
    const ecfY0=-(ar.eq+(ar.capexEqByYear?.[0]||0)+(ar.txCosts||0));
    W(dc,r,ECF_START,`=-(${$(4)}+${di(14)}*(1-${I.ltv})+${$(13)})`,"$#,##0",ecfY0);

    // ECF Y1..Yn — build actual ECF from model for cached values
    const ecfActual=ar.noi.map((nn,yy)=>{
      if(yy===0)return ecfY0;
      const capEq=ar.capexEqByYear?.[yy]||0;
      return nn-(ar.dsByYear?.[yy]||0)-(ar.bwAnn?.[yy]||0)-capEq;
    });
    if(ar.holdYrs<=ecfActual.length) ecfActual[ar.holdYrs]+=ar.saleNet;

    for(let y=0;y<maxH;y++){
      const c=ECF_START+1+y;
      if(y<ar.holdYrs){
        const noiRef=$(BASE_NOI+1+y);
        const dsRef=$(DS_START+y);
        const bwF=`(${di(10)}+${di(11)}+${di(12)}+${noiRef}*${di(13)})`;
        const isExit=y===ar.holdYrs-1;
        const sale=isExit?`+${$(NS)}`:"";
        W(dc,r,c,`=${noiRef}-${dsRef}-${bwF}${sale}`,"$#,##0",ecfActual[y+1]);
      }
    }

    // IRR (monthly-computed, annualized) & MOIC — values from model
    // Note: annual ECF IRR formula is approximate; the cached value is the accurate monthly IRR
    W(dc,r,IRR_COL,ar.irr,"0.0%");
    W(dc,r,MOIC_COL,ar.moic,"0.00x");
  });

  // Totals row
  const tR=2+n;
  W(dc,tR,0,""); W(dc,tR,1,"PORTFOLIO TOTAL");
  // Dollar columns get SUM formulas
  [2,4,5,10,11,12,13,14,15].forEach(c=>{
    W(dc,tR,c,`=SUM(${CL(c)}3:${CL(c)}${2+n})`,"$#,##0");
  });
  // LTV avg (skip — not meaningful as sum)
  W(dc,tR,3,a.debtPct,"0.0%");
  // Exit value, Net sale, Loan balance totals
  W(dc,tR,EXIT_VAL,`=SUM(${CL(EXIT_VAL)}3:${CL(EXIT_VAL)}${2+n})`,"$#,##0");
  W(dc,tR,LB,`=SUM(${CL(LB)}3:${CL(LB)}${2+n})`,"$#,##0");
  W(dc,tR,NS,`=SUM(${CL(NS)}3:${CL(NS)}${2+n})`,"$#,##0");
  // ECF Y0 total
  W(dc,tR,ECF_START,`=SUM(${CL(ECF_START)}3:${CL(ECF_START)}${2+n})`,"$#,##0");
  // NOI year totals
  for(let y=0;y<maxH;y++){
    W(dc,tR,BASE_NOI+1+y,`=SUM(${CL(BASE_NOI+1+y)}3:${CL(BASE_NOI+1+y)}${2+n})`,"$#,##0");
    W(dc,tR,DS_START+y,`=SUM(${CL(DS_START+y)}3:${CL(DS_START+y)}${2+n})`,"$#,##0");
    W(dc,tR,ECF_START+1+y,`=SUM(${CL(ECF_START+1+y)}3:${CL(ECF_START+1+y)}${2+n})`,"$#,##0");
  }
  // Base NOI total
  W(dc,tR,BASE_NOI,`=SUM(${CL(BASE_NOI)}3:${CL(BASE_NOI)}${2+n})`,"$#,##0");
  // Exit NOI total
  W(dc,tR,EXIT_NOI,`=SUM(${CL(EXIT_NOI)}3:${CL(EXIT_NOI)}${2+n})`,"$#,##0");
  // IO DS and AM DS totals
  W(dc,tR,IO_DS,`=SUM(${CL(IO_DS)}3:${CL(IO_DS)}${2+n})`,"$#,##0");
  W(dc,tR,AM_DS,`=SUM(${CL(AM_DS)}3:${CL(AM_DS)}${2+n})`,"$#,##0");

  dc["!cols"]=hdrs.map((_,i)=>({wch:i===1?18:i===0?4:12}));
  XLSX.utils.book_append_sheet(wb,dc,"Deal Calcs");

  // ═══════════════════════════════════════════════════════════════════════
  // SHEET 3: FUND YEAR NOI — maps each deal's NOI to fund calendar years
  // ═══════════════════════════════════════════════════════════════════════
  const fy={"!ref":"A1","!cols":[{wch:4},{wch:18},{wch:6},{wch:6},...Array(ft).fill({wch:14})]};

  W(fy,0,0,"NOI BY FUND YEAR — prorated for partial operating years");
  const fyCols=Array.from({length:ft},(_,i)=>`Fund Yr ${i+1}`);
  WR(fy,1,["#","Name","Close","Months",...fyCols]);
  m.assetR.forEach((ar,i)=>{
    const r=2+i;
    W(fy,r,0,i+1); W(fy,r,1,ar.name); W(fy,r,2,ar.startMonth); W(fy,r,3,ar.holdMonths);
    for(let y=0;y<ft;y++){
      const fyStart=y*12+1, fyEnd=(y+1)*12;
      if(ar.startMonth>fyEnd) continue; // not yet acquired
      const opStart=Math.max(ar.startMonth, fyStart);
      const opEnd=Math.min(ar.startMonth+ar.holdMonths-1, fyEnd);
      const opMo=Math.max(0, opEnd-opStart+1);
      if(opMo<=0) continue;
      const midMo=Math.floor((opStart+opEnd)/2);
      const dealYr=Math.floor((midMo-ar.startMonth)/12)+1;
      const annNOI=dealYr>=1&&dealYr<=ar.holdYrs?(ar.noi[dealYr]||0):0;
      W(fy,r,4+y,annNOI*(opMo/12),"$#,##0");
    }
  });
  // Totals row
  const fyTR=2+n;
  W(fy,fyTR,0,""); W(fy,fyTR,1,"PORTFOLIO TOTAL");
  for(let y=0;y<ft;y++){
    W(fy,fyTR,4+y,`=SUM(${CL(4+y)}3:${CL(4+y)}${2+n})`,"$#,##0",m.noiChart[y]?.noi||0);
  }
  // Active deals count per fund year
  const fyCountR=fyTR+1;
  W(fy,fyCountR,1,"ACTIVE DEALS");
  for(let y=0;y<ft;y++){
    const fyS=y*12+1, fyE=(y+1)*12;
    const cnt=m.assetR.filter((ar,ai)=>{
      const x=a.assets[ai];
      if(x.startMonth>fyE)return false;
      const opEnd=Math.min(x.startMonth+ar.holdMonths-1,fyE);
      return opEnd>=fyS;
    }).length;
    W(fy,fyCountR,4+y,cnt);
  }
  // Months operating row
  const fyMoR=fyCountR+1;
  W(fy,fyMoR,1,"MONTHS OPERATING");
  for(let y=0;y<ft;y++){
    const fyS=y*12+1, fyE=(y+1)*12;
    let totMo=0;
    m.assetR.forEach((ar,ai)=>{
      const x=a.assets[ai];
      if(x.startMonth>fyE)return;
      const opS=Math.max(x.startMonth,fyS);
      const opE=Math.min(x.startMonth+ar.holdMonths-1,fyE);
      totMo+=Math.max(0,opE-opS+1);
    });
    W(fy,fyMoR,4+y,totMo);
  }
  XLSX.utils.book_append_sheet(wb,fy,"Fund Year NOI");

  // ═══════════════════════════════════════════════════════════════════════
  // SHEET: MONTHLY DEAL CF — each deal's monthly ECF on the fund timeline
  // ═══════════════════════════════════════════════════════════════════════
  const mdc={"!ref":"A1","!cols":[{wch:4},{wch:16},{wch:5},{wch:5},{wch:8},...Array(MO).fill({wch:11}),{wch:10},{wch:10}]};
  W(mdc,0,0,"MONTHLY EQUITY CASH FLOW — each deal on fund calendar");
  // Headers
  W(mdc,1,0,"#"); W(mdc,1,1,"Name"); W(mdc,1,2,"Close"); W(mdc,1,3,"Hold"); W(mdc,1,4,"IRR");
  for(let mi=1;mi<=MO;mi++) W(mdc,1,4+mi,`M${mi}`);
  W(mdc,1,5+MO,"MOIC"); W(mdc,1,6+MO,"Eq In");

  // Per deal: map moECF (deal-relative) onto fund months
  m.assetR.forEach((ar,i)=>{
    const r=2+i;
    W(mdc,r,0,i+1);
    W(mdc,r,1,ar.name);
    W(mdc,r,2,ar.startMonth);
    W(mdc,r,3,ar.holdMonths);
    W(mdc,r,4,ar.irr,"0.0%");
    // Map deal months to fund months
    if(ar.moECF){
      ar.moECF.forEach((cf,mi)=>{
        const fundMo = (mi===0) ? ar.startMonth : ar.startMonth + mi;
        if(fundMo>=1 && fundMo<=MO){
          W(mdc,r,4+fundMo,cf,"$#,##0");
        }
      });
    }
    W(mdc,r,5+MO,ar.moic,"0.00x");
    W(mdc,r,6+MO,ar.totalEquityIn,"$#,##0");
  });

  // Portfolio total row — sum each fund month across all deals
  const mdcTR=2+n;
  W(mdc,mdcTR,0,""); W(mdc,mdcTR,1,"PORTFOLIO TOTAL");
  for(let mi=1;mi<=MO;mi++){
    W(mdc,mdcTR,4+mi,`=SUM(${CL(4+mi)}3:${CL(4+mi)}${2+n})`,"$#,##0");
  }
  // Cumulative row
  const mdcCR=mdcTR+1;
  W(mdc,mdcCR,1,"CUMULATIVE");
  for(let mi=1;mi<=MO;mi++){
    const c=4+mi;
    if(mi===1) W(mdc,mdcCR,c,`=${CL(c)}${mdcTR+1}`,"$#,##0");
    else W(mdc,mdcCR,c,`=${CL(c-1)}${mdcCR+1}+${CL(c)}${mdcTR+1}`,"$#,##0");
  }
  XLSX.utils.book_append_sheet(wb,mdc,"Monthly Deal CF");

  // ═══════════════════════════════════════════════════════════════════════
  // SHEET: WATERFALL
  // ═══════════════════════════════════════════════════════════════════════
  const wf={"!ref":"A1","!cols":[{wch:28},{wch:18},{wch:40}]};
  W(wf,0,0,"LP / GP WATERFALL");
  W(wf,2,0,"Total Sale Proceeds"); W(wf,2,1,m.totSaleProc,"$#,##0"); W(wf,2,2,"Sum of deal net sale proceeds");
  W(wf,3,0,"Total Operating CF");  W(wf,3,1,m.totOpCF,"$#,##0");     W(wf,3,2,"Portfolio net op CF");
  W(wf,5,0,"TOTAL POOL");          W(wf,5,1,"=B3+B4","$#,##0",m.pool);
  W(wf,7,0,"LP Capital Deployed"); W(wf,7,1,m.lpActualCapital,"$#,##0");
  W(wf,8,0,"GP Capital Deployed"); W(wf,8,1,m.gpActualCapital,"$#,##0");
  W(wf,10,0,"TIER 1: ROC");
  W(wf,11,0,"LP ROC");             W(wf,11,1,"=MIN(B8,B6)","$#,##0",m.lpROC);
  W(wf,12,0,"GP ROC");             W(wf,12,1,"=MIN(B9,B6-B12)","$#,##0",m.gpROC);
  W(wf,13,0,"Remaining");          W(wf,13,1,"=B6-B12-B13","$#,##0",m.pool-m.lpROC-m.gpROC);
  W(wf,15,0,"TIER 2: PREFERRED");
  W(wf,16,0,"Pref Rate");          W(wf,16,1,`=${I.pref}`,"0.0%",a.prefReturn);
  W(wf,17,0,"LP Pref Due");        W(wf,17,1,`=B8*B17*${I.hold}`,"$#,##0",m.lpActualCapital*a.prefReturn*ft);
  W(wf,18,0,"LP Pref Paid");       W(wf,18,1,"=MIN(B18,B14)","$#,##0",m.lpPref);
  W(wf,19,0,"Remaining");          W(wf,19,1,"=B14-B19","$#,##0",m.pool-m.lpROC-m.gpROC-m.lpPref);
  W(wf,21,0,"TIER 3: PROMOTE");
  W(wf,22,0,"Carry %");            W(wf,22,1,`=${I.carry}`,"0.0%",a.carry);
  W(wf,23,0,"GP Promote");         W(wf,23,1,"=B20*B23","$#,##0",m.gpPromote);
  W(wf,24,0,"LP Residual");        W(wf,24,1,"=B20*(1-B23)","$#,##0",m.lpResid);
  W(wf,26,0,"TOTALS");
  W(wf,27,0,"LP Total");           W(wf,27,1,"=B12+B19+B25","$#,##0",m.lpTotal);
  W(wf,28,0,"LP MOIC");            W(wf,28,1,"=B28/B8","0.00x",m.lpMOIC);
  W(wf,29,0,"LP Net IRR");         W(wf,29,1,m.lpIRR,"0.0%"); W(wf,29,2,"Annual approx");
  W(wf,31,0,"GP Total");           W(wf,31,1,"=B13+B24","$#,##0");
  W(wf,32,0,"GP per Partner");     W(wf,32,1,`=B24/${a.partners}`,"$#,##0");
  XLSX.utils.book_append_sheet(wb,wf,"Waterfall");

  // ═══════════════════════════════════════════════════════════════════════
  // SHEET 4: MONTHLY CASH FLOW
  // ═══════════════════════════════════════════════════════════════════════
  const mo={"!ref":"A1","!cols":Array(10).fill({wch:15})};
  WR(mo,0,["Month","NOI","Debt Svc","BW Fees","G&A","Net Op CF","LP Calls","GP Calls","Cumul LP","Cumul CF"]);
  m.monthly.forEach((x,i)=>{
    const r=1+i, R=r+1;
    W(mo,r,0,x.mo); W(mo,r,1,x.noi,"$#,##0"); W(mo,r,2,x.ds,"$#,##0");
    W(mo,r,3,x.bwF,"$#,##0"); W(mo,r,4,x.ga,"$#,##0");
    W(mo,r,5,`=B${R}-C${R}-D${R}-E${R}`,"$#,##0");
    W(mo,r,6,x.lpCall,"$#,##0"); W(mo,r,7,x.gpCall,"$#,##0");
    W(mo,r,8,i===0?`=G${R}`:`=I${R-1}+G${R}`,"$#,##0");
    W(mo,r,9,i===0?`=F${R}`:`=J${R-1}+F${R}`,"$#,##0");
  });
  const mTot=1+m.monthly.length;
  W(mo,mTot,0,"TOTAL");
  [1,2,3,4,5,6,7].forEach(c=>W(mo,mTot,c,`=SUM(${CL(c)}2:${CL(c)}${mTot})`,"$#,##0"));
  XLSX.utils.book_append_sheet(wb,mo,"Monthly CF");

  // ═══════════════════════════════════════════════════════════════════════
  // SHEET 5: CAPEX DETAIL
  // ═══════════════════════════════════════════════════════════════════════
  const cx={"!ref":"A1","!cols":[{wch:6},{wch:18},{wch:38},{wch:14},{wch:8},{wch:14},{wch:14}]};
  WR(cx,0,["#","Name","Item","Amount","Year","Equity","Debt"]);
  let cxR=1;
  a.assets.forEach((d,i)=>{
    (d.capexItems||[]).forEach(c=>{
      W(cx,cxR,0,i+1); W(cx,cxR,1,d.name); W(cx,cxR,2,c.label);
      W(cx,cxR,3,c.amount,"$#,##0"); W(cx,cxR,4,c.year===0?"Day-1":`Y${c.year}`);
      W(cx,cxR,5,`=D${cxR+1}*(1-${I.ltv})`,"$#,##0");
      W(cx,cxR,6,`=D${cxR+1}*${I.ltv}`,"$#,##0");
      cxR++;
    });
  });
  W(cx,cxR,1,"TOTAL");
  W(cx,cxR,3,`=SUM(D2:D${cxR})`,"$#,##0");
  W(cx,cxR,5,`=SUM(F2:F${cxR})`,"$#,##0");
  W(cx,cxR,6,`=SUM(G2:G${cxR})`,"$#,##0");
  XLSX.utils.book_append_sheet(wb,cx,"CapEx Detail");

  // ═══════════════════════════════════════════════════════════════════════
  // SHEET 6: G&A
  // ═══════════════════════════════════════════════════════════════════════
  const ga={"!ref":"A1","!cols":Array(5).fill({wch:15})};
  WR(ga,0,["Month","Personnel","Overhead","One-Time","Total G&A"]);
  m.gaMonthly.forEach((x,i)=>{
    const r=1+i, R=r+1;
    W(ga,r,0,x.mo); W(ga,r,1,x.personnel,"$#,##0"); W(ga,r,2,x.fix,"$#,##0");
    W(ga,r,3,x.oneTimeHit,"$#,##0"); W(ga,r,4,`=B${R}+C${R}+D${R}`,"$#,##0");
  });
  const gTot=1+m.gaMonthly.length;
  W(ga,gTot,0,"TOTAL");
  [1,2,3,4].forEach(c=>W(ga,gTot,c,`=SUM(${CL(c)}2:${CL(c)}${gTot})`,"$#,##0"));
  XLSX.utils.book_append_sheet(wb,ga,"G&A");

  // Force Excel to recalculate on open
  wb.Workbook={CalcPr:{fullCalcOnLoad:true}};
  XLSX.writeFile(wb,`RDM_Model_${new Date().toISOString().slice(0,10)}.xlsx`);
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

const TT=({active,payload,label,formatters})=>{
  if(!active||!payload?.length)return null;
  const fmtVal=(p)=>{
    const custom=formatters?.[p.name]??formatters?.["*"];
    if(custom)return custom(p.value);
    return typeof p.value==="number"?f.$(p.value):p.value;
  };
  return(
    <div style={{background:"#FFFFFF",border:`1px solid ${C.border}`,
      borderRadius:8,padding:"10px 14px",fontSize:11,fontFamily:"'Inter',sans-serif",
      boxShadow:"0 4px 12px rgba(0,0,0,0.1)"}}>
      {label&&<div style={{color:C.text,marginBottom:4,fontWeight:700}}>{label}</div>}
      {payload.map((p,i)=>(
        <div key={i} style={{color:p.color||C.text}}>
          {p.name}: {fmtVal(p)}
        </div>
      ))}
    </div>
  );
};

// ── TABS ──────────────────────────────────────────────────────────────────────
const TABS=["Overview","Deals","Waterfall","Fund CF","G&A Model","GP Partners","Sensitivity","Targets","Pipeline"];

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
          {tab==="Targets"  && <TabTargets a={a} setA={setA}/>}
          {tab==="Pipeline" && <TabPipeline/>}
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
              <Tooltip content={<TT formatters={{IRR:v=>`${(v*100).toFixed(1)}%`}}/>}/>
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
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
        <PHdr title="Deal Underwriting" sub={`${a.assets.length} deals · ${f.$(totCost)} total cost basis · ${f.$(totExitVal)} exit valuation (Y${a.fundTerm} NOI @ ${f.p(a.exitCapRate)} cap)`}/>
        <button onClick={()=>exportToExcel(m,a)} style={{padding:"8px 18px",background:C.accent,color:"#FFF",
          border:"none",borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0,
          display:"flex",alignItems:"center",gap:6}}>
          📊 Export to Excel
        </button>
      </div>

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
                      {l:`BW Fees ${f.$(r.totBWFee)}/${r.holdYrs}yr`,bg:"rgba(217,119,6,0.08)",c:C.gold},
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
                {label:`${r.holdYrs}yr BW Fees`,value:f.$(r.totBWFee),accent:C.gold},
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
                      <div style={{fontSize:10,fontWeight:700,color:C.text,marginBottom:6}}>{r.holdYrs}-Year BW Fee Total</div>
                      <div style={{fontSize:20,fontWeight:700,color:C.cyan}}>{f.$(r.totBWFee)}</div>
                      <div style={{fontSize:9,color:C.textFaint,marginTop:4}}>
                        Fixed: {f.$((((asset.bwMarketing||0)+(asset.bwAccounting||0)+(asset.bwIT||0))*r.holdYrs))} + Rev Mgmt: {f.$(r.totBWFee-((asset.bwMarketing||0)+(asset.bwAccounting||0)+(asset.bwIT||0))*r.holdYrs)}
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
                  const yEnd = o.amount*Math.pow(1+(o.growth||0),(r.holdYrs||a.fundTerm)-1);
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
                      <span style={{fontSize:11,color:C.textDim,textAlign:"right"}}>{f.$(yEnd)}</span>
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
                    <span style={{fontSize:11,fontWeight:700,color:C.red,textAlign:"right"}}>{f.$((asset.opex||[]).reduce((s,o)=>s+o.amount*Math.pow(1+(o.growth||0),(r.holdYrs||a.fundTerm)-1),0))}</span>
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
                  <div style={{fontSize:10,fontWeight:700,color:C.text,marginBottom:10}}>NOI Schedule — {r.holdYrs||a.fundTerm} Year Hold (Close M{asset.startMonth})</div>
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
                          {Array.from({length:r.holdYrs||a.fundTerm},(_,i)=><option key={i+1} value={i+1}>Year {i+1}</option>)}
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
                    <div style={{display:"grid",gridTemplateColumns:`auto repeat(${r.holdYrs||a.fundTerm},1fr)`,gap:6}}>
                      <div style={{fontSize:9,color:C.textFaint,padding:"4px 8px"}}>Day-1</div>
                      {Array.from({length:r.holdYrs||a.fundTerm},(_,y)=>(
                        <div key={y} style={{fontSize:9,color:C.textFaint,padding:"4px",textAlign:"center"}}>Y{y+1}</div>
                      ))}
                      <div style={{fontSize:11,fontWeight:700,color:r.capexByYear?.[0]?C.red:C.textFaint,padding:"0 8px"}}>
                        {r.capexByYear?.[0]?f.$(r.capexByYear[0]):"—"}
                      </div>
                      {Array.from({length:r.holdYrs||a.fundTerm},(_,y)=>(
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
            <Tooltip content={<TT formatters={{IRR:v=>`${(v*100).toFixed(1)}%`}}/>}/>
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

  // Monthly fund CF — netOpCF is clean operating CF (no capex deduction)
  const moDetail = (m.monthly||[]).map((x,i)=>{
    const portOpCF = x.netOpCF;
    return {
      mo: x.mo,
      portOpCF: Math.round(portOpCF),
      ga: Math.round(x.ga),
      lpShare:  Math.round(portOpCF*(1-a.gpPct)),
      gpShare:  Math.round(portOpCF*a.gpPct),
      lpCall:   Math.round(x.lpCall||0),      // total LP capital call this month (acq + capex)
      capxLP:   Math.round(x.capxLP||0),      // capex-only portion of LP call
      cumLP:    0,
    };
  });
  let cumLP=0;
  // Cumulative LP Called = actual capital drawn, not LP distributions
  moDetail.forEach(r=>{cumLP+=r.lpCall;r.cumLP=Math.round(cumLP);});

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
              <div style={{display:"flex",gap:12,marginBottom:6,flexWrap:"wrap"}}>
                {[
                  {color:C.red,     label:"Acq. Capital Calls"},
                  {color:C.orange,  label:"CapEx Capital Calls"},
                  {color:C.green,   label:"Net Op CF"},
                ].map(({color,label})=>(
                  <div key={label} style={{display:"flex",alignItems:"center",gap:4}}>
                    <div style={{width:8,height:8,borderRadius:2,background:color}}/>
                    <span style={{fontSize:8,color:C.whDim}}>{label}</span>
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={185}>
                <ComposedChart data={m.fundCFAnnual}>
                  <XAxis dataKey="year" tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
                  <YAxis tickFormatter={v=>`$${(v/1e6).toFixed(0)}M`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={42}/>
                  <Tooltip content={<TT/>}/>
                  <ReferenceLine y={0} stroke="rgba(255,255,255,.2)"/>
                  <Bar dataKey="lpAcqCalls"   name="Acq. Capital Calls"   fill={C.red}    stackId="calls" radius={[0,0,0,0]}/>
                  <Bar dataKey="lpCapexCalls" name="CapEx Capital Calls"  fill={C.orange} stackId="calls" radius={[2,2,0,0]}/>
                  <Bar dataKey="opCF"         name="Net Op CF"             fill={C.green}  radius={[2,2,0,0]}/>
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
              {col:"Portfolio CF",     color:C.green,   desc:"NOI minus debt service and G&A. Clean operating cash flow."},
              {col:"LP Distribution",  color:"#5DADE2", desc:`LP's ${f.p(1-a.gpPct)} pro-rata share of operating CF`},
              {col:"GP Distribution",  color:C.gold,    desc:`GP's ${f.p(a.gpPct)} co-invest share of operating CF`},
              {col:"CapEx Cap. Calls", color:C.orange,  desc:"Separate LP capital calls for property improvements (not in op CF)"},
              {col:"LP Called (cumul)",color:C.whDim,   desc:"Cumulative LP capital drawn: acq + capex calls through quarter end"},
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
                    {h:"Quarter",           align:"left"},
                    {h:"Portfolio CF",      align:"right",color:C.green},
                    {h:"LP Distribution",  align:"right",color:"#5DADE2"},
                    {h:"GP Distribution",  align:"right",color:C.gold},
                    {h:"CapEx Cap. Calls", align:"right",color:C.orange},
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
                    const capexCall=mos.reduce((s,r)=>s+r.capxLP,0);
                    // Cumulate actual LP capital calls (acq + capex), not distributions
                    cumLP2+=mos.reduce((s,r)=>s+r.lpCall,0);
                    const yr=Math.floor(q/4)+1;
                    const qn=(q%4)+1;
                    qtrs.push({label:`Y${yr} Q${qn}`,portCF,lp,gp,capexCall,cumLP:Math.round(cumLP2)});
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
                        <td style={{padding:"5px 10px",textAlign:"right",
                          color:row.capexCall>0?C.orange:C.whDim}}>{row.capexCall>0?`(${f.$(row.capexCall)})`:"—"}</td>
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
                  <td style={{padding:"7px 10px",textAlign:"right",color:C.orange,fontWeight:700}}>({f.$(moDetail.reduce((s,r)=>s+r.capxLP,0))})</td>
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
        <CT c="Monthly Operating Draw Per Partner (positive CF months only)"/>
        <div style={{fontSize:9,color:C.textDim,marginBottom:8}}>
          Distribution from operating CF, separate from capital calls. Positive months only — capital calls appear as negative flows in the cumulative chart above.
        </div>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={m.partnerMonthly}>
            <XAxis dataKey="mo" tickFormatter={v=>v%12===0?`M${v}`:""} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false}/>
            <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}K`} tick={{fill:C.whDim,fontSize:9}} axisLine={false} tickLine={false} width={38}/>
            <Tooltip content={<TT/>}/>
            <ReferenceLine y={0} stroke="rgba(255,255,255,.2)"/>
            <Bar dataKey="draw" name="Draw/Partner" fill={C.blue} radius={[1,1,0,0]}/>
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
                  <Tooltip content={<TT formatters={{"LP IRR":v=>`${(v*100).toFixed(1)}%`}}/>}/>
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

/* ── Pipeline stages definition ─────────────────────────────────────────────── */
const STAGES=[
  {key:"watchlist",     label:"Watchlist",     short:"Watch",  color:"#0A2342", bg:"rgba(10,35,66,0.09)"},
  {key:"under_review",  label:"Under Review",  short:"Review", color:"#b45309", bg:"rgba(180,83,9,0.09)"},
  {key:"loi_sent",      label:"LOI Sent",      short:"LOI",    color:"#7c3aed", bg:"rgba(124,58,237,0.09)"},
  {key:"due_diligence", label:"Due Diligence", short:"DD",     color:"#0891b2", bg:"rgba(8,145,178,0.09)"},
  {key:"closed",        label:"Closed",        short:"Closed", color:"#16a34a", bg:"rgba(22,163,74,0.08)"},
  {key:"pass",          label:"Passed",        short:"Pass",   color:"#dc2626", bg:"rgba(220,38,38,0.06)"},
];

/* ── Acquisition score 0–100 (client-side) ──────────────────────────────────── */
function scoreMarina(m){
  let s=0;
  // Slips: log scale, max 25 at ~500 slips
  if(m.slips>0)s+=Math.min(25,Math.log10(Math.max(1,m.slips))/Math.log10(600)*25);
  // Hotel tier: 0-25
  const ts={"Ultra-Premium":25,"Premium Destination":20,"Strong Leisure":14,"Moderate":8,"Below National":3};
  s+=ts[m.hotel_market?.tier_label]||0;
  // ADR: 0-20, scale $108-$400
  if(m.hotel_market?.adr)s+=Math.min(20,Math.max(0,(m.hotel_market.adr-108)/(400-108)*20));
  // Occupancy: 0-15, scale 0-85%
  if(m.hotel_market?.occupancy)s+=Math.min(15,m.hotel_market.occupancy/0.85*15);
  // Reviews: log scale, 0-10
  if(m.reviews>0)s+=Math.min(10,Math.log10(Math.max(1,m.reviews))/Math.log10(200)*10);
  // Fuel dock: 0-5
  if(m.has_fuel_dock)s+=5;
  return Math.round(s);
}

/* ── Pipeline Tracker (Kanban by stage) ─────────────────────────────────────── */
function TabPipeline(){
  const [data,setData]=useState([]);
  const [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState(null);
  const [moving,setMoving]=useState(null);

  const relTime=(ts)=>{
    if(!ts)return"—";
    const d=new Date(ts),now=new Date(),diff=Math.round((now-d)/60000);
    if(diff<1)return"just now";if(diff<60)return`${diff}m ago`;
    const h=Math.round(diff/60);if(h<24)return`${h}h ago`;
    const days=Math.round(h/24);if(days<7)return`${days}d ago`;
    return d.toLocaleDateString("en-US",{month:"short",day:"numeric"});
  };
  const fmtActivity=(a)=>{
    if(!a)return null;
    const types={stage_change:"Stage changed",note_saved:"Note saved",outreach_logged:"Outreach logged"};
    return`${types[a.event_type]||a.event_type} · ${relTime(a.created_at)}`;
  };

  const load=useCallback(async()=>{
    setLoading(true);
    try{const r=await fetch("/api/pipeline");if(r.ok)setData(await r.json());}
    catch(e){}
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  const changeStage=useCallback(async(marinaId,newStage)=>{
    setMoving(marinaId);
    try{
      await fetch(`/api/marina-interest/${marinaId}`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({status:newStage})
      });
      const lbl=STAGES.find(s=>s.key===newStage)?.label||newStage;
      setData(prev=>prev.map(m=>m.marina_id===marinaId?{...m,status:newStage,stage_label:lbl}:m));
      setSelected(s=>s?.marina_id===marinaId?{...s,status:newStage,stage_label:lbl}:s);
    }catch(e){}
    setMoving(null);
  },[]);

  const byStage=useMemo(()=>{
    const map={};STAGES.forEach(s=>{map[s.key]=[];});
    data.forEach(m=>{if(map[m.status])map[m.status].push(m);});
    return map;
  },[data]);

  const totalActive=data.filter(m=>m.status!=="pass").length;
  const drawerOpen=!!selected;

  return(
    <div style={{padding:"24px 32px",minHeight:"calc(100vh - 52px)",background:C.bg,
      paddingRight:drawerOpen?360:32,transition:"padding-right .2s"}}>

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <h2 style={{margin:0,fontSize:22,fontWeight:800,color:C.text,fontFamily:"'DM Serif Display',serif"}}>Deal Pipeline</h2>
          <div style={{fontSize:12,color:C.textDim,marginTop:3}}>
            {loading?"Loading…":`${data.length} total · ${totalActive} active`}
          </div>
        </div>
        <button onClick={load} disabled={loading}
          style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,
            color:C.textDim,fontSize:11,fontWeight:600,cursor:"pointer"}}>
          {loading?"…":"↻ Refresh"}
        </button>
      </div>

      {/* Summary strip */}
      {!loading&&(<div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20}}>
        {STAGES.map(s=>{
          const cards=byStage[s.key]||[];
          const slips=cards.reduce((a,m)=>a+(m.slips||0),0);
          return(<div key={s.key} style={{background:cards.length?s.bg:C.surfaceAlt,
            border:`1px solid ${cards.length?s.color+"44":C.border}`,
            borderRadius:10,padding:"8px 14px",minWidth:96,textAlign:"center",flexShrink:0}}>
            <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",marginBottom:2,
              color:cards.length?s.color:C.textFaint}}>{s.label}</div>
            <div style={{fontSize:22,fontWeight:800,color:cards.length?s.color:C.textFaint}}>{cards.length}</div>
            {slips>0&&<div style={{fontSize:9,color:C.textDim,marginTop:1}}>{slips.toLocaleString()} slips</div>}
          </div>);
        })}
      </div>)}

      {/* Board */}
      {loading?(<div style={{textAlign:"center",padding:"60px 0",color:C.textDim,fontSize:13}}>Loading pipeline…</div>):
      data.length===0?(<div style={{textAlign:"center",padding:"60px 0"}}>
        <div style={{fontSize:42,marginBottom:12}}>🏗</div>
        <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:6}}>Pipeline is empty</div>
        <div style={{fontSize:12,color:C.textDim}}>Go to <strong>Targets</strong>, open a marina, and assign it a stage to see it here.</div>
      </div>):(
      <div style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:16,alignItems:"flex-start"}}>
        {STAGES.map(stage=>{
          const cards=byStage[stage.key]||[];
          const stageSlips=cards.reduce((a,m)=>a+(m.slips||0),0);
          return(<div key={stage.key} style={{minWidth:230,maxWidth:250,flexShrink:0}}>
            {/* Column header */}
            <div style={{background:stage.bg,border:`1px solid ${stage.color}44`,
              borderRadius:"10px 10px 0 0",padding:"9px 12px",
              display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:stage.color}}>{stage.label}</div>
                {stageSlips>0&&<div style={{fontSize:9,color:stage.color,opacity:.65,marginTop:1}}>{stageSlips.toLocaleString()} slips</div>}
              </div>
              <span style={{background:stage.color,color:"#fff",borderRadius:20,padding:"2px 8px",fontSize:10,fontWeight:800}}>{cards.length}</span>
            </div>
            {/* Cards column */}
            <div style={{background:C.surfaceAlt,border:`1px solid ${C.border}`,borderTop:"none",
              borderRadius:"0 0 10px 10px",minHeight:60,maxHeight:"calc(100vh - 295px)",
              overflowY:"auto",display:"flex",flexDirection:"column",gap:6,padding:6}}>
              {cards.length===0&&(<div style={{textAlign:"center",padding:"18px 8px",color:C.textFaint,fontSize:10}}>No deals</div>)}
              {cards.map(m=>{
                const score=scoreMarina(m);
                const isSelected=selected?.marina_id===m.marina_id;
                const isMoving=moving===m.marina_id;
                return(<div key={m.marina_id}
                  onClick={()=>setSelected(isSelected?null:m)}
                  style={{background:C.surface,border:`1.5px solid ${isSelected?stage.color:C.border}`,
                    borderRadius:8,padding:"9px 10px",cursor:"pointer",transition:"box-shadow .15s",
                    boxShadow:isSelected?`0 0 0 2px ${stage.color}33`:"0 1px 3px rgba(0,0,0,.05)",
                    opacity:isMoving?.45:1}}>
                  <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:2,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.name}</div>
                  <div style={{fontSize:9,color:C.textDim,marginBottom:5,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {[m.city,m.state].filter(Boolean).join(", ")}
                    {m.region&&<span style={{color:C.textFaint}}> · {m.region}</span>}
                  </div>
                  <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:m.notes||m.last_activity?5:0}}>
                    {m.slips!=null&&<span style={{background:C.accentDim,color:C.accent,padding:"1px 5px",borderRadius:7,fontSize:8,fontWeight:700}}>{m.slips.toLocaleString()} slips</span>}
                    <span style={{background:score>=70?"rgba(22,163,74,.1)":score>=50?C.accentDim:C.surfaceAlt,
                      color:score>=70?C.green:score>=50?C.accent:C.textDim,
                      padding:"1px 5px",borderRadius:7,fontSize:8,fontWeight:700}}>★ {score}</span>
                    {m.outreach_count>0&&<span style={{background:C.surfaceAlt,color:C.textFaint,padding:"1px 5px",borderRadius:7,fontSize:8,fontWeight:600}}>📞 {m.outreach_count}</span>}
                  </div>
                  {m.notes&&<div style={{fontSize:9,color:C.textDim,marginBottom:4,lineHeight:1.4,
                    overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{m.notes}</div>}
                  {m.last_activity&&<div style={{fontSize:8,color:C.textFaint,marginBottom:5}}>{fmtActivity(m.last_activity)}</div>}
                  {/* Move dropdown */}
                  <select value="" onClick={e=>e.stopPropagation()}
                    onChange={e=>{if(e.target.value)changeStage(m.marina_id,e.target.value);}}
                    disabled={isMoving}
                    style={{width:"100%",padding:"4px 6px",fontSize:9,border:`1px solid ${C.border}`,
                      borderRadius:5,background:C.surfaceAlt,color:C.textDim,cursor:"pointer",outline:"none"}}>
                    <option value="">Move to stage…</option>
                    {STAGES.filter(s=>s.key!==m.status).map(s=>(
                      <option key={s.key} value={s.key}>{s.label}</option>))}
                  </select>
                </div>);
              })}
            </div>
          </div>);
        })}
      </div>)}

      {/* Detail drawer */}
      {selected&&(()=>{
        const sg=STAGES.find(s=>s.key===selected.status);
        const score=scoreMarina(selected);
        return(
        <div style={{position:"fixed",top:52,right:0,width:330,height:"calc(100vh - 52px)",
          background:C.surface,borderLeft:`1px solid ${C.border}`,
          boxShadow:"-8px 0 32px rgba(0,0,0,.10)",zIndex:900,overflowY:"auto"}}>
          <div style={{padding:"18px 20px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
              <div style={{flex:1,minWidth:0,paddingRight:8}}>
                <div style={{fontSize:15,fontWeight:700,color:C.text,lineHeight:1.2}}>{selected.name}</div>
                <div style={{fontSize:11,color:C.textDim,marginTop:2}}>
                  {[selected.city,selected.state].filter(Boolean).join(", ")}{selected.region?` · ${selected.region}`:""}
                </div>
                {selected.address&&<div style={{fontSize:9,color:C.textFaint,marginTop:1}}>{selected.address}</div>}
              </div>
              <button onClick={()=>setSelected(null)}
                style={{border:"none",background:C.surfaceAlt,borderRadius:6,width:28,height:28,
                  fontSize:14,cursor:"pointer",color:C.textDim,flexShrink:0,
                  display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>

            {/* Badges */}
            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginBottom:14}}>
              {sg&&<span style={{background:sg.bg,color:sg.color,border:`1px solid ${sg.color}44`,
                padding:"3px 10px",borderRadius:20,fontSize:9,fontWeight:700}}>{sg.label}</span>}
              <span style={{background:score>=70?"rgba(22,163,74,.1)":score>=50?C.accentDim:C.surfaceAlt,
                color:score>=70?C.green:score>=50?C.accent:C.textDim,
                padding:"3px 10px",borderRadius:20,fontSize:9,fontWeight:700}}>Score {score}</span>
              {selected.outreach_count>0&&<span style={{fontSize:9,color:C.textDim}}>📞 {selected.outreach_count} contacts</span>}
            </div>

            {/* Stage buttons */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:9,fontWeight:700,color:C.textFaint,textTransform:"uppercase",letterSpacing:".05em",marginBottom:6}}>Move to stage</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {STAGES.map(s=>{const active=selected.status===s.key;return(
                  <button key={s.key} disabled={active||!!moving}
                    onClick={()=>changeStage(selected.marina_id,s.key)}
                    style={{padding:"4px 10px",borderRadius:16,fontSize:9,fontWeight:700,cursor:active?"default":"pointer",
                      background:active?s.color:s.bg,color:active?"#fff":s.color,
                      border:`1px solid ${s.color}55`,opacity:active?1:.85}}>{s.short}</button>);})}
              </div>
            </div>

            <div style={{height:1,background:C.border,marginBottom:14}}/>

            {/* Stats grid */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              {[["Slips",selected.slips?.toLocaleString()||"—"],
                ["Reviews",selected.reviews?.toLocaleString()||"—"],
                ["Fuel Dock",selected.has_fuel_dock?(selected.diesel?`$${selected.diesel.toFixed(2)}/gal`:"Yes"):"No"],
                ["Phone",selected.phone||"—"]].map(([l,v])=>(
                <div key={l}>
                  <div style={{fontSize:8,fontWeight:700,color:C.textFaint,textTransform:"uppercase",marginBottom:2}}>{l}</div>
                  <div style={{fontSize:11,fontWeight:600,color:C.text}}>{v}</div>
                </div>))}
            </div>

            {/* Hotel market */}
            {selected.hotel_market&&(<div style={{background:C.surfaceAlt,borderRadius:8,padding:"10px 12px",marginBottom:14}}>
              <div style={{fontSize:9,fontWeight:700,color:C.textFaint,textTransform:"uppercase",marginBottom:8}}>Hotel Market Proxy</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {[["Tier",selected.hotel_market.tier_label||"—"],
                  ["ADR",selected.hotel_market.adr?`$${selected.hotel_market.adr}`:"—"],
                  ["RevPAR",selected.hotel_market.revpar?`$${selected.hotel_market.revpar}`:"—"],
                  ["Occ",selected.hotel_market.occupancy?`${(selected.hotel_market.occupancy*100).toFixed(0)}%`:"—"]].map(([l,v])=>(
                  <div key={l}>
                    <div style={{fontSize:8,color:C.textFaint}}>{l}</div>
                    <div style={{fontSize:10,fontWeight:600,color:C.text}}>{v}</div>
                  </div>))}
              </div>
            </div>)}

            {/* Notes */}
            {selected.notes&&(<div style={{marginBottom:14}}>
              <div style={{fontSize:9,fontWeight:700,color:C.textFaint,textTransform:"uppercase",marginBottom:6}}>GP Notes</div>
              <div style={{fontSize:11,color:C.text,lineHeight:1.6,whiteSpace:"pre-wrap",background:C.surfaceAlt,borderRadius:8,padding:"8px 10px"}}>{selected.notes}</div>
            </div>)}

            {/* Activity */}
            {selected.last_activity&&(<div style={{marginBottom:14}}>
              <div style={{fontSize:9,fontWeight:700,color:C.textFaint,textTransform:"uppercase",marginBottom:4}}>Last Activity</div>
              <div style={{fontSize:10,color:C.textDim}}>{fmtActivity(selected.last_activity)}</div>
            </div>)}

            <div style={{fontSize:9,color:C.textFaint,marginBottom:14}}>Last updated {relTime(selected.updated_at)}</div>

            {selected.source_url&&(<a href={selected.source_url} target="_blank" rel="noopener"
              style={{display:"block",padding:"9px 12px",background:C.surfaceAlt,border:`1px solid ${C.border}`,
                borderRadius:8,fontSize:10,fontWeight:600,color:C.textDim,textDecoration:"none",textAlign:"center"}}>
              View on Marinas.com ↗
            </a>)}
          </div>
        </div>);
      })()}
    </div>);
}

/* ── Gradient color helper ──────────────────────────────────────────────────── */
function heatColor(t){
  // 0 = light ice blue, 1 = dark navy
  const r=Math.round(191+(10-191)*t);const g=Math.round(219+(35-219)*t);const b=Math.round(254+(66-254)*t);
  return `rgb(${r},${g},${b})`;
}

/* ── Full marina overview map (OSM tiles, all filtered locations) ───────────── */
function TargetsMapView({marinas,interestMap,onSelect}){
  const divRef=useRef(null);const mapRef=useRef(null);const markersRef=useRef([]);
  const [colorBy,setColorBy]=useState("stage"); // stage|adr|revpar|score
  const withCoords=useMemo(()=>marinas.filter(m=>m.lat&&m.lon),[marinas]);

  // Compute min/max for gradient dimensions
  const {minVal,maxVal}=useMemo(()=>{
    if(colorBy==="stage")return{minVal:0,maxVal:1};
    const vals=withCoords.map(m=>
      colorBy==="adr"?m.hotel_market?.adr:
      colorBy==="revpar"?m.hotel_market?.revpar:
      colorBy==="score"?scoreMarina(m):0).filter(v=>v!=null&&v>0);
    if(!vals.length)return{minVal:0,maxVal:1};
    return{minVal:Math.min(...vals),maxVal:Math.max(...vals)};
  },[colorBy,withCoords]);

  // Ensure Leaflet loaded then init/refresh map
  useEffect(()=>{
    if(!divRef.current)return;
    const buildMap=()=>{
      // First call or re-init
      if(!mapRef.current){
        if(!document.getElementById("leaflet-css")){
          const lnk=document.createElement("link");lnk.id="leaflet-css";lnk.rel="stylesheet";
          lnk.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";document.head.appendChild(lnk);}
        mapRef.current=window.L.map(divRef.current,{zoomControl:true,attributionControl:true})
          .setView([38,-76],6);
        window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          {maxZoom:19,attribution:"© OpenStreetMap"}).addTo(mapRef.current);
      }
      // Clear old markers
      markersRef.current.forEach(m=>m.remove());markersRef.current=[];
      // Add new circle markers
      const bounds=[];
      withCoords.forEach(m=>{
        const status=interestMap[m.id]?.status;
        const stg=STAGES.find(s=>s.key===status);
        let color,fillOp,radius;
        if(colorBy==="stage"){
          color=stg?stg.color:"#94A3B8";fillOp=status?.92:.7;radius=status?6:4;
        } else {
          const rawVal=colorBy==="adr"?m.hotel_market?.adr:colorBy==="revpar"?m.hotel_market?.revpar:colorBy==="score"?scoreMarina(m):null;
          const t=rawVal!=null&&maxVal>minVal?(rawVal-minVal)/(maxVal-minVal):0;
          color=heatColor(t);fillOp=.88;radius=5;
        }
        const metricLabel=colorBy==="adr"?`ADR $${m.hotel_market?.adr||"—"}`:colorBy==="revpar"?`RevPAR $${m.hotel_market?.revpar||"—"}`:colorBy==="score"?`Score ${scoreMarina(m)}`:"";
        const cm=window.L.circleMarker([m.lat,m.lon],{
          radius,fillColor:color,color:"#fff",weight:1.5,fillOpacity:fillOp})
          .addTo(mapRef.current)
          .bindTooltip(`<strong>${m.name}</strong><br/>${m.city}, ${m.state}${m.slips?`<br/>${m.slips} slips`:""}${stg&&colorBy==="stage"?`<br/><em>${stg.label}</em>`:""}${colorBy!=="stage"?`<br/>${metricLabel}`:""}`,
            {direction:"top",offset:[0,-4]});
        cm.on("click",()=>onSelect(m));
        markersRef.current.push(cm);bounds.push([m.lat,m.lon]);});
      if(bounds.length)mapRef.current.fitBounds(bounds,{padding:[24,24],maxZoom:10});
    };
    if(window.L){buildMap();}
    else{const s=document.createElement("script");s.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      s.onload=buildMap;document.head.appendChild(s);}
  },[withCoords,interestMap,onSelect,colorBy,minVal,maxVal]);

  // Destroy on unmount
  useEffect(()=>()=>{if(mapRef.current){mapRef.current.remove();mapRef.current=null;}},[]);

  return(
    <div style={{position:"relative"}}>
      {/* Toolbar */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
        <span style={{fontSize:10,fontWeight:700,color:C.textDim,textTransform:"uppercase",letterSpacing:".06em"}}>Color by</span>
        {["stage","adr","revpar","score"].map(k=>(
          <button key={k} onClick={()=>setColorBy(k)}
            style={{padding:"4px 12px",borderRadius:20,fontSize:10,fontWeight:600,cursor:"pointer",
              background:colorBy===k?C.navy:"transparent",color:colorBy===k?"#fff":C.textDim,
              border:`1px solid ${colorBy===k?C.navy:C.border}`}}>
            {k==="stage"?"Stage":k==="adr"?"Hotel ADR":k==="revpar"?"RevPAR":"Score"}
          </button>))}
      </div>
      <div ref={divRef} style={{height:"calc(100vh - 320px)",minHeight:440,borderRadius:12,
        overflow:"hidden",border:`1px solid ${C.border}`,boxShadow:"0 2px 12px rgba(0,0,0,.06)"}}/>
      {/* Legend */}
      <div style={{position:"absolute",bottom:20,right:20,background:"rgba(255,255,255,.95)",
        backdropFilter:"blur(6px)",border:`1px solid ${C.border}`,borderRadius:10,
        padding:"10px 14px",fontSize:10,fontWeight:600,display:"flex",flexDirection:"column",gap:5,zIndex:999}}>
        {colorBy==="stage"?(<>
          <div style={{color:C.textFaint,textTransform:"uppercase",letterSpacing:".06em",marginBottom:2}}>Pipeline Stage</div>
          {[...STAGES.map(s=>([s.color,s.label])),["#94A3B8","Unreviewed"]].map(([col,lbl])=>(
            <div key={lbl} style={{display:"flex",alignItems:"center",gap:7}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:col,border:"1.5px solid #fff",boxShadow:"0 1px 3px rgba(0,0,0,.25)"}}/>
              <span style={{color:C.text}}>{lbl}</span>
            </div>))}
        </>):(<>
          <div style={{color:C.textFaint,textTransform:"uppercase",letterSpacing:".06em",marginBottom:4}}>
            {colorBy==="adr"?"ADR":colorBy==="revpar"?"RevPAR":"Score"}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"center"}}>
            <span style={{fontSize:9,color:C.textDim}}>{colorBy==="score"?Math.round(maxVal):`$${Math.round(maxVal)}`} (high)</span>
            <div style={{width:14,height:80,background:`linear-gradient(to top,${heatColor(0)},${heatColor(1)})`,borderRadius:4,margin:"2px 0"}}/>
            <span style={{fontSize:9,color:C.textDim}}>{colorBy==="score"?Math.round(minVal):`$${Math.round(minVal)}`} (low)</span>
          </div>
        </>)}
        <div style={{borderTop:`1px solid ${C.border}`,marginTop:3,paddingTop:5,color:C.textFaint}}>
          {withCoords.length.toLocaleString()} locations
        </div>
      </div>
    </div>);
}

/* ── Leaflet aerial satellite map (ESRI tiles, no API key) ─────────────────── */
function AerialMap({lat,lon,name}){
  const divRef=useRef(null);const mapRef=useRef(null);
  useEffect(()=>{
    if(!lat||!lon)return;
    if(!document.getElementById("leaflet-css")){
      const l=document.createElement("link");l.id="leaflet-css";l.rel="stylesheet";
      l.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";document.head.appendChild(l);}
    const init=()=>{
      if(!divRef.current)return;
      if(mapRef.current){mapRef.current.remove();mapRef.current=null;}
      const map=window.L.map(divRef.current,{zoomControl:true,attributionControl:false}).setView([lat,lon],16);
      window.L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {maxZoom:19}).addTo(map);
      const icon=window.L.divIcon({html:`<div style="width:14px;height:14px;background:${C.accent};border:3px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>`,
        iconSize:[14,14],iconAnchor:[7,7],className:""});
      window.L.marker([lat,lon],{icon}).addTo(map).bindPopup(name,{closeButton:false,offset:[0,-4]});
      mapRef.current=map;};
    if(window.L){init();}
    else{const s=document.createElement("script");s.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      s.onload=init;document.head.appendChild(s);}
    return()=>{if(mapRef.current){mapRef.current.remove();mapRef.current=null;}};
  },[lat,lon,name]);
  return <div ref={divRef} style={{height:220,borderRadius:"12px 12px 0 0",overflow:"hidden",background:C.surfaceAlt}}/>;
}

function TabTargets({a,setA}){
  const [marinas,setMarinas]=useState([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState("");
  const [stateFilter,setStateFilter]=useState("");
  const [regionFilter,setRegionFilter]=useState("");
  const [viewMode,setViewMode]=useState("all"); // all|watchlist|under_review|loi_sent|due_diligence|closed|pass|unreviewed
  const [fuelOnly,setFuelOnly]=useState(false);
  const [slipsMin,setSlipsMin]=useState(0);
  const [reviewsMin,setReviewsMin]=useState(0);
  const [hotelTier,setHotelTier]=useState("");
  const [hasRates,setHasRates]=useState(false);
  const [showFilters,setShowFilters]=useState(false);
  const [sortBy,setSortBy]=useState("name");
  const [page,setPage]=useState(0);
  const [selected,setSelected]=useState(null);
  const [popupNotes,setPopupNotes]=useState("");
  const [savingNote,setSavingNote]=useState(false);
  const [interestMap,setInterestMap]=useState({}); // {marina_id: {status, notes}}
  const [showMap,setShowMap]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [uploadMsg,setUploadMsg]=useState("");
  const [showUpload,setShowUpload]=useState(false);
  const [showAnalytics,setShowAnalytics]=useState(false);
  const [showComps,setShowComps]=useState(false);
  const [popupTab,setPopupTab]=useState("details"); // details|outreach|activity
  const [outreachLog,setOutreachLog]=useState([]);
  const [activityLog,setActivityLog]=useState([]);
  const [outreachForm,setOutreachForm]=useState({contact_date:new Date().toISOString().split("T")[0],method:"call",contact_name:"",response_status:"no_response",notes:""});
  const [savingOutreach,setSavingOutreach]=useState(false);
  const PG=60;

  // Load marinas + interest tracking on mount
  useEffect(()=>{
    Promise.all([
      fetch("/api/marinas").then(r=>r.ok?r.json():null).catch(()=>null),
      fetch("/api/marina-interest").then(r=>r.ok?r.json():[]).catch(()=>[]),
    ]).then(([raw,interest])=>{
      if(raw){const p=parseMarinasJSON(raw);setMarinas(p);}
      const map={};(interest||[]).forEach(r=>{map[r.marina_id]={status:r.status,notes:r.notes||""};});
      setInterestMap(map);setLoading(false);
    });
  },[]);

  // When popup opens, pre-fill notes and load outreach/activity
  useEffect(()=>{
    if(selected){
      setPopupNotes(interestMap[selected.id]?.notes||"");
      setPopupTab("details");setShowComps(false);
      setOutreachLog([]);setActivityLog([]);
      setOutreachForm({contact_date:new Date().toISOString().split("T")[0],method:"call",contact_name:"",response_status:"no_response",notes:""});
      fetch(`/api/marina-outreach/${selected.id}`).then(r=>r.ok?r.json():[]).then(setOutreachLog).catch(()=>{});
      fetch(`/api/marina-activity/${selected.id}`).then(r=>r.ok?r.json():[]).then(setActivityLog).catch(()=>{});
    }
  },[selected]);

  const refreshActivity=useCallback((id)=>{
    fetch(`/api/marina-activity/${id}`).then(r=>r.ok?r.json():[]).then(setActivityLog).catch(()=>{});
  },[]);

  const setStage=useCallback(async(marina,stage)=>{
    const cur=interestMap[marina.id];
    if(cur?.status===stage){
      setInterestMap(p=>{const n={...p};delete n[marina.id];return n;});
      await fetch(`/api/marina-interest/${marina.id}`,{method:"DELETE"});
    } else {
      const notes=cur?.notes||"";
      setInterestMap(p=>({...p,[marina.id]:{status:stage,notes}}));
      await fetch(`/api/marina-interest/${marina.id}`,{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({status:stage,notes})});
    }
    if(selected?.id===marina.id)refreshActivity(marina.id);
  },[interestMap,selected,refreshActivity]);

  const saveNote=useCallback(async(marina,notes)=>{
    setSavingNote(true);
    const status=interestMap[marina.id]?.status||"watchlist";
    setInterestMap(p=>({...p,[marina.id]:{status,notes}}));
    await fetch(`/api/marina-interest/${marina.id}`,{method:"POST",
      headers:{"Content-Type":"application/json"},body:JSON.stringify({status,notes})});
    setSavingNote(false);
    if(selected?.id===marina.id)refreshActivity(marina.id);
  },[interestMap,selected,refreshActivity]);

  const addOutreach=useCallback(async()=>{
    if(!selected)return;
    setSavingOutreach(true);
    const res=await fetch(`/api/marina-outreach/${selected.id}`,{method:"POST",
      headers:{"Content-Type":"application/json"},body:JSON.stringify(outreachForm)});
    if(res.ok){
      const rows=await fetch(`/api/marina-outreach/${selected.id}`).then(r=>r.json()).catch(()=>[]);
      setOutreachLog(rows);
      refreshActivity(selected.id);
      setOutreachForm({contact_date:new Date().toISOString().split("T")[0],method:"call",contact_name:"",response_status:"no_response",notes:""});
    }
    setSavingOutreach(false);
  },[selected,outreachForm,refreshActivity]);

  const deleteOutreach=useCallback(async(entryId)=>{
    if(!selected)return;
    await fetch(`/api/marina-outreach/${selected.id}/${entryId}`,{method:"DELETE"});
    setOutreachLog(p=>p.filter(e=>e.id!==entryId));
  },[selected]);

  const exportPDF=useCallback((marina,notes)=>{
    const existing=document.getElementById("__gp_tearsheet");
    if(existing)existing.remove();
    const esc=(s)=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
    const score=scoreMarina(marina);
    const stage=STAGES.find(s=>s.key===interestMap[marina.id]?.status);
    const hm=marina.hotel_market;
    const today=new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});
    const scoreColor=score>=70?"#059669":score>=50?"#0891b2":"#94a3b8";
    const scoreBg=score>=70?"rgba(5,150,105,.1)":score>=50?"rgba(8,145,178,.1)":"rgba(148,163,184,.1)";
    const addrParts=[marina.address,marina.city&&marina.state?`${marina.city}, ${marina.state}`:marina.city||marina.state].filter(Boolean);
    const addressLine=addrParts.map(esc).join("  ·  ");
    const locationLine=[marina.region,marina.harbor].filter(Boolean).map(esc).join("  ·  ");
    const stageBadge=stage?`<span style="display:inline-block;background:${stage.bg};color:${stage.color};border:1px solid ${stage.color}55;padding:3px 10px;border-radius:20px;font-size:9px;font-weight:700;letter-spacing:.04em">${esc(stage.label)}</span>`:"";
    // Score arc SVG
    const arcR=28,arcC=36,arcStroke=6;
    const arcCirc=2*Math.PI*arcR;
    const arcDash=arcCirc*(score/100);
    const scoreSVG=`<svg width="72" height="72" viewBox="0 0 72 72" style="transform:rotate(-90deg)">
      <circle cx="${arcC}" cy="${arcC}" r="${arcR}" fill="none" stroke="#e2e8f0" stroke-width="${arcStroke}"/>
      <circle cx="${arcC}" cy="${arcC}" r="${arcR}" fill="none" stroke="${scoreColor}" stroke-width="${arcStroke}"
        stroke-dasharray="${arcDash} ${arcCirc}" stroke-linecap="round"/>
    </svg>`;
    // Stat box helper
    const statBox=(l,v)=>v&&v!=="—"?`<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;min-width:0">
      <div style="font-size:8px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">${l}</div>
      <div style="font-size:13px;font-weight:700;color:#1a2e44;line-height:1">${v}</div>
    </div>`:"";
    // Section header helper
    const secHdr=(t,accent)=>`<div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:${accent||"#94a3b8"};margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid ${accent?accent+"22":"#e2e8f0"}">${t}</div>`;
    // Row item for detail tables
    const dRow=(l,v)=>v?`<div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid #f1f5f9">
      <span style="font-size:10px;color:#64748b">${l}</span>
      <span style="font-size:10px;font-weight:600;color:#1a2e44">${v}</span>
    </div>`:"";

    // Build tile map URL — only numeric coords used
    let tileUrl="";
    if(marina.lat&&marina.lon){
      const z=15,n=Math.pow(2,z);
      const tx=Math.floor((marina.lon+180)/360*n);
      const latR=marina.lat*Math.PI/180;
      const ty=Math.floor((1-Math.log(Math.tan(latR)+1/Math.cos(latR))/Math.PI)/2*n);
      tileUrl=`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
    }

    const buildAndPrint=(mapDataUrl)=>{
      const mapBlock=mapDataUrl
        ?`<div style="margin-bottom:18px;border-radius:8px;overflow:hidden;border:1px solid #cbd5e1;height:160px;background:#dbeafe;position:relative">
            <img src="${mapDataUrl}" style="width:100%;height:100%;object-fit:cover;display:block"/>
            ${marina.lat&&marina.lon?`<div style="position:absolute;bottom:6px;right:8px;background:rgba(10,35,66,.75);color:#fff;font-size:8px;padding:2px 6px;border-radius:4px">${marina.lat.toFixed(5)}, ${marina.lon.toFixed(5)}</div>`:""}
          </div>`
        :"";

      const tierbadge=hm?.tier?`<span style="display:inline-block;background:#0a234222;color:#0a2342;border:1px solid #0a234244;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700;margin-left:6px">${esc(hm.tier)}</span>`:"";
      const confColor=hm?.data_confidence==="high"?"#059669":hm?.data_confidence==="medium"?"#b45309":"#94a3b8";

      const amenityChips=(marina.amenities||[]).map(a=>`<span style="display:inline-block;background:#f1f5f9;border:1px solid #e2e8f0;color:#475569;font-size:8px;font-weight:600;padding:2px 7px;border-radius:10px;margin:1px">${esc(a)}</span>`).join("");
      const ratesHtml=marina.dockage_rates?Object.entries(marina.dockage_rates).map(([k,v])=>
        `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:5px;padding:5px 8px;display:inline-block;margin:2px">
          <div style="font-size:8px;color:#0284c7;text-transform:uppercase;font-weight:700">${esc(k.replace(/_/g," "))}</div>
          <div style="font-size:11px;font-weight:700;color:#1a2e44">${typeof v==="number"?`$${esc(String(v))}`:esc(String(v))}</div>
        </div>`).join(""):"";

      const div=document.createElement("div");div.id="__gp_tearsheet";
      div.style.cssText="display:none;font-family:'DM Sans',sans-serif;";
      div.innerHTML=`
        <style>
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=DM+Serif+Display&display=swap');
          @media print{
            body>*:not(#__gp_tearsheet){display:none!important;}
            #__gp_tearsheet{display:block!important;}
            *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
          }
        </style>
        <div style="max-width:720px;margin:0 auto;padding:0;font-family:'DM Sans',sans-serif;color:#1a2e44">

          <!-- HEADER BAR -->
          <div style="background:#0a2342;color:#fff;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;border-radius:10px 10px 0 0">
            <div>
              <div style="font-size:8px;font-weight:700;letter-spacing:.14em;color:#d4af37;text-transform:uppercase;margin-bottom:2px">GP Fund I · Marina Acquisition</div>
              <div style="font-size:10px;font-weight:600;color:rgba(255,255,255,.6);letter-spacing:.04em">DEAL TEARSHEET — CONFIDENTIAL</div>
            </div>
            <div style="font-size:9px;color:rgba(255,255,255,.5)">${esc(today)}</div>
          </div>

          <!-- PROPERTY HERO -->
          <div style="background:linear-gradient(135deg,#f8fafc 0%,#f1f5f9 100%);border:1px solid #e2e8f0;border-top:none;padding:20px 24px;display:flex;gap:20px;align-items:flex-start">
            <div style="flex:1;min-width:0">
              ${stageBadge?stageBadge+"<br style='margin-bottom:4px'/>":""}
              <div style="font-size:24px;font-weight:800;color:#0a2342;line-height:1.1;margin-top:${stage?6:0}px">${esc(marina.name)}</div>
              ${addressLine?`<div style="font-size:11px;color:#475569;margin-top:5px;font-weight:500">${addressLine}</div>`:""}
              ${locationLine?`<div style="font-size:10px;color:#94a3b8;margin-top:2px">${locationLine}</div>`:""}
              ${marina.phone||marina.vhf||marina.website?`<div style="margin-top:8px;font-size:10px;color:#64748b;display:flex;gap:14px;flex-wrap:wrap">
                ${marina.phone?`<span>📞 ${esc(marina.phone)}</span>`:""}
                ${marina.vhf?`<span>📻 ${esc(marina.vhf)}</span>`:""}
                ${marina.website?`<span>🌐 ${esc(marina.website)}</span>`:""}
              </div>`:""}
            </div>
            <div style="text-align:center;flex-shrink:0;position:relative;width:72px">
              ${scoreSVG}
              <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center">
                <div style="font-size:17px;font-weight:800;color:${scoreColor};line-height:1">${score}</div>
                <div style="font-size:6px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em">score</div>
              </div>
            </div>
          </div>

          <!-- MAP -->
          ${mapBlock}

          <!-- GOV BANNER -->
          ${marina.is_public?`<div style="background:rgba(220,38,38,.06);border:1px solid rgba(220,38,38,.25);border-radius:7px;padding:9px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10">
            <span style="font-size:11px;font-weight:700;color:#dc2626">⚠ Government Owned — Not Acquirable</span>
            ${marina.operator_type?`<span style="font-size:9px;font-weight:700;background:rgba(220,38,38,.1);color:#dc2626;padding:2px 8px;border-radius:10px">${esc(marina.operator_type)}</span>`:""}
            ${marina.operator_confidence?`<span style="font-size:9px;color:#64748b;margin-left:auto">Confidence: ${esc(marina.operator_confidence)}</span>`:""}
          </div>`:""}

          <!-- KEY STATS BAR -->
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:18px;padding:0 0">
            ${statBox("Slips",marina.slips!=null?marina.slips.toLocaleString():null)}
            ${statBox("Max LOA",marina.max_loa?`${marina.max_loa} ft`:null)}
            ${statBox("Approach",marina.approach_depth?`${marina.approach_depth} ft`:null)}
            ${statBox("Reviews",marina.reviews!=null?marina.reviews.toLocaleString():null)}
            ${statBox("Fuel",marina.has_fuel_dock?(marina.diesel?`$${marina.diesel.toFixed(2)}/gal`:"Yes"):"No")}
          </div>

          <!-- TWO-COLUMN BODY -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px">

            <!-- Marina Details -->
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px">
              ${secHdr("Marina Details","#0a2342")}
              ${dRow("Slips",marina.slips!=null?marina.slips.toLocaleString():null)}
              ${dRow("Linear Ft",marina.linear_ft?`${marina.linear_ft.toLocaleString()} ft`:null)}
              ${dRow("Moorings",marina.moorings!=null?String(marina.moorings):null)}
              ${dRow("Max LOA",marina.max_loa?`${marina.max_loa} ft`:null)}
              ${dRow("Max Slip Length",marina.max_slip_length?`${marina.max_slip_length} ft`:null)}
              ${dRow("Max Slip Width",marina.max_slip_width?`${marina.max_slip_width} ft`:null)}
              ${dRow("Approach Depth",marina.approach_depth?`${marina.approach_depth} ft`:null)}
              ${dRow("Dock Depth",marina.dock_depth?`${marina.dock_depth} ft`:null)}
              ${dRow("Harbor",marina.harbor?esc(marina.harbor):null)}
              ${dRow("VHF",marina.vhf?esc(marina.vhf):null)}
              ${dRow("Fuel",marina.has_fuel_dock?(marina.diesel?`Diesel $${marina.diesel.toFixed(2)}/gal`:(marina.gas?`${esc(marina.gas_type||"Gas")} $${marina.gas.toFixed(2)}/gal`:"Yes")):"No")}
              ${marina.fuel_updated?dRow("Fuel Updated",esc(marina.fuel_updated)):""}
              ${dRow("Reviews",marina.reviews!=null?marina.reviews.toLocaleString():null)}
            </div>

            <!-- Hotel Market -->
            ${hm?`<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #e2e8f0">
                <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#0a2342">Hotel Market Proxy</div>
                <span style="font-size:8px;font-weight:700;padding:2px 7px;border-radius:8px;
                  background:${hm.data_confidence==="high"?"rgba(5,150,105,.1)":hm.data_confidence==="medium"?"rgba(180,83,9,.1)":"rgba(148,163,184,.1)"};
                  color:${confColor}">${esc((hm.data_confidence||"").toUpperCase())} CONF</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
                ${statBox("ADR",hm.adr?`$${hm.adr}`:null)}
                ${statBox("RevPAR",hm.revpar?`$${hm.revpar}`:null)}
                ${statBox("Occupancy",hm.occupancy?`${(hm.occupancy*100).toFixed(0)}%`:null)}
                ${statBox("Demand Score",hm.demand_score?hm.demand_score.toFixed(1):null)}
              </div>
              ${dRow("Market",hm.market_name?esc(hm.market_name)+(tierbadge||""):null)}
              ${dRow("Tier",hm.tier_label?esc(hm.tier_label):null)}
              ${dRow("Seasonality",hm.seasonality?esc(hm.seasonality.replace(/_/g," ")):null)}
              ${dRow("Supply",hm.supply_constrained!=null?(hm.supply_constrained?"Constrained":"Open"):null)}
              ${hm.source?`<div style="margin-top:8px;padding-top:6px;border-top:1px solid #f1f5f9">
                <div style="font-size:8px;color:#94a3b8;text-transform:uppercase;font-weight:700;margin-bottom:2px">Source</div>
                <div style="font-size:9px;color:#64748b;line-height:1.4">${esc(hm.source)}</div>
                ${hm.data_as_of?`<div style="font-size:8px;color:#94a3b8;margin-top:2px">${esc(hm.data_as_of)}</div>`:""}
              </div>`:""}
            </div>`:`<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;display:flex;align-items:center;justify-content:center">
              <div style="text-align:center;color:#94a3b8;font-size:11px">No hotel market data</div>
            </div>`}
          </div>

          <!-- DOCKAGE RATES -->
          ${marina.dockage_rates&&ratesHtml?`<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:18px">
            ${secHdr("Dockage Rates","#0891b2")}
            <div style="display:flex;flex-wrap:wrap;gap:4px">${ratesHtml}</div>
          </div>`:""}

          <!-- AMENITIES -->
          ${(marina.amenities||[]).length>0?`<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:18px">
            ${secHdr("Amenities")}
            <div style="line-height:1.8">${amenityChips}</div>
          </div>`:""}

          <!-- ABOUT -->
          ${marina.about?`<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:18px">
            ${secHdr("About")}
            <div style="font-size:10.5px;color:#475569;line-height:1.7">${esc(marina.about)}</div>
          </div>`:""}

          <!-- NOTES -->
          ${notes?`<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;margin-bottom:18px">
            ${secHdr("GP Notes","#b45309")}
            <div style="font-size:10.5px;color:#1a2e44;line-height:1.7;white-space:pre-wrap">${esc(notes)}</div>
          </div>`:""}

          <!-- FOOTER -->
          <div style="background:#0a2342;border-radius:0 0 10px 10px;padding:10px 24px;display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:8px;color:rgba(255,255,255,.4);letter-spacing:.04em">GP FUND I · CONFIDENTIAL · INTERNAL USE ONLY${marina.scraped_at?` · Data scraped ${esc(new Date(marina.scraped_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}))}`:""}</div>
            ${marina.source_url?`<a href="${esc(marina.source_url)}" style="font-size:8px;color:rgba(255,255,255,.35)">Marinas.com ↗</a>`:""}
          </div>

        </div>`;

      document.body.appendChild(div);
      window.addEventListener("afterprint",()=>{const el=document.getElementById("__gp_tearsheet");if(el)el.remove();},{once:true});
      window.print();
    };

    // Preload aerial map tile — wait for decode before printing so the image actually shows
    if(tileUrl){
      const img=new Image();img.crossOrigin="anonymous";
      const canvas=document.createElement("canvas");canvas.width=720;canvas.height=160;
      const ctx=canvas.getContext("2d");
      const onLoad=()=>{
        try{ctx.drawImage(img,0,0,720,160);buildAndPrint(canvas.toDataURL("image/jpeg",.9));}
        catch(e){buildAndPrint(tileUrl);}  // CORS blocked — fall back to src URL
      };
      img.onload=onLoad;img.onerror=()=>buildAndPrint(tileUrl);
      img.src=tileUrl;
      // Safety timeout: print even if tile takes too long
      setTimeout(()=>{if(!document.getElementById("__gp_tearsheet"))buildAndPrint(tileUrl);},4000);
    } else {
      buildAndPrint("");
    }
  },[interestMap]);

  const handleUpload=useCallback(async(file)=>{if(!file)return;setUploading(true);setUploadMsg("Parsing...");
    try{
      const text=await file.text();const raw=JSON.parse(text);const p=parseMarinasJSON(raw);
      if(p.length===0)throw new Error("No valid marina records found in file");
      setUploadMsg(`Saving ${p.length.toLocaleString()} marinas to server...`);
      const res=await fetch("/api/marinas",{method:"POST",headers:{"Content-Type":"application/json"},body:text});
      if(!res.ok)throw new Error("Server save failed");
      setMarinas(p);setPage(0);setShowUpload(false);
      setUploadMsg(`Loaded ${p.length.toLocaleString()} marinas`);
    }catch(e){setUploadMsg(`Error: ${e.message}`);}
    setUploading(false);
  },[]);

  // Derived filter options
  const stateCounts=useMemo(()=>{const c={};marinas.forEach(m=>{c[m.state]=(c[m.state]||0)+1;});
    return Object.entries(c).sort((a,b)=>b[1]-a[1]);},[marinas]);
  const regionsByState=useMemo(()=>{const c={};marinas.forEach(m=>{
    if(stateFilter&&m.state!==stateFilter)return;
    if(m.region)c[m.region]=(c[m.region]||0)+1;});
    return Object.entries(c).sort((a,b)=>b[1]-a[1]);},[marinas,stateFilter]);
  const hotelTiers=useMemo(()=>{const s=new Set();marinas.forEach(m=>{
    if(m.hotel_market?.tier_label)s.add(m.hotel_market.tier_label);});return [...s].sort();},[marinas]);

  const stageCounts=useMemo(()=>{
    const c={};STAGES.forEach(s=>{c[s.key]=0;});
    Object.values(interestMap).forEach(v=>{if(c[v.status]!==undefined)c[v.status]++;});
    return c;
  },[interestMap]);
  const pipelineCount=useMemo(()=>Object.values(stageCounts).reduce((a,b)=>a+b,0),[stageCounts]);
  const unrevCount=useMemo(()=>marinas.length-pipelineCount,[marinas,pipelineCount]);

  const filtered=useMemo(()=>{
    let list=marinas;
    const stageKeys=new Set(STAGES.map(s=>s.key));
    if(stageKeys.has(viewMode))list=list.filter(m=>interestMap[m.id]?.status===viewMode);
    else if(viewMode==="unreviewed")list=list.filter(m=>!interestMap[m.id]);
    if(search){const s=search.toLowerCase();
      list=list.filter(m=>(m.name+m.city+m.state+(m.address||"")+(m.harbor||"")+(m.region||"")).toLowerCase().includes(s));}
    if(stateFilter)list=list.filter(m=>m.state===stateFilter);
    if(regionFilter)list=list.filter(m=>m.region===regionFilter);
    if(fuelOnly)list=list.filter(m=>m.has_fuel_dock);
    if(slipsMin>0)list=list.filter(m=>m.slips!=null&&m.slips>=slipsMin);
    if(reviewsMin>0)list=list.filter(m=>m.reviews>=reviewsMin);
    if(hotelTier)list=list.filter(m=>m.hotel_market?.tier_label===hotelTier);
    if(hasRates)list=list.filter(m=>m.dockage_rates);
    const sorted=[...list];
    if(sortBy==="name")sorted.sort((a,b)=>a.name.localeCompare(b.name));
    else if(sortBy==="slips")sorted.sort((a,b)=>(b.slips||0)-(a.slips||0));
    else if(sortBy==="reviews")sorted.sort((a,b)=>(b.reviews||0)-(a.reviews||0));
    else if(sortBy==="region")sorted.sort((a,b)=>(a.region||"").localeCompare(b.region||"")||a.name.localeCompare(b.name));
    else if(sortBy==="adr")sorted.sort((a,b)=>(b.hotel_market?.adr||0)-(a.hotel_market?.adr||0));
    else if(sortBy==="score")sorted.sort((a,b)=>scoreMarina(b)-scoreMarina(a));
    return sorted;
  },[marinas,search,stateFilter,regionFilter,viewMode,fuelOnly,slipsMin,reviewsMin,hotelTier,hasRates,sortBy,interestMap]);

  const paged=filtered.slice(page*PG,(page+1)*PG);
  const totalPages=Math.ceil(filtered.length/PG);
  const addToDeal=useCallback((marina)=>{
    const deal={...DEF_ASSET_BASE,name:marina.name,price:4500000,cap:.075,
      startMonth:Math.min(72,Math.max(1,(a.assets||[]).length*2+1)),
      slips:marina.slips?[{type:"Marina Slips",count:marina.slips,rate:417,occ:.85,period:"y2"}]:[],
      lodging:[{type:"Hotel Units",units:15,adr:marina.hotel_market?.adr||325,occ:.247,period:"y1"},
        {type:"Hotel Units",units:30,adr:marina.hotel_market?.adr||325,occ:.411,period:"y2"}],
      upland:[],opex:[{label:"Hotel Operating Costs",amount:219375,growth:.03},{label:"Marina Operating Costs",amount:81250,growth:.05}],
      capexItems:[{label:"Hotel Conversion Ph1",amount:2600000,year:0},{label:"Hotel Conversion Ph2",amount:2600000,year:1}],
      targetSource:{id:marina.id,name:marina.name,city:marina.city,state:marina.state,slips:marina.slips,url:marina.source_url}};
    setA(p=>({...p,assets:[...p.assets,deal]}));setSelected(null);},[a,setA]);
  const isInDeals=useCallback((m)=>(a.assets||[]).some(d=>d.targetSource?.id===m.id),[a]);

  const activeFilters=[stateFilter&&`State: ${stateFilter}`,regionFilter&&`Region: ${regionFilter}`,
    fuelOnly&&"Fuel Dock",slipsMin>0&&`≥${slipsMin} slips`,reviewsMin>0&&`≥${reviewsMin} reviews`,
    hotelTier&&`Hotel: ${hotelTier}`,hasRates&&"Has Rates"].filter(Boolean);

  if(loading)return(
    <div><PHdr title="Acquisition Targets" sub="Loading marina database..."/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:300,gap:12,color:C.textDim,fontSize:13}}>
        <div style={{width:20,height:20,border:`2px solid ${C.border}`,borderTopColor:C.accent,borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
        Loading 5,500+ marinas…
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>);

  const interestStatus=selected?interestMap[selected.id]?.status:null;

  return(<div>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}`}</style>

    {/* HEADER */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,gap:12}}>
      <PHdr title="Acquisition Targets"
        sub={`${marinas.length.toLocaleString()} marinas · ${stateCounts.length} states · ${pipelineCount} in pipeline · ${unrevCount.toLocaleString()} unreviewed`}/>
      <div style={{display:"flex",gap:6,flexShrink:0}}>
        <button onClick={()=>setShowMap(false)}
          style={{padding:"7px 14px",borderRadius:"7px 0 0 7px",fontSize:10,fontWeight:700,cursor:"pointer",
            background:!showMap?C.navy:"transparent",color:!showMap?"#fff":C.textDim,
            border:`1px solid ${!showMap?C.navy:C.border}`,letterSpacing:".04em"}}>☰ LIST</button>
        <button onClick={()=>setShowMap(true)}
          style={{padding:"7px 14px",borderRadius:"0 7px 7px 0",fontSize:10,fontWeight:700,cursor:"pointer",
            background:showMap?C.navy:"transparent",color:showMap?"#fff":C.textDim,
            border:`1px solid ${showMap?C.navy:C.border}`,marginLeft:-1,letterSpacing:".04em"}}>🗺 MAP</button>
        <button onClick={()=>{setShowUpload(v=>!v);setUploadMsg("");}}
          style={{padding:"7px 14px",background:"transparent",color:C.textDim,
            border:`1px solid ${C.border}`,borderRadius:7,fontSize:10,fontWeight:700,
            cursor:"pointer",letterSpacing:".04em",textTransform:"uppercase"}}>
          ↑ DB
        </button>
      </div>
    </div>

    {/* UPLOAD PANEL */}
    {showUpload&&(<Card style={{padding:"20px 24px",marginBottom:16,border:`1px solid ${C.border}`}}>
      <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:8}}>Upload New Marina Database (v3 JSON)</div>
      <label style={{display:"inline-flex",alignItems:"center",gap:8,padding:"8px 20px",
        background:C.navy,color:"#fff",borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer"}}>
        {uploading?"Uploading…":"Choose File (.json)"}
        <input type="file" accept=".json" disabled={uploading} style={{display:"none"}}
          onChange={e=>{if(e.target.files[0])handleUpload(e.target.files[0]);}}/>
      </label>
      {uploadMsg&&<div style={{marginTop:10,fontSize:11,fontWeight:600,
        color:uploading?C.accent:uploadMsg.startsWith("Error")?"#dc2626":C.green}}>{uploadMsg}</div>}
    </Card>)}

    {/* VIEW MODE TABS */}
    <div style={{display:"flex",gap:4,marginBottom:14,borderBottom:`1px solid ${C.border}`,paddingBottom:10,flexWrap:"wrap"}}>
      {[{k:"all",label:`All`,count:marinas.length,color:C.navy},
        ...STAGES.map(s=>({k:s.key,label:s.short,count:stageCounts[s.key]||0,color:s.color,bg:s.bg})),
        {k:"unreviewed",label:"Unreviewed",count:unrevCount,color:C.textDim}
      ].map(({k,label,count,color,bg})=>{
        const active=viewMode===k;
        return(<button key={k} onClick={()=>{setViewMode(k);setPage(0);}}
          style={{padding:"5px 11px",borderRadius:6,fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",
            background:active?color:"transparent",color:active?"#fff":color,
            border:`1px solid ${active?color:C.border}`}}>
          {label} <span style={{opacity:.75,fontSize:9}}>({count.toLocaleString()})</span>
        </button>);})}
    </div>

    {/* PIPELINE FUNNEL BAR */}
    {!showMap&&pipelineCount>0&&(<div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,
      padding:"12px 16px",marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontSize:10,fontWeight:700,color:C.textDim,textTransform:"uppercase",letterSpacing:".06em"}}>
          Pipeline · {pipelineCount} marinas in funnel
        </div>
        <button onClick={()=>setShowAnalytics(v=>!v)}
          style={{fontSize:9,fontWeight:600,color:C.accent,background:"transparent",border:"none",cursor:"pointer",padding:"2px 6px"}}>
          {showAnalytics?"▲ Hide":"▼ Analytics"}
        </button>
      </div>
      <div style={{display:"flex",gap:6,alignItems:"stretch"}}>
        {STAGES.map(s=>{
          const cnt=stageCounts[s.key]||0;
          const slipTotal=marinas.filter(m=>interestMap[m.id]?.status===s.key).reduce((a,m)=>a+(m.slips||0),0);
          return(<div key={s.key} onClick={()=>{setViewMode(s.key);setPage(0);}} style={{flex:1,cursor:"pointer",
            background:cnt>0?s.bg:C.surfaceAlt,borderRadius:8,padding:"8px 6px",textAlign:"center",
            border:`1px solid ${cnt>0?s.color+"33":C.border}`,transition:"opacity .15s",opacity:cnt===0?.5:1}}>
            <div style={{fontSize:16,fontWeight:700,color:s.color}}>{cnt}</div>
            <div style={{fontSize:8,fontWeight:700,color:s.color,textTransform:"uppercase",letterSpacing:".05em",marginBottom:2}}>{s.label}</div>
            {slipTotal>0&&<div style={{fontSize:7,color:C.textFaint}}>{slipTotal.toLocaleString()} slips</div>}
          </div>);})}
      </div>
      {showAnalytics&&(<div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10}}>
          {STAGES.filter(s=>(stageCounts[s.key]||0)>0).map(s=>{
            const mList=marinas.filter(m=>interestMap[m.id]?.status===s.key);
            const avgADR=mList.filter(m=>m.hotel_market?.adr).reduce((a,m,_,arr)=>a+m.hotel_market.adr/arr.length,0);
            const totalSlips=mList.reduce((a,m)=>a+(m.slips||0),0);
            const topStates=[...mList.reduce((m2,m)=>{m2.set(m.state,(m2.get(m.state)||0)+1);return m2;},new Map())]
              .sort((a,b)=>b[1]-a[1]).slice(0,3).map(([st,c])=>`${st}(${c})`).join(", ");
            return(<div key={s.key} style={{background:s.bg,borderRadius:8,padding:"10px 12px",border:`1px solid ${s.color}33`}}>
              <div style={{fontSize:9,fontWeight:700,color:s.color,textTransform:"uppercase",marginBottom:6}}>{s.label}</div>
              <div style={{fontSize:11,color:C.text}}><strong>{stageCounts[s.key]}</strong> marinas</div>
              {totalSlips>0&&<div style={{fontSize:10,color:C.textDim}}>{totalSlips.toLocaleString()} total slips</div>}
              {avgADR>0&&<div style={{fontSize:10,color:C.textDim}}>Avg ADR ${avgADR.toFixed(0)}</div>}
              {topStates&&<div style={{fontSize:9,color:C.textFaint,marginTop:3}}>{topStates}</div>}
            </div>);})}
        </div>
      </div>)}
    </div>)}

    {/* SEARCH + SORT BAR */}
    <div style={{display:"flex",gap:8,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>
      <input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} placeholder="Search name, city, region, address…"
        style={{flex:1,minWidth:200,padding:"8px 14px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,fontSize:12,color:C.text,outline:"none"}}/>
      <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
        style={{padding:"8px 12px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,fontSize:11,color:C.text,cursor:"pointer",outline:"none"}}>
        <option value="name">Sort: Name</option><option value="score">Sort: Score ↓</option>
        <option value="slips">Sort: Most Slips</option><option value="reviews">Sort: Reviews</option>
        <option value="region">Sort: Sub-Market</option><option value="adr">Sort: Hotel ADR</option></select>
      <button onClick={()=>setShowFilters(v=>!v)}
        style={{padding:"8px 14px",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:5,
          background:showFilters||activeFilters.length?C.accentDim:C.surfaceAlt,
          color:showFilters||activeFilters.length?C.accent:C.textDim,
          border:`1px solid ${showFilters||activeFilters.length?C.accent:C.border}`}}>
        ⚙ Filters {activeFilters.length>0&&<span style={{background:C.accent,color:"#fff",borderRadius:10,padding:"1px 6px",fontSize:9,fontWeight:700}}>{activeFilters.length}</span>}
      </button>
      <span style={{fontSize:11,color:C.textFaint,fontWeight:600,whiteSpace:"nowrap"}}>{filtered.length.toLocaleString()} results</span>
    </div>

    {/* STATE PILLS */}
    <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:10}}>
      <button onClick={()=>{setStateFilter("");setRegionFilter("");setPage(0);}}
        style={{padding:"4px 12px",borderRadius:20,fontSize:10,fontWeight:600,cursor:"pointer",
          background:!stateFilter?C.accent:C.surfaceAlt,color:!stateFilter?"#fff":C.textDim,
          border:`1px solid ${!stateFilter?C.accent:C.border}`}}>All States</button>
      {stateCounts.map(([st,cnt])=>(<button key={st} onClick={()=>{setStateFilter(stateFilter===st?"":st);setRegionFilter("");setPage(0);}}
        style={{padding:"4px 10px",borderRadius:20,fontSize:10,fontWeight:600,cursor:"pointer",
          background:stateFilter===st?C.accent:C.surfaceAlt,color:stateFilter===st?"#fff":C.textDim,
          border:`1px solid ${stateFilter===st?C.accent:C.border}`}}>{st} <span style={{opacity:.7}}>({cnt})</span></button>))}
    </div>

    {/* ADVANCED FILTERS PANEL */}
    {showFilters&&(<Card style={{padding:"16px 20px",marginBottom:12,border:`1px solid ${C.border}`}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12}}>
        <div>
          <div style={{fontSize:9,fontWeight:700,color:C.textFaint,textTransform:"uppercase",marginBottom:5}}>Sub-Market / Region</div>
          <select value={regionFilter} onChange={e=>{setRegionFilter(e.target.value);setPage(0);}}
            style={{width:"100%",padding:"7px 10px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,fontSize:11,color:C.text,outline:"none"}}>
            <option value="">All Regions</option>
            {regionsByState.map(([r,c])=><option key={r} value={r}>{r} ({c})</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:9,fontWeight:700,color:C.textFaint,textTransform:"uppercase",marginBottom:5}}>Hotel Market Tier</div>
          <select value={hotelTier} onChange={e=>{setHotelTier(e.target.value);setPage(0);}}
            style={{width:"100%",padding:"7px 10px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,fontSize:11,color:C.text,outline:"none"}}>
            <option value="">All Tiers</option>
            {hotelTiers.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:9,fontWeight:700,color:C.textFaint,textTransform:"uppercase",marginBottom:5}}>Min Slips</div>
          <select value={slipsMin} onChange={e=>{setSlipsMin(Number(e.target.value));setPage(0);}}
            style={{width:"100%",padding:"7px 10px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,fontSize:11,color:C.text,outline:"none"}}>
            {[0,10,25,50,100,200,500].map(v=><option key={v} value={v}>{v===0?"Any":v+"+ slips"}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:9,fontWeight:700,color:C.textFaint,textTransform:"uppercase",marginBottom:5}}>Min Reviews</div>
          <select value={reviewsMin} onChange={e=>{setReviewsMin(Number(e.target.value));setPage(0);}}
            style={{width:"100%",padding:"7px 10px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,fontSize:11,color:C.text,outline:"none"}}>
            {[0,1,5,10,25,50].map(v=><option key={v} value={v}>{v===0?"Any":v+"+ reviews"}</option>)}
          </select>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8,justifyContent:"flex-end"}}>
          <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:11,color:C.text}}>
            <input type="checkbox" checked={fuelOnly} onChange={e=>{setFuelOnly(e.target.checked);setPage(0);}}/>
            Has Fuel Dock
          </label>
          <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:11,color:C.text}}>
            <input type="checkbox" checked={hasRates} onChange={e=>{setHasRates(e.target.checked);setPage(0);}}/>
            Has Dockage Rates
          </label>
        </div>
        {activeFilters.length>0&&<div style={{display:"flex",alignItems:"flex-end"}}>
          <button onClick={()=>{setStateFilter("");setRegionFilter("");setFuelOnly(false);setSlipsMin(0);setReviewsMin(0);setHotelTier("");setHasRates(false);setPage(0);}}
            style={{padding:"7px 14px",borderRadius:7,fontSize:11,fontWeight:600,cursor:"pointer",
              background:"transparent",color:"#dc2626",border:"1px solid #fca5a5"}}>✕ Clear All</button>
        </div>}
      </div>
      {activeFilters.length>0&&<div style={{marginTop:10,display:"flex",gap:5,flexWrap:"wrap"}}>
        {activeFilters.map(f=><span key={f} style={{background:C.accentDim,color:C.accent,padding:"2px 8px",borderRadius:10,fontSize:9,fontWeight:700}}>{f}</span>)}
      </div>}
    </Card>)}

    {/* REGION PILLS (when state selected) */}
    {stateFilter&&regionsByState.length>0&&(<div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:12}}>
      <button onClick={()=>{setRegionFilter("");setPage(0);}}
        style={{padding:"3px 10px",borderRadius:20,fontSize:9,fontWeight:600,cursor:"pointer",
          background:!regionFilter?C.navy:C.surfaceAlt,color:!regionFilter?"#fff":C.textDim,
          border:`1px solid ${!regionFilter?C.navy:C.border}`}}>All {stateFilter}</button>
      {regionsByState.slice(0,20).map(([r,c])=>(<button key={r} onClick={()=>{setRegionFilter(regionFilter===r?"":r);setPage(0);}}
        style={{padding:"3px 10px",borderRadius:20,fontSize:9,fontWeight:600,cursor:"pointer",
          background:regionFilter===r?C.navy:C.surfaceAlt,color:regionFilter===r?"#fff":C.textDim,
          border:`1px solid ${regionFilter===r?C.navy:C.border}`}}>{r} <span style={{opacity:.65}}>({c})</span></button>))}
    </div>)}

    {/* MAP VIEW */}
    {showMap&&(<TargetsMapView marinas={filtered} interestMap={interestMap} onSelect={setSelected}/>)}

    {/* MARINA GRID */}
    {!showMap&&(filtered.length===0?(<Card style={{padding:"40px",textAlign:"center"}}>
      <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:6}}>No marinas match</div>
      <div style={{fontSize:12,color:C.textDim}}>Try adjusting your filters or search.</div>
    </Card>):(
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(290px,1fr))",gap:10,marginBottom:16}}>
      {paged.map(m=>{
        const inD=isInDeals(m);
        const status=interestMap[m.id]?.status;
        const stageObj=STAGES.find(s=>s.key===status);
        const score=scoreMarina(m);
        const bdr=stageObj?stageObj.color:inD?C.green:C.border;
        const hm=m.hotel_market;
        return(
        <div key={m.id} onClick={()=>setSelected(m)}
          style={{background:C.surface,border:`1px solid ${bdr}`,borderRadius:10,padding:"13px 15px",
            cursor:"pointer",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",position:"relative",
            transition:"box-shadow .15s",opacity:status==="pass"?.6:1}}>
          <div style={{position:"absolute",top:8,right:8,display:"flex",gap:4,alignItems:"center"}}>
            <span style={{background:"#f1f5f9",color:C.textDim,padding:"2px 6px",borderRadius:8,fontSize:8,fontWeight:700}}>
              {score}
            </span>
            {stageObj&&<span style={{background:stageObj.bg,color:stageObj.color,padding:"2px 7px",borderRadius:10,fontSize:8,fontWeight:700,border:`1px solid ${stageObj.color}44`}}>{stageObj.label.toUpperCase()}</span>}
            {inD&&!status&&<span style={{background:C.greenL,color:C.green,padding:"2px 7px",borderRadius:10,fontSize:8,fontWeight:700}}>IN DEALS</span>}
          </div>
          <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:2,paddingRight:90,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.name}</div>
          <div style={{fontSize:10,color:C.textDim,marginBottom:7}}>{m.city}{m.city&&m.state?", ":""}{m.state}{m.region&&<span style={{color:C.textFaint}}> · {m.region}</span>}</div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:m.hotel_market?6:0}}>
            {m.slips!=null&&<span style={{background:C.accentDim,color:C.accent,padding:"2px 7px",borderRadius:12,fontSize:9,fontWeight:700}}>{m.slips} slips</span>}
            {m.slips==null&&m.linear_ft&&<span style={{background:C.accentDim,color:C.accent,padding:"2px 7px",borderRadius:12,fontSize:9,fontWeight:700}}>{m.linear_ft} ft</span>}
            {m.max_loa&&<span style={{background:C.surfaceAlt,color:C.textDim,padding:"2px 7px",borderRadius:12,fontSize:9,fontWeight:600}}>LOA {m.max_loa}'</span>}
            {m.has_fuel_dock&&<span style={{background:"rgba(8,145,178,0.08)",color:C.cyan,padding:"2px 7px",borderRadius:12,fontSize:9,fontWeight:700}}>{m.diesel?`⛽ $${m.diesel.toFixed(2)}`:"⛽ Fuel"}</span>}
            {m.reviews>0&&<span style={{background:C.surfaceAlt,color:C.textFaint,padding:"2px 7px",borderRadius:12,fontSize:9,fontWeight:600}}>★ {m.reviews}</span>}
          </div>
          {hm&&<div style={{fontSize:9,color:C.textDim,marginTop:3,fontWeight:500}}>
            <span style={{color:C.text,fontWeight:700}}>{hm.tier_label}</span>
            {hm.adr&&<span> · ADR ${hm.adr}</span>}
            {hm.revpar&&<span> · RevPAR ${hm.revpar}</span>}
            {hm.occupancy&&<span> · Occ {(hm.occupancy*100).toFixed(0)}%</span>}
          </div>}
        </div>);})}
    </div>))}

    {/* PAGINATION */}
    {!showMap&&totalPages>1&&(<div style={{display:"flex",justifyContent:"center",gap:6,marginBottom:16,alignItems:"center"}}>
      <button disabled={page===0} onClick={()=>setPage(p=>p-1)} style={{padding:"6px 14px",borderRadius:6,fontSize:11,fontWeight:600,
        border:`1px solid ${C.border}`,background:C.surface,color:C.textDim,cursor:page===0?"default":"pointer",opacity:page===0?.4:1}}>← Prev</button>
      <span style={{fontSize:11,color:C.textDim,minWidth:120,textAlign:"center"}}>Page {page+1} of {totalPages} · {filtered.length.toLocaleString()} results</span>
      <button disabled={page>=totalPages-1} onClick={()=>setPage(p=>p+1)} style={{padding:"6px 14px",borderRadius:6,fontSize:11,fontWeight:600,
        border:`1px solid ${C.border}`,background:C.surface,color:C.textDim,cursor:page>=totalPages-1?"default":"pointer",opacity:page>=totalPages-1?.4:1}}>Next →</button>
    </div>)}

    {/* POPUP MODAL */}
    {selected&&(<>
      <div onClick={()=>setSelected(null)}
        style={{position:"fixed",inset:0,background:"rgba(10,35,66,0.45)",backdropFilter:"blur(3px)",zIndex:1000}}/>
      <div style={{position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
        width:"min(680px,96vw)",maxHeight:"90vh",background:C.surface,borderRadius:16,
        boxShadow:"0 24px 80px rgba(0,0,0,0.22)",zIndex:1001,overflowY:"auto",animation:"fadeIn .18s ease"}}>

        {/* Aerial Map */}
        {(selected.lat&&selected.lon)?
          <AerialMap key={selected.id} lat={selected.lat} lon={selected.lon} name={selected.name}/>:
          <div style={{height:80,background:`linear-gradient(135deg,${C.navy} 0%,#1e3a5f 100%)`,
            borderRadius:"16px 16px 0 0",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{color:"rgba(255,255,255,.4)",fontSize:12}}>No location data</span>
          </div>}

        <div style={{padding:"20px 24px 24px"}}>
          {/* Close */}
          <button onClick={()=>setSelected(null)}
            style={{position:"absolute",top:12,right:12,width:32,height:32,borderRadius:8,
              background:"rgba(0,0,0,0.35)",border:"none",color:"#fff",fontSize:16,cursor:"pointer",
              display:"flex",alignItems:"center",justifyContent:"center",zIndex:2}}>✕</button>

          {/* Name, score & location */}
          {(()=>{const selScore=scoreMarina(selected);const selStage=STAGES.find(s=>s.key===interestStatus);
          return(<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:12}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:20,fontWeight:700,color:C.text,lineHeight:1.2}}>{selected.name}</div>
              <div style={{fontSize:12,color:C.textDim,marginTop:3}}>
                {selected.city}{selected.city&&selected.state?", ":""}{selected.state}
                {selected.region&&<span style={{color:C.textFaint}}> · {selected.region}</span>}
                {selected.harbor&&<span style={{color:C.textFaint}}> · {selected.harbor}</span>}
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4,flexShrink:0}}>
              <div style={{background:selScore>=70?"rgba(22,163,74,.1)":selScore>=50?C.accentDim:C.surfaceAlt,
                color:selScore>=70?C.green:selScore>=50?C.accent:C.textDim,
                borderRadius:10,padding:"6px 12px",textAlign:"center",minWidth:52}}>
                <div style={{fontSize:18,fontWeight:800,lineHeight:1}}>{selScore}</div>
                <div style={{fontSize:7,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",marginTop:1}}>Score</div>
              </div>
              {selStage&&<span style={{background:selStage.bg,color:selStage.color,padding:"3px 10px",borderRadius:20,
                fontSize:9,fontWeight:700,border:`1px solid ${selStage.color}44`}}>{selStage.label}</span>}
            </div>
          </div>

          {/* Stage pills */}
          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:12}}>
            {STAGES.map(s=>{const active=interestStatus===s.key;return(
              <button key={s.key} onClick={e=>{e.stopPropagation();setStage(selected,s.key);}}
                style={{padding:"5px 12px",borderRadius:20,fontSize:10,fontWeight:600,cursor:"pointer",transition:"all .15s",
                  background:active?s.color:s.bg,color:active?"#fff":s.color,
                  border:`1px solid ${active?s.color:s.color+"55"}`}}>
                {s.label}
              </button>);})}
          </div>

          {/* Popup tabs */}
          <div style={{display:"flex",gap:0,borderBottom:`1px solid ${C.border}`,marginBottom:14}}>
            {[{k:"details",label:"Details"},{k:"outreach",label:`Outreach${outreachLog.length>0?` (${outreachLog.length})`:""}`},{k:"activity",label:`Activity${activityLog.length>0?` (${activityLog.length})`:""}`}].map(({k,label})=>(
              <button key={k} onClick={()=>setPopupTab(k)}
                style={{padding:"7px 14px",fontSize:11,fontWeight:600,cursor:"pointer",background:"transparent",
                  color:popupTab===k?C.navy:C.textDim,border:"none",
                  borderBottom:`2px solid ${popupTab===k?C.navy:"transparent"}`}}>
                {label}
              </button>))}
          </div>
          </>);})()} 

          {/* DETAILS TAB */}
          {popupTab==="details"&&(<>

          {/* Government ownership banner */}
          {selected.is_public&&(
            <div style={{background:"rgba(220,38,38,.06)",border:"1px solid rgba(220,38,38,.25)",
              borderRadius:8,padding:"9px 12px",marginBottom:12,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <span style={{fontSize:11,fontWeight:700,color:C.red}}>⚠ Government Owned — Not Acquirable</span>
              {selected.operator_type&&<span style={{fontSize:9,fontWeight:700,background:"rgba(220,38,38,.1)",
                color:C.red,padding:"2px 8px",borderRadius:10}}>{selected.operator_type}</span>}
              {selected.operator_confidence&&<span style={{fontSize:9,color:C.textDim,marginLeft:"auto"}}>
                ID confidence: <strong>{selected.operator_confidence}</strong></span>}
            </div>
          )}

          {/* Key stats — all physical marina fields */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5,marginBottom:14}}>
            {[
              {l:"Slips",         v:selected.slips!=null?selected.slips.toLocaleString():"—"},
              {l:"Linear Ft",     v:selected.linear_ft?`${selected.linear_ft.toLocaleString()} ft`:"—"},
              {l:"Moorings",      v:selected.moorings!=null?selected.moorings:"—"},
              {l:"Max LOA",       v:selected.max_loa?`${selected.max_loa} ft`:"—"},
              {l:"Max Slip Len",  v:selected.max_slip_length?`${selected.max_slip_length} ft`:"—"},
              {l:"Max Slip Wid",  v:selected.max_slip_width?`${selected.max_slip_width} ft`:"—"},
              {l:"Approach",      v:selected.approach_depth?`${selected.approach_depth} ft`:"—"},
              {l:"Dock Depth",    v:selected.dock_depth?`${selected.dock_depth} ft`:"—"},
              {l:"Reviews",       v:selected.reviews!=null?selected.reviews.toLocaleString():"—"},
            ].map(({l,v})=>(
              <div key={l} style={{background:C.surfaceAlt,borderRadius:8,padding:"8px 6px",textAlign:"center"}}>
                <div style={{fontSize:8,color:C.textFaint,textTransform:"uppercase",letterSpacing:".06em",fontWeight:700,marginBottom:2}}>{l}</div>
                <div style={{fontSize:13,fontWeight:700,color:C.text}}>{v}</div>
              </div>))}
          </div>

          {/* Hotel Market */}
          {selected.hotel_market&&(()=>{const hm=selected.hotel_market;
            const confColor=hm.data_confidence==="high"?C.green:hm.data_confidence==="medium"?"#b45309":C.textDim;
            const confBg=hm.data_confidence==="high"?"rgba(5,150,105,.1)":hm.data_confidence==="medium"?"rgba(180,83,9,.1)":"rgba(148,163,184,.1)";
            return(
            <div style={{background:`linear-gradient(135deg,rgba(10,35,66,.04) 0%,rgba(10,35,66,.02) 100%)`,
              border:`1px solid rgba(10,35,66,.1)`,borderRadius:10,padding:"12px 14px",marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:9,fontWeight:700,color:C.navy,textTransform:"uppercase",letterSpacing:".07em"}}>Hotel Market Data</div>
                {hm.data_confidence&&<span style={{fontSize:8,fontWeight:700,padding:"2px 8px",borderRadius:10,background:confBg,color:confColor}}>
                  {hm.data_confidence.toUpperCase()} CONFIDENCE
                </span>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:8}}>
                {[
                  {l:"Market",       v:hm.market_name||selected.region},
                  {l:"Tier",         v:hm.tier?`${hm.tier} — ${hm.tier_label||""}`:hm.tier_label},
                  {l:"ADR",          v:hm.adr?`$${hm.adr}`:"—"},
                  {l:"RevPAR",       v:hm.revpar?`$${hm.revpar}`:"—"},
                  {l:"Occupancy",    v:hm.occupancy?`${(hm.occupancy*100).toFixed(0)}%`:"—"},
                  {l:"Demand Score", v:hm.demand_score?hm.demand_score.toFixed(1):"—"},
                  {l:"Seasonality",  v:hm.seasonality?.replace(/_/g," ")||"—"},
                  {l:"Supply",       v:hm.supply_constrained?"Constrained":"Open"},
                ].map(({l,v})=>(
                  <div key={l}>
                    <div style={{fontSize:8,color:C.textFaint,textTransform:"uppercase",fontWeight:700,marginBottom:1}}>{l}</div>
                    <div style={{fontSize:12,fontWeight:700,color:C.text}}>{v}</div>
                  </div>))}
              </div>
              {(hm.source||hm.data_as_of)&&(
                <div style={{borderTop:`1px solid rgba(10,35,66,.08)`,paddingTop:7,display:"flex",gap:16,flexWrap:"wrap"}}>
                  {hm.source&&<div>
                    <div style={{fontSize:8,color:C.textFaint,textTransform:"uppercase",fontWeight:700,marginBottom:1}}>Source</div>
                    <div style={{fontSize:10,color:C.textDim}}>{hm.source}</div>
                  </div>}
                  {hm.data_as_of&&<div>
                    <div style={{fontSize:8,color:C.textFaint,textTransform:"uppercase",fontWeight:700,marginBottom:1}}>Data As Of</div>
                    <div style={{fontSize:10,color:C.textDim}}>{hm.data_as_of}</div>
                  </div>}
                </div>
              )}
            </div>
          );})()||null}

          {/* Dockage Rates */}
          {selected.dockage_rates&&(<div style={{background:"rgba(0,212,255,.04)",border:"1px solid rgba(0,212,255,.15)",
            borderRadius:10,padding:"10px 14px",marginBottom:12}}>
            <div style={{fontSize:9,fontWeight:700,color:C.accent,textTransform:"uppercase",marginBottom:6}}>Dockage Rates</div>
            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
              {Object.entries(selected.dockage_rates).map(([k,v])=>(
                <div key={k}><span style={{fontSize:9,color:C.textFaint,textTransform:"uppercase"}}>{k.replace(/_/g," ")}: </span>
                  <strong style={{fontSize:12,color:C.text}}>{typeof v==="number"?`$${v}`:v}</strong></div>))}
            </div>
          </div>)}

          {/* Fuel */}
          {selected.has_fuel_dock&&(<div style={{background:"rgba(8,145,178,.05)",border:"1px solid rgba(8,145,178,.12)",
            borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",gap:16,alignItems:"center"}}>
            <div style={{fontSize:9,fontWeight:700,color:"#0891b2",textTransform:"uppercase"}}>⛽ Fuel Dock</div>
            {selected.diesel&&<span style={{fontSize:12}}>Diesel: <strong>${selected.diesel.toFixed(2)}/gal</strong></span>}
            {selected.gas&&<span style={{fontSize:12}}>{selected.gas_type||"Gas"}: <strong>${selected.gas.toFixed(2)}/gal</strong></span>}
            {!selected.diesel&&!selected.gas&&<span style={{fontSize:11,color:C.textDim}}>Price not in dataset</span>}
            {selected.fuel_updated&&<span style={{fontSize:9,color:C.textFaint}}>Updated {selected.fuel_updated}</span>}
          </div>)}

          {/* Amenities */}
          {selected.amenities?.length>0&&(<div style={{marginBottom:12}}>
            <div style={{fontSize:9,fontWeight:700,color:C.textDim,textTransform:"uppercase",marginBottom:5}}>Amenities</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {selected.amenities.map((am,i)=>(
                <span key={i} style={{background:i<3?C.accentDim:C.surfaceAlt,color:i<3?C.accent:C.textDim,
                  padding:"2px 8px",borderRadius:14,fontSize:9,fontWeight:600}}>{am}</span>))}
            </div>
          </div>)}

          {/* About */}
          {selected.about&&(<div style={{marginBottom:12}}>
            <div style={{fontSize:9,fontWeight:700,color:C.textDim,textTransform:"uppercase",marginBottom:4}}>About</div>
            <div style={{fontSize:11,color:C.textDim,lineHeight:1.65}}>{selected.about}</div>
          </div>)}

          {/* Contact & Data Info */}
          <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:14,padding:"10px 14px",
            background:C.surfaceAlt,borderRadius:8}}>
            <div style={{fontSize:9,fontWeight:700,color:C.textFaint,textTransform:"uppercase",width:"100%",marginBottom:2}}>Contact & Source</div>
            {selected.address&&<span style={{fontSize:11,color:C.textDim}}>{selected.address}</span>}
            {selected.phone&&<span style={{fontSize:11,color:C.textDim}}>{selected.phone}</span>}
            {selected.vhf&&<span style={{fontSize:11,color:C.textDim}}>{selected.vhf}</span>}
            {selected.website&&<a href={`https://${selected.website}`} target="_blank" rel="noopener"
              style={{fontSize:11,color:C.accent}}>{selected.website}</a>}
            {selected.lat&&selected.lon&&<a href={`https://maps.google.com/?q=${selected.lat},${selected.lon}`} target="_blank" rel="noopener"
              style={{fontSize:11,color:C.accent}}>📍 Google Maps</a>}
            {selected.source_url&&<a href={selected.source_url} target="_blank" rel="noopener"
              style={{fontSize:11,color:C.accent}}>Marinas.com profile ↗</a>}
            {selected.scraped_at&&<span style={{fontSize:9,color:C.textFaint,width:"100%",marginTop:2}}>
              Data scraped: {new Date(selected.scraped_at).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"})}
            </span>}
          </div>

          {/* Notes */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:9,fontWeight:700,color:C.textDim,textTransform:"uppercase",marginBottom:5}}>Notes</div>
            <textarea value={popupNotes} onChange={e=>setPopupNotes(e.target.value)} placeholder="Add your notes on this marina…"
              rows={3} style={{width:"100%",padding:"8px 12px",background:C.surface,border:`1px solid ${C.border}`,
                borderRadius:8,fontSize:11,color:C.text,resize:"vertical",outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
            <div style={{display:"flex",alignItems:"center",gap:10,marginTop:5}}>
              <button onClick={()=>saveNote(selected,popupNotes)} disabled={savingNote}
                style={{padding:"5px 14px",borderRadius:6,fontSize:10,fontWeight:700,cursor:"pointer",
                  background:C.navy,color:"#fff",border:"none",opacity:savingNote?.6:1}}>
                {savingNote?"Saving…":"Save Note"}
              </button>
              {!interestStatus&&popupNotes.trim()&&(
                <span style={{fontSize:9,color:"#b45309",fontWeight:600}}>⚠ Will add to Watchlist</span>)}
            </div>
          </div>

          {/* Nearby Comps */}
          {(()=>{
            const comps=marinas.filter(m=>m.id!==selected.id&&m.region&&m.region===selected.region)
              .map(m=>({...m,_score:scoreMarina(m)})).sort((a,b)=>b._score-a._score).slice(0,5);
            return comps.length>0?(<div style={{marginBottom:14}}>
              <button onClick={()=>setShowComps(v=>!v)}
                style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,
                  padding:"8px 12px",cursor:"pointer",marginBottom:showComps?6:0}}>
                <span style={{fontSize:11,fontWeight:700,color:C.text}}>Nearby Comps <span style={{color:C.textDim,fontWeight:500}}>— {selected.region}</span></span>
                <span style={{fontSize:10,color:C.textDim}}>{showComps?"▲":"▼"} {comps.length} marinas</span>
              </button>
              {showComps&&(<div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",marginBottom:6}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                  <thead>
                    <tr style={{background:C.surfaceAlt}}>
                      {["Marina","Slips","ADR","Score","Stage"].map(h=>(
                        <th key={h} style={{padding:"5px 8px",textAlign:"left",fontWeight:700,color:C.textDim,fontSize:9,textTransform:"uppercase",letterSpacing:".04em",whiteSpace:"nowrap"}}>{h}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {comps.map((c,i)=>{const cs=STAGES.find(s=>s.key===interestMap[c.id]?.status);return(
                      <tr key={c.id} onClick={()=>setSelected(c)} style={{cursor:"pointer",background:i%2===0?C.surface:C.surfaceAlt,borderTop:`1px solid ${C.border}`}}>
                        <td style={{padding:"6px 8px",fontWeight:600,color:C.text,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</td>
                        <td style={{padding:"6px 8px",color:C.textDim}}>{c.slips?.toLocaleString()||"—"}</td>
                        <td style={{padding:"6px 8px",color:C.textDim}}>{c.hotel_market?.adr?`$${c.hotel_market.adr}`:"—"}</td>
                        <td style={{padding:"6px 8px"}}>
                          <span style={{fontWeight:700,color:c._score>=70?C.green:c._score>=50?C.accent:C.textDim}}>{c._score}</span>
                        </td>
                        <td style={{padding:"6px 8px"}}>
                          {cs?<span style={{background:cs.bg,color:cs.color,padding:"1px 6px",borderRadius:8,fontWeight:700,fontSize:8}}>{cs.short}</span>:
                            <span style={{color:C.textFaint,fontSize:9}}>—</span>}
                        </td>
                      </tr>);})}
                  </tbody>
                </table>
              </div>)}
            </div>):null;
          })()}

          {/* Footer actions */}
          <div style={{display:"flex",gap:8,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
            {isInDeals(selected)?
              <div style={{flex:1,padding:"10px",background:C.greenL,color:C.green,borderRadius:8,textAlign:"center",fontSize:12,fontWeight:700}}>Already in Deals</div>:
              <button onClick={()=>addToDeal(selected)} style={{flex:1,padding:"10px",background:C.accent,color:"#fff",
                border:"none",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>Add to Deals</button>}
            <button onClick={()=>exportPDF(selected,popupNotes)}
              style={{padding:"10px 14px",background:C.navy,color:"#fff",border:"none",borderRadius:8,fontSize:10,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
              Export PDF
            </button>
            {selected.source_url&&<a href={selected.source_url} target="_blank" rel="noopener"
              style={{padding:"10px 16px",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,
                fontSize:10,fontWeight:600,color:C.textDim,textDecoration:"none",whiteSpace:"nowrap"}}>Marinas.com ↗</a>}
          </div>
          </>)}

          {/* OUTREACH TAB */}
          {popupTab==="outreach"&&(<>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:C.text,marginBottom:10}}>Log a Contact Attempt</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
              <div>
                <div style={{fontSize:8,fontWeight:700,color:C.textFaint,textTransform:"uppercase",marginBottom:3}}>Date</div>
                <input type="date" value={outreachForm.contact_date}
                  onChange={e=>setOutreachForm(f=>({...f,contact_date:e.target.value}))}
                  style={{width:"100%",padding:"7px 10px",border:`1px solid ${C.border}`,borderRadius:7,fontSize:11,color:C.text,background:C.surface,outline:"none",boxSizing:"border-box"}}/>
              </div>
              <div>
                <div style={{fontSize:8,fontWeight:700,color:C.textFaint,textTransform:"uppercase",marginBottom:3}}>Method</div>
                <select value={outreachForm.method} onChange={e=>setOutreachForm(f=>({...f,method:e.target.value}))}
                  style={{width:"100%",padding:"7px 10px",border:`1px solid ${C.border}`,borderRadius:7,fontSize:11,color:C.text,background:C.surface,outline:"none",boxSizing:"border-box"}}>
                  <option value="call">Phone Call</option><option value="email">Email</option>
                  <option value="visit">Site Visit</option><option value="letter">Letter / LOI</option>
                  <option value="meeting">Meeting</option>
                </select>
              </div>
              <div>
                <div style={{fontSize:8,fontWeight:700,color:C.textFaint,textTransform:"uppercase",marginBottom:3}}>Contact Name</div>
                <input value={outreachForm.contact_name} onChange={e=>setOutreachForm(f=>({...f,contact_name:e.target.value}))}
                  placeholder="Owner / manager name"
                  style={{width:"100%",padding:"7px 10px",border:`1px solid ${C.border}`,borderRadius:7,fontSize:11,color:C.text,background:C.surface,outline:"none",boxSizing:"border-box"}}/>
              </div>
              <div>
                <div style={{fontSize:8,fontWeight:700,color:C.textFaint,textTransform:"uppercase",marginBottom:3}}>Response</div>
                <select value={outreachForm.response_status} onChange={e=>setOutreachForm(f=>({...f,response_status:e.target.value}))}
                  style={{width:"100%",padding:"7px 10px",border:`1px solid ${C.border}`,borderRadius:7,fontSize:11,color:C.text,background:C.surface,outline:"none",boxSizing:"border-box"}}>
                  <option value="no_response">No Response</option><option value="responded">Responded</option>
                  <option value="meeting_set">Meeting Set</option><option value="not_interested">Not Interested</option>
                  <option value="interested">Interested</option>
                </select>
              </div>
            </div>
            <div>
              <div style={{fontSize:8,fontWeight:700,color:C.textFaint,textTransform:"uppercase",marginBottom:3}}>Notes</div>
              <textarea value={outreachForm.notes} onChange={e=>setOutreachForm(f=>({...f,notes:e.target.value}))}
                placeholder="What was discussed, next steps…" rows={2}
                style={{width:"100%",padding:"8px 10px",border:`1px solid ${C.border}`,borderRadius:7,fontSize:11,color:C.text,
                  background:C.surface,outline:"none",resize:"vertical",boxSizing:"border-box",fontFamily:"inherit"}}/>
            </div>
            <button onClick={addOutreach} disabled={savingOutreach}
              style={{marginTop:8,padding:"8px 20px",borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer",
                background:C.navy,color:"#fff",border:"none",opacity:savingOutreach?.6:1}}>
              {savingOutreach?"Saving…":"Log Contact"}
            </button>
          </div>
          {outreachLog.length>0&&(<>
            <div style={{fontSize:9,fontWeight:700,color:C.textFaint,textTransform:"uppercase",marginBottom:8}}>History ({outreachLog.length})</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {outreachLog.map(e=>{
                const rColors={no_response:C.textFaint,responded:"#b45309",meeting_set:C.green,not_interested:"#dc2626",interested:C.green};
                const mLabels={call:"📞 Call",email:"✉ Email",visit:"🚤 Visit",letter:"📄 Letter",meeting:"🤝 Meeting"};
                return(<div key={e.id} style={{background:C.surfaceAlt,borderRadius:8,padding:"10px 12px",position:"relative"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <span style={{fontSize:11,fontWeight:600,color:C.text}}>{mLabels[e.method]||e.method}</span>
                      {e.contact_name&&<span style={{fontSize:10,color:C.textDim}}>· {e.contact_name}</span>}
                    </div>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <span style={{fontSize:9,fontWeight:600,color:rColors[e.response_status]||C.textDim}}>
                        {e.response_status?.replace(/_/g," ")}
                      </span>
                      <span style={{fontSize:9,color:C.textFaint}}>{new Date(e.contact_date).toLocaleDateString()}</span>
                      <button onClick={()=>deleteOutreach(e.id)}
                        style={{fontSize:10,color:"#fca5a5",background:"transparent",border:"none",cursor:"pointer",padding:"0 2px",lineHeight:1}}>✕</button>
                    </div>
                  </div>
                  {e.notes&&<div style={{fontSize:10,color:C.textDim,marginTop:4,lineHeight:1.5}}>{e.notes}</div>}
                </div>);})}
            </div>
          </>)}
          {outreachLog.length===0&&(<div style={{textAlign:"center",padding:"24px",color:C.textFaint,fontSize:12}}>No contact attempts logged yet.</div>)}
          </>)}

          {/* ACTIVITY TAB */}
          {popupTab==="activity"&&(<>
          {activityLog.length===0&&(<div style={{textAlign:"center",padding:"24px",color:C.textFaint,fontSize:12}}>No activity recorded yet. Activity is auto-logged when you change stage, save notes, or log outreach.</div>)}
          <div style={{display:"flex",flexDirection:"column",gap:0}}>
            {activityLog.map((ev,i)=>{
              const now=Date.now();const then=new Date(ev.created_at).getTime();
              const diff=now-then;
              const rel=diff<60000?"just now":diff<3600000?`${Math.floor(diff/60000)}m ago`:
                diff<86400000?`${Math.floor(diff/3600000)}h ago`:diff<604800000?`${Math.floor(diff/86400000)}d ago`:
                new Date(ev.created_at).toLocaleDateString();
              const icons={stage_change:"⇒",note_saved:"📝",outreach:"📞"};
              const stgLabel=(k)=>STAGES.find(s=>s.key===k)?.label||k||"Unreviewed";
              let desc="";
              if(ev.event_type==="stage_change")desc=`Stage: ${stgLabel(ev.old_value)} → ${stgLabel(ev.new_value)}`;
              else if(ev.event_type==="note_saved")desc=`Note saved: "${ev.note?.substring(0,60)}${ev.note?.length>60?"…":""}"`;
              else if(ev.event_type==="outreach")desc=`Outreach logged (${ev.new_value||"call"})${ev.note?": "+ev.note.substring(0,50):""}`;
              else desc=`${ev.event_type}: ${ev.new_value||""}`;
              return(<div key={ev.id} style={{display:"flex",gap:12,alignItems:"flex-start",
                paddingBottom:12,borderBottom:i<activityLog.length-1?`1px solid ${C.border}`:"none",paddingTop:i===0?0:12}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:C.surfaceAlt,display:"flex",
                  alignItems:"center",justifyContent:"center",fontSize:12,flexShrink:0}}>{icons[ev.event_type]||"·"}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:11,color:C.text,lineHeight:1.4}}>{desc}</div>
                  <div style={{fontSize:9,color:C.textFaint,marginTop:2}}>{rel}</div>
                </div>
              </div>);})}
          </div>
          </>)}
        </div>
      </div>
    </>)}
  </div>);
}
