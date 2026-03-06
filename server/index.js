import express from 'express';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Pool } = pg;
const app = express();
app.use(express.json({ limit: '10mb' }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get('/api/scenarios', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, data, updated_at FROM scenarios ORDER BY updated_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching scenarios:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scenarios', async (req, res) => {
  const { name, data } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO scenarios (name, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (name) DO UPDATE SET data = $2, updated_at = NOW()
       RETURNING id, name, data, updated_at`,
      [name, JSON.stringify(data)]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error saving scenario:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/scenarios/:name', async (req, res) => {
  try {
    await pool.query('DELETE FROM scenarios WHERE name = $1', [req.params.name]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting scenario:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/globals', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, type, data FROM global_items ORDER BY id');
    const grouped = {};
    for (const row of result.rows) {
      if (!grouped[row.type]) grouped[row.type] = [];
      grouped[row.type].push(row.data);
    }
    res.json(grouped);
  } catch (err) {
    console.error('Error fetching globals:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/globals/bulk', async (req, res) => {
  const { type, items } = req.body;
  if (!type || !Array.isArray(items)) {
    return res.status(400).json({ error: 'type and items[] required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM global_items WHERE type = $1', [type]);
    for (const item of items) {
      await client.query(
        'INSERT INTO global_items (type, data, updated_at) VALUES ($1, $2, NOW())',
        [type, JSON.stringify(item)]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, count: items.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error saving globals:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

const distPath = join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('/{*path}', (req, res) => {
  res.sendFile(join(distPath, 'index.html'));
});

const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
const PORT = process.env.PORT || (isProduction ? 5000 : 3001);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
