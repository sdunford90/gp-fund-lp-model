// ── FILE PARSERS ────────────────────────────────────────────────────────────
// Parse uploaded marina financials (Excel/CSV) into normalized deal data.
// Marina-aware: recognizes slip revenue, fuel, dry storage, service/repair,
// ship store, restaurant, liveaboard, lift fees, and marina-specific expenses.
// Captures EVERY line item — not just totals — so uploaded data is useful.
// Supports: T12, operating statements, slip schedules, multi-year historicals.
// Handles monthly columns, yearly columns, date columns, single-value summaries.

import { read, utils } from 'xlsx';

// ── MONTH PATTERNS ──────────────────────────────────────────────────────────
const MONTH_NAMES = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const MONTH_FULL = ['january','february','march','april','may','june','july','august',
  'september','october','november','december'];

function parseMonthHeader(cell) {
  if (cell == null) return null;
  const s = String(cell).trim();

  if (/^\d{5}$/.test(s)) {
    const d = excelDateToJS(parseInt(s));
    if (d) return { month: d.getMonth(), year: d.getFullYear() };
  }

  const lower = s.toLowerCase().replace(/[.\-_]/g, ' ').trim();

  for (let mi = 0; mi < 12; mi++) {
    const abbr = MONTH_NAMES[mi];
    const full = MONTH_FULL[mi];
    const re = new RegExp(`^(?:${full}|${abbr})\\s*(\\d{2,4})?$`, 'i');
    const m = lower.match(re);
    if (m) {
      let yr = m[1] ? parseInt(m[1]) : null;
      if (yr != null && yr < 100) yr += 2000;
      return { month: mi, year: yr };
    }
  }

  const slashMatch = lower.match(/^(\d{1,2})\s*[\/\-]\s*(\d{2,4})$/);
  if (slashMatch) {
    const mo = parseInt(slashMatch[1]);
    let yr = parseInt(slashMatch[2]);
    if (yr < 100) yr += 2000;
    if (mo >= 1 && mo <= 12) return { month: mo - 1, year: yr };
  }

  const isoMatch = lower.match(/^(20\d{2})\s*[\/\-]\s*(\d{1,2})$/);
  if (isoMatch) {
    const yr = parseInt(isoMatch[1]);
    const mo = parseInt(isoMatch[2]);
    if (mo >= 1 && mo <= 12) return { month: mo - 1, year: yr };
  }

  for (let mi = 0; mi < 12; mi++) {
    if (lower === MONTH_NAMES[mi] || lower === MONTH_FULL[mi]) {
      return { month: mi, year: null };
    }
  }

  return null;
}

function excelDateToJS(serial) {
  if (serial < 1) return null;
  const utcDays = serial - 25569;
  const d = new Date(utcDays * 86400000);
  if (isNaN(d.getTime())) return null;
  return d;
}

// ── MARINA LINE ITEM CLASSIFICATION ─────────────────────────────────────────
// Classify every row label into a category + subcategory for marina financials.
// Returns { section, category, subcategory } or null if unrecognized.

const MARINA_REVENUE_PATTERNS = [
  // Slip revenue
  { re: /slip\s*(?:rent|rev|income|fee)/i, cat: 'Slip Revenue', sub: 'Slip Rental' },
  { re: /wet\s*slip/i, cat: 'Slip Revenue', sub: 'Wet Slips' },
  { re: /dry\s*slip/i, cat: 'Dry Storage', sub: 'Dry Slips' },
  { re: /dock(?:age|\s*rent|\s*rev|\s*fee|\s*income)/i, cat: 'Slip Revenue', sub: 'Dockage' },
  { re: /berth|mooring/i, cat: 'Slip Revenue', sub: 'Mooring / Berth' },
  { re: /transient|guest\s*dock|visiting/i, cat: 'Slip Revenue', sub: 'Transient Dockage' },
  { re: /liveaboard/i, cat: 'Slip Revenue', sub: 'Liveaboard Fees' },
  { re: /mega\s*yacht|super\s*yacht/i, cat: 'Slip Revenue', sub: 'Mega Yacht' },

  // Dry storage
  { re: /dry\s*(?:stor|rack|stack|boat)/i, cat: 'Dry Storage', sub: 'Dry Storage' },
  { re: /rack\s*stor/i, cat: 'Dry Storage', sub: 'Rack Storage' },
  { re: /indoor\s*stor/i, cat: 'Dry Storage', sub: 'Indoor Storage' },
  { re: /covered\s*stor/i, cat: 'Dry Storage', sub: 'Covered Storage' },
  { re: /yard\s*stor|outside\s*stor|open\s*stor/i, cat: 'Dry Storage', sub: 'Yard Storage' },
  { re: /trailer\s*(?:stor|park)/i, cat: 'Dry Storage', sub: 'Trailer Storage' },
  { re: /boat\s*stor/i, cat: 'Dry Storage', sub: 'Boat Storage' },

  // Lifts & launch
  { re: /fork\s*lift|fork\s*launch/i, cat: 'Lifts & Launch', sub: 'Forklift' },
  { re: /travel\s*lift/i, cat: 'Lifts & Launch', sub: 'Travel Lift' },
  { re: /haul\s*out|haul-out/i, cat: 'Lifts & Launch', sub: 'Haul Out' },
  { re: /launch\s*(?:fee|rev|serv)/i, cat: 'Lifts & Launch', sub: 'Launch Service' },
  { re: /crane/i, cat: 'Lifts & Launch', sub: 'Crane' },
  { re: /boat\s*ramp|ramp\s*(?:fee|rev)/i, cat: 'Lifts & Launch', sub: 'Boat Ramp' },

  // Fuel
  { re: /fuel|gas\s*dock|diesel|gasoline|petrol/i, cat: 'Fuel', sub: 'Fuel Sales' },
  { re: /fuel\s*margin|fuel\s*profit/i, cat: 'Fuel', sub: 'Fuel Margin' },

  // Service & repair
  { re: /service|repair|maintenance\s*(?:rev|inc|fee)/i, cat: 'Service & Repair', sub: 'Service Revenue' },
  { re: /boat\s*yard|work\s*yard/i, cat: 'Service & Repair', sub: 'Boat Yard' },
  { re: /bottom\s*paint/i, cat: 'Service & Repair', sub: 'Bottom Paint' },
  { re: /hull|gelcoat|fiberglass/i, cat: 'Service & Repair', sub: 'Hull Work' },
  { re: /engine|mechanic|motor/i, cat: 'Service & Repair', sub: 'Engine / Mechanical' },
  { re: /electric(?:al)?\s*(?:rev|serv|work)/i, cat: 'Service & Repair', sub: 'Electrical' },
  { re: /winteriz|shrink\s*wrap|decommission/i, cat: 'Service & Repair', sub: 'Winterization' },
  { re: /detail(?:ing)?|wash|clean/i, cat: 'Service & Repair', sub: 'Detailing' },

  // Retail & F&B
  { re: /ship\s*store|marine\s*store|chandlery|pro\s*shop/i, cat: 'Retail & F&B', sub: 'Ship Store' },
  { re: /restaurant|food\s*(?:&|and)\s*bev|f\s*&\s*b|dining|tiki|bar|grill|cafe/i, cat: 'Retail & F&B', sub: 'Restaurant / Bar' },
  { re: /bait|tackle/i, cat: 'Retail & F&B', sub: 'Bait & Tackle' },
  { re: /ice\s*(?:sale|rev)/i, cat: 'Retail & F&B', sub: 'Ice Sales' },
  { re: /vending|laundry/i, cat: 'Retail & F&B', sub: 'Vending / Laundry' },
  { re: /merchan/i, cat: 'Retail & F&B', sub: 'Merchandise' },

  // Ancillary
  { re: /electric(?:ity|al)?\s*(?:rev|reimb|charge|income|fee)/i, cat: 'Ancillary', sub: 'Electric Reimbursement' },
  { re: /water\s*(?:rev|reimb|charge|income|fee)/i, cat: 'Ancillary', sub: 'Water Reimbursement' },
  { re: /util(?:ity|ities)\s*(?:rev|reimb|charge|income)/i, cat: 'Ancillary', sub: 'Utility Reimbursement' },
  { re: /pump\s*out/i, cat: 'Ancillary', sub: 'Pumpout' },
  { re: /wifi|internet|cable/i, cat: 'Ancillary', sub: 'WiFi / Internet' },
  { re: /parking|car\s*(?:stor|park)/i, cat: 'Ancillary', sub: 'Parking' },
  { re: /shower|bath|restroom/i, cat: 'Ancillary', sub: 'Facilities' },
  { re: /charter|tour|excursion/i, cat: 'Ancillary', sub: 'Charters / Tours' },
  { re: /event|rental\s*(?:space|hall|room)/i, cat: 'Ancillary', sub: 'Event Rental' },
  { re: /tenant\s*(?:rev|rent|lease)/i, cat: 'Ancillary', sub: 'Tenant Lease' },
  { re: /other\s*(?:rev|inc)/i, cat: 'Ancillary', sub: 'Other Revenue' },
  { re: /misc(?:ellaneous)?\s*(?:rev|inc)/i, cat: 'Ancillary', sub: 'Misc Revenue' },
  { re: /insurance\s*(?:rev|reimb|proceeds)/i, cat: 'Ancillary', sub: 'Insurance Revenue' },
];

const MARINA_EXPENSE_PATTERNS = [
  // Dock & facility
  { re: /dock\s*(?:maint|repair|expense)/i, cat: 'Dock & Facility', sub: 'Dock Maintenance' },
  { re: /piling|pile\s*(?:repair|replac)/i, cat: 'Dock & Facility', sub: 'Piling' },
  { re: /dredg/i, cat: 'Dock & Facility', sub: 'Dredging' },
  { re: /seawall|bulkhead|rip\s*rap/i, cat: 'Dock & Facility', sub: 'Seawall / Bulkhead' },
  { re: /float(?:ing)?\s*dock|finger\s*(?:pier|dock)/i, cat: 'Dock & Facility', sub: 'Floating Dock' },
  { re: /facility\s*(?:maint|repair)/i, cat: 'Dock & Facility', sub: 'Facility Maintenance' },
  { re: /building\s*(?:maint|repair)/i, cat: 'Dock & Facility', sub: 'Building Maintenance' },
  { re: /grounds|landscap/i, cat: 'Dock & Facility', sub: 'Grounds / Landscaping' },
  { re: /parking\s*(?:lot|maint)/i, cat: 'Dock & Facility', sub: 'Parking Maintenance' },

  // Fuel expenses
  { re: /fuel\s*(?:cost|expense|cogs|purchase)/i, cat: 'Fuel COGS', sub: 'Fuel Cost' },
  { re: /fuel\s*(?:deliv|freight|transport)/i, cat: 'Fuel COGS', sub: 'Fuel Delivery' },
  { re: /fuel\s*(?:tank|equip|pump)/i, cat: 'Fuel COGS', sub: 'Fuel Equipment' },

  // Equipment
  { re: /(?:fork|travel)\s*lift\s*(?:maint|repair|expense)/i, cat: 'Equipment', sub: 'Lift Maintenance' },
  { re: /equip(?:ment)?\s*(?:maint|repair|lease|rent)/i, cat: 'Equipment', sub: 'Equipment' },
  { re: /vehicle/i, cat: 'Equipment', sub: 'Vehicles' },

  // Payroll
  { re: /payroll|salary|salaries|wages|compensation|labor/i, cat: 'Payroll', sub: 'Payroll' },
  { re: /benefits|health\s*ins|401k|retirement/i, cat: 'Payroll', sub: 'Benefits' },
  { re: /payroll\s*tax|fica|workers?\s*comp/i, cat: 'Payroll', sub: 'Payroll Tax' },
  { re: /contract\s*(?:labor|work)|subcontract/i, cat: 'Payroll', sub: 'Contract Labor' },

  // Insurance
  { re: /(?:property|liability|general|marina|marine)\s*insur/i, cat: 'Insurance', sub: 'Insurance' },
  { re: /insur(?:ance)?\s*(?:prem|expense|cost)/i, cat: 'Insurance', sub: 'Insurance' },

  // Utilities
  { re: /electric(?:ity)?\s*(?:exp|cost)?$/i, cat: 'Utilities', sub: 'Electric' },
  { re: /water(?:\s*(?:&|and)\s*sewer)?\s*(?:exp|cost)?$/i, cat: 'Utilities', sub: 'Water & Sewer' },
  { re: /sewer/i, cat: 'Utilities', sub: 'Sewer' },
  { re: /gas\s*(?:nat|util|exp|cost)/i, cat: 'Utilities', sub: 'Natural Gas' },
  { re: /trash|waste|garbage|disposal/i, cat: 'Utilities', sub: 'Trash / Waste' },
  { re: /util(?:ity|ities)\s*(?:exp|cost)?$/i, cat: 'Utilities', sub: 'Utilities' },
  { re: /telephone|phone|internet|cable|wifi/i, cat: 'Utilities', sub: 'Telecom' },

  // Admin & marketing
  { re: /market(?:ing)?|advertis/i, cat: 'Admin', sub: 'Marketing' },
  { re: /office\s*(?:exp|supply|cost)/i, cat: 'Admin', sub: 'Office' },
  { re: /professional\s*(?:fee|serv)|legal|account(?:ing)?|audit/i, cat: 'Admin', sub: 'Professional Fees' },
  { re: /management\s*fee/i, cat: 'Admin', sub: 'Management Fee' },
  { re: /admin(?:istrat)/i, cat: 'Admin', sub: 'Administrative' },
  { re: /software|technology|it\s/i, cat: 'Admin', sub: 'Technology' },
  { re: /bank\s*(?:fee|charge)|merchant/i, cat: 'Admin', sub: 'Bank / Merchant Fees' },
  { re: /bad\s*debt|write.?off|collection/i, cat: 'Admin', sub: 'Bad Debt' },
  { re: /permit|licens|regulat/i, cat: 'Admin', sub: 'Permits / Licenses' },

  // Taxes
  { re: /property\s*tax|real\s*estate\s*tax|ad\s*valorem/i, cat: 'Taxes', sub: 'Property Tax' },
  { re: /(?:sales|use)\s*tax/i, cat: 'Taxes', sub: 'Sales Tax' },

  // R&M / CapEx
  { re: /r\s*&\s*m|repair(?:s)?\s*(?:&|and)\s*maint/i, cat: 'R&M', sub: 'Repairs & Maintenance' },
  { re: /cap\s*ex|capital\s*(?:exp|improv|expendit)/i, cat: 'CapEx', sub: 'Capital Expenditure' },
  { re: /replace(?:ment)?\s*reserve/i, cat: 'CapEx', sub: 'Replacement Reserve' },

  // Environmental
  { re: /environ(?:mental)?|stormwater|spill|containment/i, cat: 'Environmental', sub: 'Environmental' },
  { re: /deq|dep\s|epa\s|compliance/i, cat: 'Environmental', sub: 'Compliance' },
];

// Summary / total line patterns
const TOTAL_REVENUE_PATTERNS = [
  /^total\s*(?:revenue|income)/i, /^gross\s*(?:revenue|income)/i,
  /^total\s*(?:operating\s*)?revenue/i, /^total\s*marina\s*revenue/i,
  /^effective\s*gross\s*income/i, /^egi$/i,
];
const TOTAL_EXPENSE_PATTERNS = [
  /^total\s*(?:operating\s*)?expense/i, /^total\s*expense/i, /^operating\s*expense/i,
];
const NOI_PATTERNS = [
  /^n\.?o\.?i\.?$/i, /^net\s*operating\s*income/i, /^net\s*income/i,
];
const OCCUPANCY_PATTERNS = [
  /occupancy/i, /occ\s*rate/i, /occ\s*%/i, /utilization/i,
];
const SLIP_COUNT_PATTERNS = [
  /total\s*slip/i, /slip\s*count/i, /wet\s*slip/i, /total\s*(?:berth|dock)/i,
  /# (?:slip|berth)/i, /number\s*(?:of\s*)?slip/i,
  // Also fallback to generic unit patterns
  /total\s*unit/i, /unit\s*count/i,
];
const DEBT_PATTERNS = [
  /debt\s*serv/i, /mortgage/i, /loan\s*pay/i, /note\s*pay/i,
];

function classifyRow(label) {
  const trimmed = label.trim();
  const lower = trimmed.toLowerCase();

  // Skip empty or junk rows
  if (!trimmed || lower.length < 2) return null;
  // Skip rows that are just dashes, equals, or numbers
  if (/^[\-=_\s.]+$/.test(trimmed)) return null;

  // Check revenue patterns
  for (const p of MARINA_REVENUE_PATTERNS) {
    if (p.re.test(lower)) return { section: 'revenue', category: p.cat, subcategory: p.sub };
  }

  // Check expense patterns
  for (const p of MARINA_EXPENSE_PATTERNS) {
    if (p.re.test(lower)) return { section: 'expense', category: p.cat, subcategory: p.sub };
  }

  // Check summary lines
  for (const re of TOTAL_REVENUE_PATTERNS) {
    if (re.test(lower)) return { section: 'summary', category: 'Total Revenue', subcategory: 'total_revenue' };
  }
  for (const re of TOTAL_EXPENSE_PATTERNS) {
    if (re.test(lower)) return { section: 'summary', category: 'Total Expenses', subcategory: 'total_expenses' };
  }
  for (const re of NOI_PATTERNS) {
    if (re.test(lower)) return { section: 'summary', category: 'NOI', subcategory: 'noi' };
  }
  for (const re of OCCUPANCY_PATTERNS) {
    if (re.test(lower)) return { section: 'summary', category: 'Occupancy', subcategory: 'occupancy' };
  }
  for (const re of SLIP_COUNT_PATTERNS) {
    if (re.test(lower)) return { section: 'summary', category: 'Slips', subcategory: 'slips' };
  }
  for (const re of DEBT_PATTERNS) {
    if (re.test(lower)) return { section: 'below_line', category: 'Debt Service', subcategory: 'debt_service' };
  }

  // Generic section detection via context keywords in the label itself
  if (lower.includes('revenue') || lower.includes('income') || lower.includes('sales')) {
    return { section: 'revenue', category: 'Other Revenue', subcategory: trimmed };
  }
  if (lower.includes('expense') || lower.includes('cost')) {
    return { section: 'expense', category: 'Other Expenses', subcategory: trimmed };
  }

  // Unclassified — still capture it
  return { section: 'unclassified', category: 'Unclassified', subcategory: trimmed };
}

// ── SECTION CONTEXT TRACKER ─────────────────────────────────────────────────
// Track whether we're in the Revenue or Expense section of the P&L,
// so unclassified rows get assigned to the right section.
function detectSectionFromContext(label) {
  const lower = label.toLowerCase().trim();
  // Section headers that indicate we're entering revenue
  if (/^(?:revenue|income|operating\s*revenue|marina\s*revenue)$/i.test(lower)) return 'revenue';
  if (/^(?:expense|operating\s*expense|costs?|operating\s*costs?)$/i.test(lower)) return 'expense';
  if (/^(?:other\s*income|below\s*(?:the\s*)?line)/i.test(lower)) return 'below_line';
  return null;
}

// ── MAIN ENTRY POINT ────────────────────────────────────────────────────────
export function parseUpload(buffer, filename, options = {}) {
  const ext = (filename || '').split('.').pop().toLowerCase();

  if (ext === 'csv') {
    return parseCSV(buffer.toString('utf-8'), options);
  }

  if (['xlsx', 'xls', 'xlsm'].includes(ext)) {
    return parseExcel(buffer, options);
  }

  throw new Error(`Unsupported file type: .${ext}. Supported: .xlsx, .xls, .xlsm, .csv`);
}

// ── EXCEL PARSER ────────────────────────────────────────────────────────────
function parseExcel(buffer, options = {}) {
  const workbook = read(buffer, { type: 'buffer' });
  const results = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

    if (!data || data.length < 2) continue;

    const detected = detectSheetType(data, sheetName);

    if (detected.type === 'slip_schedule') {
      const parsed = parseSlipSchedule(data, detected);
      results.push(parsed);
    } else if (detected.type === 'monthly') {
      const parsed = parseMonthlyColumns(data, detected);
      results.push(...parsed);
    } else if (detected.type === 'operating_statement' || detected.type === 't12') {
      const parsed = parseOperatingStatement(data, detected);
      results.push(...parsed);
    } else if (detected.type === 'multi_year') {
      const parsed = parseMultiYear(data, detected);
      results.push(...parsed);
    } else {
      const parsed = parseGeneric(data, sheetName);
      if (parsed) results.push(parsed);
    }
  }

  return results;
}

// ── CSV PARSER ──────────────────────────────────────────────────────────────
function parseCSV(text, options = {}) {
  const lines = text.split('\n').map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
  if (lines.length < 2) return [];
  const detected = detectSheetType(lines, 'csv');
  if (detected.type === 'slip_schedule') return [parseSlipSchedule(lines, detected)];
  if (detected.type === 'monthly') return parseMonthlyColumns(lines, detected);
  if (detected.type === 'operating_statement' || detected.type === 't12') return parseOperatingStatement(lines, detected);
  if (detected.type === 'multi_year') return parseMultiYear(lines, detected);
  const parsed = parseGeneric(lines, 'csv');
  return parsed ? [parsed] : [];
}

// ── SHEET TYPE DETECTION ────────────────────────────────────────────────────
function detectSheetType(data, sheetName) {
  const flatText = data.slice(0, 15).flat().filter(Boolean).map(String).join(' ').toLowerCase();
  const name = (sheetName || '').toLowerCase();

  // Slip schedule / rent roll indicators (marina version)
  if (name.includes('slip') || name.includes('rent roll') || name.includes('rentroll') ||
      name.includes('dock') || name.includes('berth')) {
    // Check if it looks like a row-per-slip format
    const hasSlipCol = flatText.includes('slip') || flatText.includes('dock') || flatText.includes('berth');
    const hasRateCol = flatText.includes('rate') || flatText.includes('rent') || flatText.includes('fee');
    if (hasSlipCol && hasRateCol) return { type: 'slip_schedule' };
  }
  // Also detect by content even if sheet name doesn't say it
  if ((flatText.includes('slip') || flatText.includes('berth') || flatText.includes('dock')) &&
      (flatText.includes('rate') || flatText.includes('rent')) &&
      (flatText.includes('loa') || flatText.includes('length') || flatText.includes('beam') ||
       flatText.includes('tenant') || flatText.includes('vessel') || flatText.includes('boat'))) {
    return { type: 'slip_schedule' };
  }

  // Check headers for monthly or yearly columns
  for (let headerIdx = 0; headerIdx < Math.min(5, data.length); headerIdx++) {
    const headerRow = data[headerIdx] || [];
    if (headerRow.length < 2) continue;

    const monthCols = [];
    for (let c = 0; c < headerRow.length; c++) {
      const parsed = parseMonthHeader(headerRow[c]);
      if (parsed) monthCols.push({ col: c, ...parsed });
    }
    if (monthCols.length >= 3) {
      const knownYears = monthCols.filter(m => m.year != null);
      if (knownYears.length > 0) {
        const yearCounts = {};
        knownYears.forEach(m => { yearCounts[m.year] = (yearCounts[m.year] || 0) + 1; });
        const defaultYear = parseInt(Object.entries(yearCounts).sort((a, b) => b[1] - a[1])[0][0]);
        monthCols.forEach(m => { if (m.year == null) m.year = defaultYear; });
      }
      return { type: 'monthly', monthColumns: monthCols, headerRow: headerIdx };
    }

    const yearCols = [];
    for (let c = 0; c < headerRow.length; c++) {
      const s = String(headerRow[c] || '');
      if (/^(19|20)\d{2}$/.test(s) || /^fy\s*(19|20)\d{2}$/i.test(s)) {
        const ym = s.match(/((?:19|20)\d{2})/);
        if (ym) yearCols.push({ col: c, year: parseInt(ym[1]) });
      }
    }
    if (yearCols.length >= 2) {
      return { type: 'multi_year', yearColumns: yearCols.map(c => String(data[headerIdx][c.col])), headerRow: headerIdx };
    }
  }

  // T12 / trailing twelve
  if (name.includes('t12') || name.includes('t-12') || name.includes('trailing') ||
      flatText.includes('t12') || flatText.includes('trailing twelve') || flatText.includes('trailing 12')) {
    return { type: 't12' };
  }

  // Operating statement / P&L
  if (flatText.includes('revenue') || flatText.includes('income') ||
      flatText.includes('noi') || flatText.includes('operating') ||
      flatText.includes('expense') || flatText.includes('slip') ||
      flatText.includes('fuel') || flatText.includes('dockage') ||
      flatText.includes('marina')) {
    return { type: 'operating_statement' };
  }

  return { type: 'unknown' };
}

// ── CORE ROW PARSER ─────────────────────────────────────────────────────────
// Shared logic: parse every row, classify it, capture values.
// Returns structured data used by all parser variants.
function parseRows(data, valueCols, startRow = 0) {
  const rows = [];
  let currentSection = null;

  for (let r = startRow; r < data.length; r++) {
    const rawLabel = String(data[r]?.[0] || '').trim();
    if (!rawLabel) continue;

    // Detect section headers (rows that are section labels with no/zero value)
    const sectionSwitch = detectSectionFromContext(rawLabel);
    if (sectionSwitch) {
      currentSection = sectionSwitch;
    }

    // Classify this row
    let classified = classifyRow(rawLabel);

    // If unclassified but we know what section we're in, assign it
    if (classified && classified.section === 'unclassified' && currentSection) {
      classified = { ...classified, section: currentSection };
      if (currentSection === 'revenue') classified.category = 'Other Revenue';
      if (currentSection === 'expense') classified.category = 'Other Expenses';
    }

    // Get values for each value column
    const values = {};
    for (const vc of valueCols) {
      values[vc.key] = parseNum(data[r]?.[vc.col]);
    }

    rows.push({
      row: r,
      label: rawLabel,
      classified,
      values,
    });
  }

  return rows;
}

// Build parsed summary from classified rows
function buildParsedSummary(classifiedRows, valueKey) {
  const parsed = {
    revenue: null,
    egi: null,
    expenses: null,
    noi: null,
    noi_margin: null,
    occupancy: null,
    slips: null,
    debt_service: null,
    // Marina-specific revenue breakdown
    slip_revenue: null,
    dry_storage_revenue: null,
    fuel_revenue: null,
    service_revenue: null,
    retail_fb_revenue: null,
    lift_revenue: null,
    ancillary_revenue: null,
    // Line items
    revenue_lines: [],
    expense_lines: [],
  };

  for (const row of classifiedRows) {
    const value = row.values[valueKey];
    const c = row.classified;
    if (!c || value == null) continue;

    // Revenue line items
    if (c.section === 'revenue') {
      parsed.revenue_lines.push({ label: row.label, category: c.category, subcategory: c.subcategory, value });

      // Aggregate by marina category
      if (c.category === 'Slip Revenue') parsed.slip_revenue = (parsed.slip_revenue || 0) + value;
      if (c.category === 'Dry Storage') parsed.dry_storage_revenue = (parsed.dry_storage_revenue || 0) + value;
      if (c.category === 'Fuel') parsed.fuel_revenue = (parsed.fuel_revenue || 0) + value;
      if (c.category === 'Service & Repair') parsed.service_revenue = (parsed.service_revenue || 0) + value;
      if (c.category === 'Retail & F&B') parsed.retail_fb_revenue = (parsed.retail_fb_revenue || 0) + value;
      if (c.category === 'Lifts & Launch') parsed.lift_revenue = (parsed.lift_revenue || 0) + value;
      if (c.category === 'Ancillary') parsed.ancillary_revenue = (parsed.ancillary_revenue || 0) + value;
    }

    // Expense line items
    if (c.section === 'expense') {
      parsed.expense_lines.push({ label: row.label, category: c.category, subcategory: c.subcategory, value });
    }

    // Summary lines
    if (c.section === 'summary') {
      if (c.subcategory === 'total_revenue') parsed.revenue = value;
      if (c.subcategory === 'total_expenses') parsed.expenses = value;
      if (c.subcategory === 'noi') parsed.noi = value;
      if (c.subcategory === 'occupancy') parsed.occupancy = value > 1 ? value / 100 : value;
      if (c.subcategory === 'slips') parsed.slips = value;
    }

    if (c.section === 'below_line' && c.subcategory === 'debt_service') {
      parsed.debt_service = value;
    }
  }

  // If no total revenue line found, sum up all revenue line items
  if (parsed.revenue == null && parsed.revenue_lines.length > 0) {
    parsed.revenue = parsed.revenue_lines.reduce((s, l) => s + l.value, 0);
  }

  // If no total expense line found, sum up expense items
  if (parsed.expenses == null && parsed.expense_lines.length > 0) {
    parsed.expenses = parsed.expense_lines.reduce((s, l) => s + Math.abs(l.value), 0);
  }

  // Compute NOI if missing
  if (parsed.noi == null && parsed.revenue != null && parsed.expenses != null) {
    parsed.noi = parsed.revenue - Math.abs(parsed.expenses);
  }

  // NOI margin
  const rev = parsed.egi || parsed.revenue;
  if (parsed.noi != null && rev && rev > 0) {
    parsed.noi_margin = parsed.noi / rev;
  }

  return parsed;
}

// ── MONTHLY COLUMNS PARSER ──────────────────────────────────────────────────
function parseMonthlyColumns(data, detected) {
  const { monthColumns, headerRow: hIdx } = detected;
  const headerRow = hIdx || 0;

  // Look for a "Total" column
  const headers = (data[headerRow] || []);
  let totalCol = null;
  for (let c = 0; c < headers.length; c++) {
    const s = String(headers[c] || '').toLowerCase().trim();
    if (s === 'total' || s === 'annual' || s === 'annualized' || s === 'ytd' || s === 't12' || s === 'trailing 12') {
      totalCol = c;
      break;
    }
  }

  // Group month columns by year
  const yearMap = {};
  for (const mc of monthColumns) {
    const yr = mc.year || 0;
    if (!yearMap[yr]) yearMap[yr] = [];
    yearMap[yr].push(mc);
  }

  // Build value columns for parseRows
  const allValueCols = monthColumns.map(mc => ({ key: `${mc.year || 0}-${mc.month}`, col: mc.col }));
  if (totalCol != null) allValueCols.push({ key: 'total', col: totalCol });

  const classifiedRows = parseRows(data, allValueCols, headerRow + 1);

  const years = Object.keys(yearMap).map(Number).sort();

  // Infer year for bare month names
  if (years.length === 1 && years[0] === 0) {
    let inferredYear = null;
    for (let r = 0; r <= headerRow; r++) {
      const rowText = (data[r] || []).filter(Boolean).map(String).join(' ');
      const ym = rowText.match(/(20\d{2}|19\d{2})/);
      if (ym) { inferredYear = parseInt(ym[1]); break; }
    }
    if (!inferredYear) inferredYear = new Date().getFullYear();
    yearMap[inferredYear] = yearMap[0];
    delete yearMap[0];
    years[0] = inferredYear;
  }

  const results = [];

  for (const year of years) {
    const cols = yearMap[year];
    if (!cols || cols.length === 0) continue;

    const monthKeys = cols.map(c => `${year}-${c.month}`);

    // For each classified row, sum across this year's months
    const annualRows = classifiedRows.map(row => {
      const monthVals = monthKeys.map(k => row.values[k]).filter(v => v != null);
      const summed = monthVals.length > 0 ? monthVals.reduce((s, v) => s + v, 0) : null;
      // If single year with total column, prefer total
      const value = (years.length === 1 && row.values.total != null) ? row.values.total : summed;
      return { ...row, values: { annual: value }, monthlyValues: monthVals };
    });

    const parsed = buildParsedSummary(annualRows, 'annual');

    // Build monthly detail
    parsed.monthly_detail = [];
    for (const mc of cols) {
      const monthData = { month: mc.month + 1, year };
      const key = `${year}-${mc.month}`;
      for (const row of classifiedRows) {
        const val = row.values[key];
        const c = row.classified;
        if (!c || val == null) continue;
        if (c.section === 'summary' && c.subcategory === 'noi') monthData.noi = val;
        if (c.section === 'summary' && c.subcategory === 'total_revenue') monthData.revenue = val;
        if (c.section === 'summary' && c.subcategory === 'total_expenses') monthData.expenses = val;
        // Also look for revenue by category
        if (c.section === 'revenue' && c.category === 'Slip Revenue') monthData.slip_revenue = (monthData.slip_revenue || 0) + val;
        if (c.section === 'revenue' && c.category === 'Fuel') monthData.fuel_revenue = (monthData.fuel_revenue || 0) + val;
      }
      if (monthData.noi != null || monthData.revenue != null || monthData.slip_revenue != null) {
        parsed.monthly_detail.push(monthData);
      }
    }

    // Annualize if partial year
    if (cols.length > 0 && cols.length < 12) {
      const factor = 12 / cols.length;
      if (parsed.revenue != null) parsed.revenue_annualized = parsed.revenue * factor;
      if (parsed.noi != null) parsed.noi_annualized = parsed.noi * factor;
    }

    const result = {
      type: 'operating_statement',
      year,
      period_start: `${year}-01-01`,
      period_end: `${year}-12-31`,
      months_covered: cols.length,
      parsed,
      raw_rows: annualRows.map(r => ({ label: r.label, value: r.values.annual, classified: r.classified, monthlyValues: r.monthlyValues })),
    };

    results.push(result);
  }

  return results;
}

// ── OPERATING STATEMENT / T12 (single-value columns) ────────────────────────
function parseOperatingStatement(data, detected) {
  const valueColIdx = findValueColumn(data);
  const valueCols = [{ key: 'value', col: valueColIdx }];
  const classifiedRows = parseRows(data, valueCols);
  const parsed = buildParsedSummary(classifiedRows, 'value');

  // Detect year from labels or headers
  let year = null;
  for (const row of classifiedRows) {
    const yearMatch = row.label.match(/(20\d{2}|19\d{2})/);
    if (yearMatch) { year = parseInt(yearMatch[1]); break; }
  }
  if (!year) {
    const headerText = data.slice(0, 3).flat().filter(Boolean).map(String).join(' ');
    const ym = headerText.match(/(20\d{2}|19\d{2})/);
    if (ym) year = parseInt(ym[1]);
  }

  return [{
    type: detected.type || 'operating_statement',
    year,
    period_start: year ? `${year}-01-01` : null,
    period_end: year ? `${year}-12-31` : null,
    parsed,
    raw_rows: classifiedRows.map(r => ({ label: r.label, value: r.values.value, classified: r.classified })),
  }];
}

// ── MULTI-YEAR (year columns) ───────────────────────────────────────────────
function parseMultiYear(data, detected) {
  const hIdx = detected.headerRow || 0;
  const headerRow = data[hIdx] || [];
  const yearCols = [];

  for (let c = 0; c < headerRow.length; c++) {
    const s = String(headerRow[c] || '');
    const ym = s.match(/((?:19|20)\d{2})/);
    if (ym) yearCols.push({ col: c, year: parseInt(ym[1]) });
  }

  if (yearCols.length === 0) return [];

  // Parse rows with all year columns
  const valueCols = yearCols.map(yc => ({ key: `yr_${yc.year}`, col: yc.col }));
  const classifiedRows = parseRows(data, valueCols, hIdx + 1);

  return yearCols.map(({ col, year }) => {
    const valueKey = `yr_${year}`;
    const parsed = buildParsedSummary(classifiedRows, valueKey);

    return {
      type: 'operating_statement',
      year,
      period_start: `${year}-01-01`,
      period_end: `${year}-12-31`,
      parsed,
      raw_rows: classifiedRows.map(r => ({ label: r.label, value: r.values[valueKey], classified: r.classified })),
    };
  });
}

// ── SLIP SCHEDULE ───────────────────────────────────────────────────────────
// Row-per-slip format: Slip #, LOA/Length, Beam, Rate, Status, Tenant, Vessel, etc.
function parseSlipSchedule(data, detected) {
  // Find header row
  let headerIdx = 0;
  for (let r = 0; r < Math.min(10, data.length); r++) {
    const rowText = (data[r] || []).map(String).join(' ').toLowerCase();
    if ((rowText.includes('slip') || rowText.includes('dock') || rowText.includes('berth')) &&
        (rowText.includes('rate') || rowText.includes('rent') || rowText.includes('fee'))) {
      headerIdx = r;
      break;
    }
  }

  const headers = (data[headerIdx] || []).map(h => String(h || '').trim().toLowerCase());

  // Map columns — marina-specific
  const slipCol = headers.findIndex(h => h.includes('slip') || h.includes('dock') || h.includes('berth') || h === '#' || h === 'no');
  const loaCol = headers.findIndex(h => h.includes('loa') || h.includes('length') || h.includes('max'));
  const beamCol = headers.findIndex(h => h.includes('beam') || h.includes('width'));
  const rateCol = headers.findIndex(h => h.includes('rate') || h.includes('rent') || h.includes('fee') || h.includes('price'));
  const statusCol = headers.findIndex(h =>
    h.includes('status') || h.includes('occupied') || h.includes('vacant') || h.includes('available'));
  const typeCol = headers.findIndex(h =>
    h.includes('type') || h.includes('category') || h.includes('class') || h.includes('size'));
  const tenantCol = headers.findIndex(h =>
    h.includes('tenant') || h.includes('customer') || h.includes('lessee') || h.includes('name') || h.includes('owner'));
  const vesselCol = headers.findIndex(h =>
    h.includes('vessel') || h.includes('boat') || h.includes('yacht'));
  const electricCol = headers.findIndex(h => h.includes('electric') || h.includes('power') || h.includes('amp'));
  const waterCol = headers.findIndex(h => h.includes('water'));
  const liveaboardCol = headers.findIndex(h => h.includes('liveaboard') || h.includes('live'));

  const slips = [];
  for (let r = headerIdx + 1; r < data.length; r++) {
    const row = data[r];
    if (!row) continue;
    const slipId = slipCol >= 0 ? String(row[slipCol] || '').trim() : null;
    if (!slipId) continue;

    const slip = {
      slip: slipId,
      loa: parseNum(row[loaCol]),
      beam: beamCol >= 0 ? parseNum(row[beamCol]) : null,
      rate: parseNum(row[rateCol]),
      status: statusCol >= 0 ? String(row[statusCol] || '') : null,
      type: typeCol >= 0 ? String(row[typeCol] || '') : null,
      tenant: tenantCol >= 0 ? String(row[tenantCol] || '') : null,
      vessel: vesselCol >= 0 ? String(row[vesselCol] || '') : null,
      electric: electricCol >= 0 ? String(row[electricCol] || '') : null,
      liveaboard: liveaboardCol >= 0 ? String(row[liveaboardCol] || '').toLowerCase() : null,
    };

    // Determine if liveaboard
    if (slip.liveaboard) {
      slip.is_liveaboard = ['yes','y','true','1','x'].includes(slip.liveaboard);
    }

    if (slip.rate != null || slip.loa != null) slips.push(slip);
  }

  const totalSlips = slips.length;
  const occupiedSlips = slips.filter(s =>
    !s.status || !s.status.toLowerCase().match(/vacant|available|empty|open/)).length;
  const ratedSlips = slips.filter(s => s.rate != null && s.rate > 0);
  const avgRate = ratedSlips.length > 0
    ? ratedSlips.reduce((s, sl) => s + sl.rate, 0) / ratedSlips.length : 0;
  const totalMonthlyRev = ratedSlips.reduce((s, sl) => s + sl.rate, 0);
  const avgLOA = slips.filter(s => s.loa).length > 0
    ? slips.filter(s => s.loa).reduce((s, sl) => s + sl.loa, 0) / slips.filter(s => s.loa).length : null;
  const liveaboardCount = slips.filter(s => s.is_liveaboard).length;

  // Size distribution
  const sizeBreakdown = {};
  for (const sl of slips) {
    let bucket = 'Unknown';
    if (sl.loa != null) {
      if (sl.loa < 25) bucket = "Under 25'";
      else if (sl.loa < 30) bucket = "25'–30'";
      else if (sl.loa < 40) bucket = "30'–40'";
      else if (sl.loa < 50) bucket = "40'–50'";
      else if (sl.loa < 60) bucket = "50'–60'";
      else bucket = "60'+";
    }
    if (!sizeBreakdown[bucket]) sizeBreakdown[bucket] = { count: 0, totalRate: 0, occupied: 0 };
    sizeBreakdown[bucket].count++;
    if (sl.rate) sizeBreakdown[bucket].totalRate += sl.rate;
    if (!sl.status || !sl.status.toLowerCase().match(/vacant|available|empty|open/)) {
      sizeBreakdown[bucket].occupied++;
    }
  }

  return {
    type: 'slip_schedule',
    year: new Date().getFullYear(),
    parsed: {
      slips: totalSlips,
      occupied: occupiedSlips,
      occupancy: totalSlips > 0 ? occupiedSlips / totalSlips : null,
      avg_rate: avgRate,
      total_monthly_rent: totalMonthlyRev,
      annual_slip_revenue: totalMonthlyRev * 12,
      avg_loa: avgLOA,
      liveaboard_count: liveaboardCount,
      size_breakdown: sizeBreakdown,
      revenue: totalMonthlyRev * 12,
      noi: null,
    },
    slip_detail: slips,
    raw_rows: slips,
  };
}

// ── GENERIC PARSER ──────────────────────────────────────────────────────────
function parseGeneric(data, sheetName) {
  const valueCol = findValueColumn(data);
  const valueCols = [{ key: 'value', col: valueCol }];
  const classifiedRows = parseRows(data, valueCols);

  const parsed = buildParsedSummary(classifiedRows, 'value');

  // Check if we found anything useful
  const hasData = parsed.revenue != null || parsed.noi != null || parsed.revenue_lines.length > 0 ||
    parsed.expense_lines.length > 0;
  if (!hasData) return null;

  return {
    type: 'generic',
    year: null,
    parsed,
    raw_rows: classifiedRows.map(r => ({ label: r.label, value: r.values.value, classified: r.classified })),
  };
}

// ── HELPERS ─────────────────────────────────────────────────────────────────
function parseNum(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  // Handle accounting negatives: (1,234.56) → -1234.56
  let s = String(val).trim();
  const isNeg = /^\(.*\)$/.test(s);
  s = s.replace(/[$,\s%()]/g, '').trim();
  if (!s || isNaN(s)) return null;
  let num = parseFloat(s);
  if (isNeg) num = -num;
  return num;
}

function matchesAny(label, patterns) {
  return patterns.some(p => label.includes(p));
}

function findValueColumn(data) {
  if (!data || data.length < 2) return 1;
  const maxCols = Math.min(10, Math.max(...data.slice(0, 20).map(r => (r || []).length)));

  let bestCol = 1;
  let bestCount = 0;

  for (let c = 1; c < maxCols; c++) {
    let count = 0;
    for (let r = 1; r < Math.min(30, data.length); r++) {
      if (data[r] && parseNum(data[r][c]) != null) count++;
    }
    if (count > bestCount) { bestCount = count; bestCol = c; }
  }

  return bestCol;
}
