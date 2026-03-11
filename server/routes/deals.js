// ── DEAL ROUTES ─────────────────────────────────────────────────────────────
import { Router } from 'express';
import multer from 'multer';
import { parseUpload } from '../../engine/parser.js';
import { analyzeDeal, compareDeals, DEFAULT_ASSUMPTIONS } from '../../engine/model.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.xlsm', '.csv'];
    const ext = '.' + file.originalname.split('.').pop().toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${ext}`));
  }
});

export default function dealRoutes(pool) {
  const router = Router();

  // ── LIST DEALS ──────────────────────────────────────────────────────────
  router.get('/deals', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT d.*,
          (SELECT COUNT(*) FROM deal_financials WHERE deal_id = d.id) AS financial_count,
          (SELECT json_agg(json_build_object(
            'id', df.id, 'type', df.type, 'year', df.year, 'filename', df.filename
          ) ORDER BY df.year)
          FROM deal_financials df WHERE df.deal_id = d.id) AS financials_summary
        FROM deals d ORDER BY d.updated_at DESC
      `);
      res.json(result.rows);
    } catch (err) {
      console.error('Error listing deals:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET SINGLE DEAL (with all financials) ───────────────────────────────
  router.get('/deals/:id', async (req, res) => {
    try {
      const deal = await pool.query('SELECT * FROM deals WHERE id = $1', [req.params.id]);
      if (deal.rows.length === 0) return res.status(404).json({ error: 'Deal not found' });

      const [financials, latestResult, revenueLines, expenseLines, proforma] = await Promise.all([
        pool.query('SELECT * FROM deal_financials WHERE deal_id = $1 ORDER BY year, period_start', [req.params.id]),
        pool.query('SELECT * FROM deal_results WHERE deal_id = $1 ORDER BY computed_at DESC LIMIT 1', [req.params.id]),
        pool.query('SELECT * FROM deal_revenue_lines WHERE deal_id = $1 ORDER BY sort_order', [req.params.id]),
        pool.query('SELECT * FROM deal_expense_lines WHERE deal_id = $1 ORDER BY sort_order', [req.params.id]),
        pool.query('SELECT * FROM deal_proforma WHERE deal_id = $1 ORDER BY year', [req.params.id]),
      ]);

      res.json({
        ...deal.rows[0],
        financials: financials.rows,
        latestResult: latestResult.rows[0] || null,
        revenueLines: revenueLines.rows,
        expenseLines: expenseLines.rows,
        proforma: proforma.rows,
      });
    } catch (err) {
      console.error('Error getting deal:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── CREATE DEAL ─────────────────────────────────────────────────────────
  router.post('/deals', async (req, res) => {
    const { name, property_type, market, address, units, slips, price, start_month, notes, assumptions } = req.body;
    try {
      const result = await pool.query(
        `INSERT INTO deals (name, property_type, market, address, units, slips, price, start_month, notes, assumptions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [name, property_type, market, address, units || slips, slips || units, price, start_month || 1, notes,
         JSON.stringify(assumptions || {})]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error('Error creating deal:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── UPDATE DEAL ─────────────────────────────────────────────────────────
  router.put('/deals/:id', async (req, res) => {
    const { name, property_type, market, address, units, slips, price, start_month, status, notes, assumptions } = req.body;
    try {
      const result = await pool.query(
        `UPDATE deals SET name=$1, property_type=$2, market=$3, address=$4, units=$5, slips=$6, price=$7,
         start_month=$8, status=$9, notes=$10, assumptions=$11, updated_at=NOW()
         WHERE id=$12 RETURNING *`,
        [name, property_type, market, address, units || slips, slips || units, price, start_month, status, notes,
         JSON.stringify(assumptions || {}), req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Deal not found' });
      res.json(result.rows[0]);
    } catch (err) {
      console.error('Error updating deal:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE DEAL ─────────────────────────────────────────────────────────
  router.delete('/deals/:id', async (req, res) => {
    try {
      await pool.query('DELETE FROM deals WHERE id = $1', [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error('Error deleting deal:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── UPLOAD FINANCIALS ─────────────────────────────────────────────────
  // Upload one or more files for a deal. Parses and stores the data.
  // Supports multi-year: upload a single file with 5+ years of columns,
  // or upload individual files for each year.
  router.post('/deals/:id/upload', upload.array('files', 20), async (req, res) => {
    const dealId = req.params.id;

    try {
      // Verify deal exists
      const deal = await pool.query('SELECT id FROM deals WHERE id = $1', [dealId]);
      if (deal.rows.length === 0) return res.status(404).json({ error: 'Deal not found' });

      const allParsed = [];

      for (const file of req.files) {
        const parsed = parseUpload(file.buffer, file.originalname);

        for (const item of parsed) {
          const result = await pool.query(
            `INSERT INTO deal_financials (deal_id, type, year, period_start, period_end, filename, parsed, raw_rows, unit_detail)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [
              dealId,
              item.type,
              item.year,
              item.period_start || null,
              item.period_end || null,
              file.originalname,
              JSON.stringify(item.parsed),
              JSON.stringify(item.raw_rows || []),
              item.unit_detail ? JSON.stringify(item.unit_detail) : null,
            ]
          );
          allParsed.push(result.rows[0]);
        }
      }

      // Update deal's updated_at
      await pool.query('UPDATE deals SET updated_at = NOW() WHERE id = $1', [dealId]);

      res.json({
        success: true,
        filesProcessed: req.files.length,
        recordsCreated: allParsed.length,
        financials: allParsed,
      });
    } catch (err) {
      console.error('Error uploading financials:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE A FINANCIAL RECORD ──────────────────────────────────────────
  router.delete('/deals/:dealId/financials/:id', async (req, res) => {
    try {
      await pool.query(
        'DELETE FROM deal_financials WHERE id = $1 AND deal_id = $2',
        [req.params.id, req.params.dealId]
      );
      res.json({ success: true });
    } catch (err) {
      console.error('Error deleting financial:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── ANALYZE DEAL ──────────────────────────────────────────────────────
  // Run the full model on a deal's financials with given assumptions.
  // Pass overrides in the body to test different scenarios.
  router.post('/deals/:id/analyze', async (req, res) => {
    const dealId = req.params.id;
    const overrides = req.body || {};

    try {
      // Get deal + financials
      const deal = await pool.query('SELECT * FROM deals WHERE id = $1', [dealId]);
      if (deal.rows.length === 0) return res.status(404).json({ error: 'Deal not found' });

      const financials = await pool.query(
        'SELECT * FROM deal_financials WHERE deal_id = $1 ORDER BY year, period_start',
        [dealId]
      );

      const dealData = {
        ...deal.rows[0],
        financials: financials.rows,
      };

      // Merge: default assumptions → deal-level assumptions → request overrides
      const fundAssumptions = {
        ...DEFAULT_ASSUMPTIONS,
        ...(deal.rows[0].assumptions || {}),
        ...overrides,
      };

      const analysis = analyzeDeal(dealData, fundAssumptions);

      // Cache the result
      await pool.query(
        `INSERT INTO deal_results (deal_id, assumptions, result) VALUES ($1, $2, $3)`,
        [dealId, JSON.stringify(fundAssumptions), JSON.stringify(analysis)]
      );

      res.json(analysis);
    } catch (err) {
      console.error('Error analyzing deal:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── COMPARE DEALS ──────────────────────────────────────────────────────
  // POST body: { dealIds: [1, 2, 3], assumptions: {...} }
  router.post('/deals/compare', async (req, res) => {
    const { dealIds = [], assumptions = {} } = req.body;

    if (dealIds.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 deal IDs to compare' });
    }

    try {
      const fundAssumptions = { ...DEFAULT_ASSUMPTIONS, ...assumptions };
      const results = [];

      for (const id of dealIds) {
        const deal = await pool.query('SELECT * FROM deals WHERE id = $1', [id]);
        if (deal.rows.length === 0) continue;

        const financials = await pool.query(
          'SELECT * FROM deal_financials WHERE deal_id = $1 ORDER BY year, period_start',
          [id]
        );

        const dealData = {
          ...deal.rows[0],
          financials: financials.rows,
        };

        const merged = { ...fundAssumptions, ...(deal.rows[0].assumptions || {}) };
        const analysis = analyzeDeal(dealData, merged);
        results.push({ dealId: id, dealName: deal.rows[0].name, ...analysis });
      }

      res.json({
        deals: results,
        assumptions: fundAssumptions,
        summary: results.map(r => ({
          name: r.dealName,
          price: r.deal.computedPrice,
          capRate: r.deal.computedCapRate,
          noiGrowth: r.deal.computedNOIGrowth,
          lpIRR: r.modelResult.lpIRR,
          lpMOIC: r.modelResult.lpMOIC,
          gpPromote: r.modelResult.gpPromote,
          totalExitValue: r.modelResult.totExitVal,
        })),
      });
    } catch (err) {
      console.error('Error comparing deals:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── REVENUE LINES (unit mix / business lines) ─────────────────────────
  // Get all revenue lines for a deal
  router.get('/deals/:id/revenue-lines', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM deal_revenue_lines WHERE deal_id = $1 ORDER BY sort_order, category, line_type',
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Save all revenue lines for a deal (bulk replace)
  router.put('/deals/:id/revenue-lines', async (req, res) => {
    const { lines = [] } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM deal_revenue_lines WHERE deal_id = $1', [req.params.id]);
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await client.query(
          `INSERT INTO deal_revenue_lines (deal_id, category, line_type, unit_count, rate, rate_period, occupancy, growth_rate, start_year, notes, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [req.params.id, l.category, l.line_type, l.unit_count || 0, l.rate || 0,
           l.rate_period || 'monthly', l.occupancy ?? 1.0, l.growth_rate ?? 0.03,
           l.start_year || 1, l.notes || null, i]
        );
      }
      await client.query('COMMIT');
      await pool.query('UPDATE deals SET updated_at = NOW() WHERE id = $1', [req.params.id]);
      const result = await pool.query(
        'SELECT * FROM deal_revenue_lines WHERE deal_id = $1 ORDER BY sort_order',
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  // ── EXPENSE LINES ─────────────────────────────────────────────────────
  router.get('/deals/:id/expense-lines', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM deal_expense_lines WHERE deal_id = $1 ORDER BY sort_order, category, line_type',
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/deals/:id/expense-lines', async (req, res) => {
    const { lines = [] } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM deal_expense_lines WHERE deal_id = $1', [req.params.id]);
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await client.query(
          `INSERT INTO deal_expense_lines (deal_id, category, line_type, amount, rate_period, growth_rate, pct_of_revenue, notes, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [req.params.id, l.category, l.line_type, l.amount || 0,
           l.rate_period || 'annual', l.growth_rate ?? 0.03,
           l.pct_of_revenue || null, l.notes || null, i]
        );
      }
      await client.query('COMMIT');
      await pool.query('UPDATE deals SET updated_at = NOW() WHERE id = $1', [req.params.id]);
      const result = await pool.query(
        'SELECT * FROM deal_expense_lines WHERE deal_id = $1 ORDER BY sort_order',
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  // ── PROFORMA ─────────────────────────────────────────────────────────────
  // Get proforma overrides for a deal
  router.get('/deals/:id/proforma', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM deal_proforma WHERE deal_id = $1 ORDER BY year',
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Save proforma year overrides (upsert per year)
  router.put('/deals/:id/proforma', async (req, res) => {
    const { years = [] } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const yr of years) {
        await client.query(
          `INSERT INTO deal_proforma (deal_id, year, revenue_overrides, expense_overrides, assumptions_overrides, notes, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())
           ON CONFLICT (deal_id, year) DO UPDATE SET
             revenue_overrides = $3, expense_overrides = $4, assumptions_overrides = $5, notes = $6, updated_at = NOW()`,
          [req.params.id, yr.year,
           JSON.stringify(yr.revenue_overrides || {}),
           JSON.stringify(yr.expense_overrides || {}),
           JSON.stringify(yr.assumptions_overrides || {}),
           yr.notes || null]
        );
      }
      await client.query('COMMIT');
      const result = await pool.query(
        'SELECT * FROM deal_proforma WHERE deal_id = $1 ORDER BY year',
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  // ── DEAL PRESENTATION DATA ────────────────────────────────────────────
  // Returns everything needed for a deal presentation: historicals + proforma + analysis
  router.get('/deals/:id/presentation', async (req, res) => {
    try {
      const deal = await pool.query('SELECT * FROM deals WHERE id = $1', [req.params.id]);
      if (deal.rows.length === 0) return res.status(404).json({ error: 'Deal not found' });

      const [financials, revenueLines, expenseLines, proforma, latestResult] = await Promise.all([
        pool.query('SELECT * FROM deal_financials WHERE deal_id = $1 ORDER BY year', [req.params.id]),
        pool.query('SELECT * FROM deal_revenue_lines WHERE deal_id = $1 ORDER BY sort_order', [req.params.id]),
        pool.query('SELECT * FROM deal_expense_lines WHERE deal_id = $1 ORDER BY sort_order', [req.params.id]),
        pool.query('SELECT * FROM deal_proforma WHERE deal_id = $1 ORDER BY year', [req.params.id]),
        pool.query('SELECT * FROM deal_results WHERE deal_id = $1 ORDER BY computed_at DESC LIMIT 1', [req.params.id]),
      ]);

      res.json({
        deal: deal.rows[0],
        financials: financials.rows,
        revenueLines: revenueLines.rows,
        expenseLines: expenseLines.rows,
        proforma: proforma.rows,
        analysis: latestResult.rows[0]?.result || null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── FUND SETTINGS CRUD ─────────────────────────────────────────────────
  router.get('/fund-settings', async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM fund_settings ORDER BY name');
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/fund-settings', async (req, res) => {
    const { name, settings } = req.body;
    try {
      const result = await pool.query(
        `INSERT INTO fund_settings (name, settings, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (name) DO UPDATE SET settings = $2, updated_at = NOW()
         RETURNING *`,
        [name, JSON.stringify(settings)]
      );
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
