// ── FILE PARSERS ────────────────────────────────────────────────────────────
// Parse uploaded financials (Excel/CSV) into normalized deal data.
// Supports: T12, rent rolls, operating statements, multi-year historicals.
// Handles monthly columns (Jan, Feb...), yearly columns (2020, 2021...),
// date columns (1/2024, Jan-24...), and single-value annual summaries.

import { read, utils } from 'xlsx';

// ── MONTH PATTERNS ──────────────────────────────────────────────────────────
const MONTH_NAMES = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const MONTH_FULL = ['january','february','march','april','may','june','july','august',
  'september','october','november','december'];

// Try to parse a header cell as a month reference. Returns { month: 0-11, year: number|null } or null.
function parseMonthHeader(cell) {
  if (cell == null) return null;
  const s = String(cell).trim();

  // Excel serial date number (e.g. 45292 = Jan 2024)
  if (/^\d{5}$/.test(s)) {
    const d = excelDateToJS(parseInt(s));
    if (d) return { month: d.getMonth(), year: d.getFullYear() };
  }

  const lower = s.toLowerCase().replace(/[.\-_]/g, ' ').trim();

  // "Jan 2024", "January 2024", "Jan 24", "Jan-24", "Jan-2024"
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

  // "1/2024", "01/2024", "1/24", "1-2024"
  const slashMatch = lower.match(/^(\d{1,2})\s*[\/\-]\s*(\d{2,4})$/);
  if (slashMatch) {
    const mo = parseInt(slashMatch[1]);
    let yr = parseInt(slashMatch[2]);
    if (yr < 100) yr += 2000;
    if (mo >= 1 && mo <= 12) return { month: mo - 1, year: yr };
  }

  // "2024-01", "2024/01"
  const isoMatch = lower.match(/^(20\d{2})\s*[\/\-]\s*(\d{1,2})$/);
  if (isoMatch) {
    const yr = parseInt(isoMatch[1]);
    const mo = parseInt(isoMatch[2]);
    if (mo >= 1 && mo <= 12) return { month: mo - 1, year: yr };
  }

  // Bare month name with no year: "Jan", "January"
  for (let mi = 0; mi < 12; mi++) {
    if (lower === MONTH_NAMES[mi] || lower === MONTH_FULL[mi]) {
      return { month: mi, year: null };
    }
  }

  return null;
}

function excelDateToJS(serial) {
  if (serial < 1) return null;
  // Excel epoch: Jan 0, 1900 (with the Lotus 1-2-3 leap year bug)
  const utcDays = serial - 25569;
  const d = new Date(utcDays * 86400000);
  if (isNaN(d.getTime())) return null;
  return d;
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

    if (detected.type === 'monthly') {
      const parsed = parseMonthlyColumns(data, detected);
      results.push(...parsed);
    } else if (detected.type === 'operating_statement' || detected.type === 't12') {
      const parsed = parseOperatingStatement(data, detected);
      results.push(...parsed);
    } else if (detected.type === 'rent_roll') {
      const parsed = parseRentRoll(data, detected);
      results.push(parsed);
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
  if (detected.type === 'monthly') {
    return parseMonthlyColumns(lines, detected);
  }
  if (detected.type === 'operating_statement' || detected.type === 't12') {
    return parseOperatingStatement(lines, detected);
  }
  if (detected.type === 'rent_roll') {
    return [parseRentRoll(lines, detected)];
  }
  if (detected.type === 'multi_year') {
    return parseMultiYear(lines, detected);
  }
  const parsed = parseGeneric(lines, 'csv');
  return parsed ? [parsed] : [];
}

// ── SHEET TYPE DETECTION ────────────────────────────────────────────────────
function detectSheetType(data, sheetName) {
  const flatText = data.slice(0, 15).flat().filter(Boolean).map(String).join(' ').toLowerCase();
  const name = (sheetName || '').toLowerCase();

  // Rent roll indicators
  if (name.includes('rent roll') || name.includes('rentroll') ||
      flatText.includes('unit') && (flatText.includes('rent') || flatText.includes('lease')) &&
      (flatText.includes('tenant') || flatText.includes('resident') || flatText.includes('sqft'))) {
    return { type: 'rent_roll' };
  }

  // Check headers for monthly or yearly columns
  // Scan first few rows to find the header row (sometimes row 0 is a title)
  for (let headerIdx = 0; headerIdx < Math.min(5, data.length); headerIdx++) {
    const headerRow = data[headerIdx] || [];
    if (headerRow.length < 2) continue;

    // Check for monthly columns
    const monthCols = [];
    for (let c = 0; c < headerRow.length; c++) {
      const parsed = parseMonthHeader(headerRow[c]);
      if (parsed) monthCols.push({ col: c, ...parsed });
    }
    if (monthCols.length >= 3) {
      // Infer years for bare month names if we have some with years
      const knownYears = monthCols.filter(m => m.year != null);
      if (knownYears.length > 0) {
        // Use the most common year as default
        const yearCounts = {};
        knownYears.forEach(m => { yearCounts[m.year] = (yearCounts[m.year] || 0) + 1; });
        const defaultYear = parseInt(Object.entries(yearCounts).sort((a, b) => b[1] - a[1])[0][0]);
        monthCols.forEach(m => { if (m.year == null) m.year = defaultYear; });
      }
      return { type: 'monthly', monthColumns: monthCols, headerRow: headerIdx };
    }

    // Check for year columns
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

  // Operating statement
  if (flatText.includes('revenue') || flatText.includes('income') ||
      flatText.includes('noi') || flatText.includes('operating') ||
      flatText.includes('expense')) {
    return { type: 'operating_statement' };
  }

  return { type: 'unknown' };
}

// ── MONTHLY COLUMNS PARSER ──────────────────────────────────────────────────
// Handles: Jan | Feb | Mar | ... | Dec (T12 format)
// Also: Jan-22 | Feb-22 | ... | Dec-22 | Jan-23 | ... | Dec-23 (multi-year monthly)
// Also: 1/2024 | 2/2024 | ... | 12/2024
// Groups months by year, sums to annual totals per year.
function parseMonthlyColumns(data, detected) {
  const { monthColumns, headerRow: hIdx } = detected;
  const headerRow = hIdx || 0;

  // Also look for an "Annual" or "Total" column
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
  const yearMap = {}; // { year: [{ col, month }] }
  for (const mc of monthColumns) {
    const yr = mc.year || 0; // 0 = unknown year
    if (!yearMap[yr]) yearMap[yr] = [];
    yearMap[yr].push(mc);
  }

  // Parse row-level data
  const rowData = [];
  for (let r = headerRow + 1; r < data.length; r++) {
    const row = data[r];
    const label = String(row[0] || '').trim();
    if (!label) continue;

    const entry = { label, labelLower: label.toLowerCase(), monthValues: {}, totalValue: null };

    // Read each month column value
    for (const mc of monthColumns) {
      const key = `${mc.year || 0}-${mc.month}`;
      entry.monthValues[key] = parseNum(row[mc.col]);
    }

    // Read total column if present
    if (totalCol != null) {
      entry.totalValue = parseNum(row[totalCol]);
    }

    rowData.push(entry);
  }

  // Build one result per year
  const years = Object.keys(yearMap).map(Number).sort();

  // If all months have year=0 (bare month names), try to infer year from sheet content
  if (years.length === 1 && years[0] === 0) {
    // Look for a year in the first few rows or sheet data
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

    const result = {
      type: 'operating_statement',
      year,
      period_start: `${year}-01-01`,
      period_end: `${year}-12-31`,
      months_covered: cols.length,
      parsed: {
        revenue: null, egi: null, expenses: null, noi: null,
        noi_margin: null, occupancy: null, units: null, debt_service: null,
        monthly_detail: [],
      },
      raw_rows: [],
    };

    // Build monthly detail for this year
    const monthKeys = cols.map(c => `${year}-${c.month}`);

    // Sum each financial row across this year's months
    for (const entry of rowData) {
      const monthVals = monthKeys.map(k => entry.monthValues[k]).filter(v => v != null);
      const annual = monthVals.length > 0 ? monthVals.reduce((s, v) => s + v, 0) : null;

      // If we have a total column and only one year, prefer the total
      const value = (years.length === 1 && entry.totalValue != null) ? entry.totalValue : annual;

      result.raw_rows.push({ label: entry.label, value, monthlyValues: monthVals });

      const label = entry.labelLower;

      // Revenue
      if (matchesAny(label, ['total revenue', 'gross revenue', 'total income', 'gross income',
        'rental income', 'gross potential rent', 'gpr'])) {
        if (!result.parsed.revenue && value != null) result.parsed.revenue = value;
      }
      if (matchesAny(label, ['effective gross income', 'egi'])) {
        result.parsed.egi = value;
      }

      // Expenses
      if (matchesAny(label, ['total expenses', 'total operating expenses', 'operating expenses', 'total expense'])) {
        result.parsed.expenses = value;
      }

      // NOI
      if (matchesAny(label, ['noi', 'net operating income', 'net income'])) {
        result.parsed.noi = value;
      }

      // Occupancy (average across months)
      if (matchesAny(label, ['occupancy', 'physical occupancy', 'economic occupancy', 'occ rate', 'occ%'])) {
        if (monthVals.length > 0) {
          const avg = monthVals.reduce((s, v) => s + v, 0) / monthVals.length;
          result.parsed.occupancy = avg > 1 ? avg / 100 : avg;
        }
      }

      // Units
      if (matchesAny(label, ['units', 'total units', '# units', 'unit count'])) {
        result.parsed.units = value;
      }

      // Debt service
      if (matchesAny(label, ['debt service', 'mortgage', 'loan payment'])) {
        result.parsed.debt_service = value;
      }
    }

    // Build per-month detail for NOI trending
    for (const mc of cols) {
      const monthData = { month: mc.month + 1, year };
      for (const entry of rowData) {
        const val = entry.monthValues[`${year}-${mc.month}`];
        const label = entry.labelLower;
        if (matchesAny(label, ['noi', 'net operating income'])) monthData.noi = val;
        if (matchesAny(label, ['total revenue', 'gross revenue', 'rental income'])) monthData.revenue = val;
        if (matchesAny(label, ['total expenses', 'operating expenses'])) monthData.expenses = val;
      }
      if (monthData.noi != null || monthData.revenue != null) {
        result.parsed.monthly_detail.push(monthData);
      }
    }

    // Annualize if partial year (less than 12 months)
    if (cols.length > 0 && cols.length < 12) {
      const factor = 12 / cols.length;
      if (result.parsed.revenue != null && entry_is_monthly_sum(result.parsed.revenue, cols.length)) {
        result.parsed.revenue_annualized = result.parsed.revenue * factor;
      }
      if (result.parsed.noi != null) {
        result.parsed.noi_annualized = result.parsed.noi * factor;
      }
    }

    // Compute NOI from revenue - expenses if missing
    if (result.parsed.noi == null && result.parsed.revenue != null && result.parsed.expenses != null) {
      result.parsed.noi = result.parsed.revenue - Math.abs(result.parsed.expenses);
    }

    // NOI margin
    const rev = result.parsed.egi || result.parsed.revenue;
    if (result.parsed.noi != null && rev && rev > 0) {
      result.parsed.noi_margin = result.parsed.noi / rev;
    }

    results.push(result);
  }

  return results;
}

// Check if a value looks like it was summed from monthly values (vs already annual)
function entry_is_monthly_sum(value, monthCount) {
  // Heuristic: if we're working with monthly columns, the sum IS the period total
  return true;
}

// ── OPERATING STATEMENT / T12 (single-value columns) ────────────────────────
function parseOperatingStatement(data, detected) {
  const result = {
    type: detected.type || 'operating_statement',
    year: null,
    period_start: null,
    period_end: null,
    parsed: {
      revenue: null,
      egi: null,
      expenses: null,
      noi: null,
      noi_margin: null,
      occupancy: null,
      units: null,
      debt_service: null,
    },
    raw_rows: [],
  };

  const valueColIdx = findValueColumn(data);

  for (const row of data) {
    const label = String(row[0] || '').trim().toLowerCase();
    const value = parseNum(row[valueColIdx]);

    if (!label) continue;

    result.raw_rows.push({ label: row[0], value });

    if (matchesAny(label, ['total revenue', 'gross revenue', 'total income', 'gross income',
      'rental income', 'gross potential rent', 'gpr', 'effective gross income', 'egi'])) {
      if (matchesAny(label, ['effective gross income', 'egi'])) {
        result.parsed.egi = value;
      } else if (!result.parsed.revenue && value != null) {
        result.parsed.revenue = value;
      }
    }

    if (matchesAny(label, ['total expenses', 'total operating expenses', 'operating expenses',
      'total expense'])) {
      result.parsed.expenses = value;
    }

    if (matchesAny(label, ['noi', 'net operating income', 'net income'])) {
      result.parsed.noi = value;
    }

    if (matchesAny(label, ['occupancy', 'physical occupancy', 'economic occupancy', 'occ rate', 'occ%'])) {
      if (value != null) {
        result.parsed.occupancy = value > 1 ? value / 100 : value;
      }
    }

    if (matchesAny(label, ['units', 'total units', '# units', 'unit count'])) {
      result.parsed.units = value;
    }

    if (matchesAny(label, ['debt service', 'mortgage', 'loan payment'])) {
      result.parsed.debt_service = value;
    }

    if (!result.year) {
      const yearMatch = label.match(/(20\d{2}|19\d{2})/);
      if (yearMatch) result.year = parseInt(yearMatch[1]);
    }
  }

  if (result.parsed.noi == null && result.parsed.revenue != null && result.parsed.expenses != null) {
    result.parsed.noi = result.parsed.revenue - result.parsed.expenses;
  }

  const rev = result.parsed.egi || result.parsed.revenue;
  if (result.parsed.noi != null && rev && rev > 0) {
    result.parsed.noi_margin = result.parsed.noi / rev;
  }

  if (!result.year) {
    const headerText = data.slice(0, 3).flat().filter(Boolean).map(String).join(' ');
    const ym = headerText.match(/(20\d{2}|19\d{2})/);
    if (ym) result.year = parseInt(ym[1]);
  }

  return [result];
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

  return yearCols.map(({ col, year }) => {
    const result = {
      type: 'operating_statement',
      year,
      period_start: `${year}-01-01`,
      period_end: `${year}-12-31`,
      parsed: {
        revenue: null, egi: null, expenses: null, noi: null,
        noi_margin: null, occupancy: null, units: null, debt_service: null,
      },
      raw_rows: [],
    };

    for (let r = hIdx + 1; r < data.length; r++) {
      const label = String(data[r][0] || '').trim().toLowerCase();
      const value = parseNum(data[r][col]);
      if (!label) continue;

      result.raw_rows.push({ label: data[r][0], value });

      if (matchesAny(label, ['total revenue', 'gross revenue', 'total income', 'rental income', 'gpr'])) {
        if (!result.parsed.revenue) result.parsed.revenue = value;
      }
      if (matchesAny(label, ['effective gross income', 'egi'])) result.parsed.egi = value;
      if (matchesAny(label, ['total expenses', 'total operating expenses', 'operating expenses'])) result.parsed.expenses = value;
      if (matchesAny(label, ['noi', 'net operating income'])) result.parsed.noi = value;
      if (matchesAny(label, ['occupancy', 'physical occupancy'])) {
        if (value != null) result.parsed.occupancy = value > 1 ? value / 100 : value;
      }
      if (matchesAny(label, ['units', 'total units'])) result.parsed.units = value;
    }

    if (result.parsed.noi == null && result.parsed.revenue != null && result.parsed.expenses != null) {
      result.parsed.noi = result.parsed.revenue - result.parsed.expenses;
    }
    const rev = result.parsed.egi || result.parsed.revenue;
    if (result.parsed.noi != null && rev && rev > 0) {
      result.parsed.noi_margin = result.parsed.noi / rev;
    }

    return result;
  });
}

// ── RENT ROLL ───────────────────────────────────────────────────────────────
function parseRentRoll(data, detected) {
  let headerIdx = 0;
  for (let r = 0; r < Math.min(10, data.length); r++) {
    const rowText = (data[r] || []).map(String).join(' ').toLowerCase();
    if (rowText.includes('unit') && (rowText.includes('rent') || rowText.includes('rate'))) {
      headerIdx = r;
      break;
    }
  }

  const headers = (data[headerIdx] || []).map(h => String(h || '').trim().toLowerCase());

  const unitCol = headers.findIndex(h => h.includes('unit'));
  const rentCol = headers.findIndex(h =>
    h.includes('rent') || h.includes('rate') || h.includes('market'));
  const sqftCol = headers.findIndex(h => h.includes('sqft') || h.includes('sq ft') || h.includes('size'));
  const statusCol = headers.findIndex(h =>
    h.includes('status') || h.includes('occupied') || h.includes('vacant'));
  const typeCol = headers.findIndex(h =>
    h.includes('type') || h.includes('floorplan') || h.includes('bed'));

  const units = [];
  for (let r = headerIdx + 1; r < data.length; r++) {
    const row = data[r];
    if (!row || !row[unitCol]) continue;

    const unit = {
      unit: String(row[unitCol] || ''),
      rent: parseNum(row[rentCol]),
      sqft: parseNum(row[sqftCol]),
      status: statusCol >= 0 ? String(row[statusCol] || '') : null,
      type: typeCol >= 0 ? String(row[typeCol] || '') : null,
    };
    if (unit.rent != null || unit.sqft != null) units.push(unit);
  }

  const totalUnits = units.length;
  const occupiedUnits = units.filter(u =>
    !u.status || !u.status.toLowerCase().includes('vacant')).length;
  const avgRent = units.length > 0
    ? units.filter(u => u.rent).reduce((s, u) => s + u.rent, 0) / units.filter(u => u.rent).length
    : 0;
  const totalMonthlyRent = units.filter(u => u.rent).reduce((s, u) => s + u.rent, 0);
  const avgSqft = units.filter(u => u.sqft).length > 0
    ? units.filter(u => u.sqft).reduce((s, u) => s + u.sqft, 0) / units.filter(u => u.sqft).length
    : null;

  return {
    type: 'rent_roll',
    year: new Date().getFullYear(),
    parsed: {
      units: totalUnits,
      occupied: occupiedUnits,
      occupancy: totalUnits > 0 ? occupiedUnits / totalUnits : null,
      avg_rent: avgRent,
      total_monthly_rent: totalMonthlyRent,
      annual_gpr: totalMonthlyRent * 12,
      avg_sqft: avgSqft,
      revenue: totalMonthlyRent * 12,
      noi: null,
    },
    unit_detail: units,
    raw_rows: units,
  };
}

// ── GENERIC PARSER ──────────────────────────────────────────────────────────
function parseGeneric(data, sheetName) {
  const result = {
    type: 'generic',
    year: null,
    parsed: {
      revenue: null, egi: null, expenses: null, noi: null,
      noi_margin: null, occupancy: null, units: null,
    },
    raw_rows: [],
  };

  const valueCol = findValueColumn(data);
  let foundAnything = false;

  for (const row of data) {
    const label = String(row[0] || '').trim().toLowerCase();
    const value = parseNum(row[valueCol]);
    if (!label || value == null) continue;

    result.raw_rows.push({ label: row[0], value });

    if (label.includes('revenue') || label.includes('income')) {
      if (!result.parsed.revenue) { result.parsed.revenue = value; foundAnything = true; }
    }
    if (label.includes('expense')) {
      if (!result.parsed.expenses) { result.parsed.expenses = value; foundAnything = true; }
    }
    if (label.includes('noi') || label.includes('net operating')) {
      result.parsed.noi = value; foundAnything = true;
    }
  }

  if (!foundAnything) return null;

  if (result.parsed.noi == null && result.parsed.revenue != null && result.parsed.expenses != null) {
    result.parsed.noi = result.parsed.revenue - result.parsed.expenses;
  }

  return result;
}

// ── HELPERS ─────────────────────────────────────────────────────────────────
function parseNum(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  const s = String(val).replace(/[$,\s%()]/g, '').trim();
  if (!s || isNaN(s)) return null;
  return parseFloat(s);
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
