import express from "express";
import { Pool } from "pg";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const isProd = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || (isProd ? 5000 : 3001);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("ssl") ? { rejectUnauthorized: false } : false,
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scenarios (
      name        TEXT PRIMARY KEY,
      data        JSONB NOT NULL,
      saved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Add columns if the table existed before these were introduced
  await pool.query(`ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await pool.query(`ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  console.log("DB ready");
}

// ── API routes ────────────────────────────────────────────────────────────────

// List all scenarios with full data
app.get("/api/scenarios", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT name, data, saved_at, updated_at FROM scenarios ORDER BY updated_at DESC"
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Get one scenario by name
app.get("/api/scenarios/:name", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT name, data, saved_at, updated_at FROM scenarios WHERE name = $1",
      [req.params.name]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Save (upsert) a scenario
app.post("/api/scenarios/:name", async (req, res) => {
  try {
    const { data } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO scenarios (name, data, saved_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (name) DO UPDATE
         SET data = EXCLUDED.data, updated_at = NOW()
       RETURNING name, saved_at, updated_at`,
      [req.params.name, JSON.stringify(data)]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Delete a scenario
app.delete("/api/scenarios/:name", async (req, res) => {
  try {
    await pool.query("DELETE FROM scenarios WHERE name = $1", [req.params.name]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Static file serving in production ────────────────────────────────────────
if (isProd) {
  const distPath = join(__dirname, "..", "dist");
  if (existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get("/{*path}", (req, res) => {
      res.sendFile(join(distPath, "index.html"));
    });
  }
}

initDb().then(() => {
  app.listen(PORT, "0.0.0.0", () =>
    console.log(`Server running on port ${PORT} (${isProd ? "prod" : "dev"})`)
  );
});
