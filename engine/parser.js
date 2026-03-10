// ── FILE PARSERS ────────────────────────────────────────────────────────────
// Parse uploaded financials (Excel/CSV) into normalized deal data.
// Supports: T12, rent rolls, operating statements, multi-year historicals.

import { read, utils } from 'xlsx';

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
    const data = utils.sheet_to_json(sheet, { header: 1, defval: null });

    if (!data || data.length < 2) continue;

    // Detect what kind of financial data this is
    const detected = detectSheetType(data, sheetName);

    if (detected.type === 'operating_statement' || detected.type === 't12') {
      const parsed = parseOperatingStatement(data, detected);
      results.push(...parsed);
    } else if (detected.type === 'rent_roll') {
      const parsed = parseRentRoll(data, detected);
      results.push(parsed);
    } else if (detected.type === 'multi_year') {
      const parsed = parseMultiYear(data, detected);
      results.push(...parsed);
    } else {
      // Try generic parse — look for revenue/expense rows
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
  if (detected.type === 'operating_statement' || detected.type === 't12') {
    return parseOperatingStatement(lines, detected);
  }
  if (detected.type === 'rent_roll') {
    return [parseRentRoll(lines, detected)];
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

  // T12 / trailing twelve
  if (name.includes('t12') || name.includes('t-12') || name.includes('trailing') ||
      flatText.includes('t12') || flatText.includes('trailing twelve') || flatText.includes('trailing 12')) {
    return { type: 't12' };
  }

  // Multi-year if we see multiple year columns
  const headerRow = data[0] || [];
  const yearCols = headerRow.filter(c => {
    const s = String(c || '');
    return /^(19|20)\d{2}$/.test(s) || /fy\s*(19|20)\d{2}/i.test(s);
  });
  if (yearCols.length >= 2) {
    return { type: 'multi_year', yearColumns: yearCols.map(String) };
  }

  // Operating statement
  if (flatText.includes('revenue') || flatText.includes('income') ||
      flatText.includes('noi') || flatText.includes('operating') ||
      flatText.includes('expense')) {
    return { type: 'operating_statement' };
  }

  return { type: 'unknown' };
}

// ── OPERATING STATEMENT / T12 ───────────────────────────────────────────────
function parseOperatingStatement(data, detected) {
  const result = {
    type: detected.type || 'operating_statement',
    year: null,
    period_start: null,
    period_end: null,
    parsed: {
      revenue: null,
      egi: null,       // Effective Gross Income
      expenses: null,
      noi: null,
      noi_margin: null,
      occupancy: null,
      units: null,
      debt_service: null,
    },
    raw_rows: [],
  };

  // Find the value column (usually column B or the last numeric column)
  const valueColIdx = findValueColumn(data);

  for (const row of data) {
    const label = String(row[0] || '').trim().toLowerCase();
    const value = parseNum(row[valueColIdx]);

    if (!label) continue;

    result.raw_rows.push({ label: row[0], value });

    // Revenue / Income
    if (matchesAny(label, ['total revenue', 'gross revenue', 'total income', 'gross income',
      'rental income', 'gross potential rent', 'gpr', 'effective gross income', 'egi'])) {
      if (matchesAny(label, ['effective gross income', 'egi'])) {
        result.parsed.egi = value;
      } else if (!result.parsed.revenue && value != null) {
        result.parsed.revenue = value;
      }
    }

    // Expenses
    if (matchesAny(label, ['total expenses', 'total operating expenses', 'operating expenses',
      'total expense'])) {
      result.parsed.expenses = value;
    }

    // NOI
    if (matchesAny(label, ['noi', 'net operating income', 'net income'])) {
      result.parsed.noi = value;
    }

    // Occupancy
    if (matchesAny(label, ['occupancy', 'physical occupancy', 'economic occupancy', 'occ rate', 'occ%'])) {
      if (value != null) {
        result.parsed.occupancy = value > 1 ? value / 100 : value;
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

    // Year detection
    if (!result.year) {
      const yearMatch = label.match(/(20\d{2}|19\d{2})/);
      if (yearMatch) result.year = parseInt(yearMatch[1]);
    }
  }

  // Compute NOI if we have revenue and expenses but not NOI
  if (result.parsed.noi == null && result.parsed.revenue != null && result.parsed.expenses != null) {
    result.parsed.noi = result.parsed.revenue - result.parsed.expenses;
  }

  // Compute NOI margin
  const rev = result.parsed.egi || result.parsed.revenue;
  if (result.parsed.noi != null && rev && rev > 0) {
    result.parsed.noi_margin = result.parsed.noi / rev;
  }

  // Try to extract year from headers if not found
  if (!result.year) {
    const headerText = data.slice(0, 3).flat().filter(Boolean).map(String).join(' ');
    const ym = headerText.match(/(20\d{2}|19\d{2})/);
    if (ym) result.year = parseInt(ym[1]);
  }

  return [result];
}

// ── MULTI-YEAR ──────────────────────────────────────────────────────────────
function parseMultiYear(data, detected) {
  const headerRow = data[0] || [];
  const yearCols = [];

  // Find which columns correspond to years
  for (let c = 0; c < headerRow.length; c++) {
    const s = String(headerRow[c] || '');
    const ym = s.match(/((?:19|20)\d{2})/);
    if (ym) yearCols.push({ col: c, year: parseInt(ym[1]) });
  }

  if (yearCols.length === 0) return [];

  // Parse each year column
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

    for (let r = 1; r < data.length; r++) {
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
  // Find header row
  let headerIdx = 0;
  for (let r = 0; r < Math.min(10, data.length); r++) {
    const rowText = (data[r] || []).map(String).join(' ').toLowerCase();
    if (rowText.includes('unit') && (rowText.includes('rent') || rowText.includes('rate'))) {
      headerIdx = r;
      break;
    }
  }

  const headers = (data[headerIdx] || []).map(h => String(h || '').trim().toLowerCase());

  // Map columns
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
      revenue: totalMonthlyRent * 12,  // annualized for model compatibility
      noi: null,  // can't compute from rent roll alone
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

    // Look for any financial-sounding rows
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
  // Look for the first column (after col 0) that has mostly numbers
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
