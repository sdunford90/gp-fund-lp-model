// ── DATABASE SCHEMA ──────────────────────────────────────────────────────────
// Auto-creates deal tables alongside existing scenarios/global_items tables.

export async function ensureSchema(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Deals: core deal record
    await client.query(`
      CREATE TABLE IF NOT EXISTS deals (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        property_type VARCHAR(100),
        market VARCHAR(255),
        address TEXT,
        units INTEGER,
        slips INTEGER,
        price NUMERIC,
        start_month INTEGER DEFAULT 1,
        status VARCHAR(50) DEFAULT 'pipeline',
        notes TEXT,
        assumptions JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Deal financials: each uploaded file becomes one or more rows
    await client.query(`
      CREATE TABLE IF NOT EXISTS deal_financials (
        id SERIAL PRIMARY KEY,
        deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        year INTEGER,
        period_start DATE,
        period_end DATE,
        filename VARCHAR(500),
        parsed JSONB NOT NULL DEFAULT '{}',
        raw_rows JSONB DEFAULT '[]',
        unit_detail JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Deal results: cached model outputs per assumption set
    await client.query(`
      CREATE TABLE IF NOT EXISTS deal_results (
        id SERIAL PRIMARY KEY,
        deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
        assumptions JSONB NOT NULL DEFAULT '{}',
        result JSONB NOT NULL DEFAULT '{}',
        computed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Fund settings: reusable fund-level assumption sets
    await client.query(`
      CREATE TABLE IF NOT EXISTS fund_settings (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        settings JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Revenue lines: per-deal unit mix / business lines (slips, lifts, storage, etc.)
    await client.query(`
      CREATE TABLE IF NOT EXISTS deal_revenue_lines (
        id SERIAL PRIMARY KEY,
        deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
        category VARCHAR(100) NOT NULL,
        line_type VARCHAR(100) NOT NULL,
        unit_count INTEGER DEFAULT 0,
        rate NUMERIC DEFAULT 0,
        rate_period VARCHAR(20) DEFAULT 'monthly',
        occupancy NUMERIC DEFAULT 1.0,
        growth_rate NUMERIC DEFAULT 0.03,
        start_year INTEGER DEFAULT 1,
        notes TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Expense lines: per-deal operating expenses
    await client.query(`
      CREATE TABLE IF NOT EXISTS deal_expense_lines (
        id SERIAL PRIMARY KEY,
        deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
        category VARCHAR(100) NOT NULL,
        line_type VARCHAR(100) NOT NULL,
        amount NUMERIC DEFAULT 0,
        rate_period VARCHAR(20) DEFAULT 'annual',
        growth_rate NUMERIC DEFAULT 0.03,
        pct_of_revenue NUMERIC,
        notes TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Deal proforma: per-deal year-by-year proforma overrides
    await client.query(`
      CREATE TABLE IF NOT EXISTS deal_proforma (
        id SERIAL PRIMARY KEY,
        deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
        year INTEGER NOT NULL,
        revenue_overrides JSONB DEFAULT '{}',
        expense_overrides JSONB DEFAULT '{}',
        assumptions_overrides JSONB DEFAULT '{}',
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(deal_id, year)
      )
    `);

    // Existing tables — ensure they exist (idempotent)
    await client.query(`
      CREATE TABLE IF NOT EXISTS scenarios (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS global_items (
        id SERIAL PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Migrations — add columns to existing tables safely
    await client.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS slips INTEGER`);

    await client.query('COMMIT');
    console.log('Database schema ready');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Schema setup error:', err);
    throw err;
  } finally {
    client.release();
  }
}
