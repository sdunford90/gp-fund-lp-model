import express from "express";
import { Pool } from "pg";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { writeFile, mkdir, readFile } from "fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const isProd = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || (isProd ? 5000 : 3001);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("ssl") ? { rejectUnauthorized: false } : false,
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ── File upload endpoint (for large JSON datasets) ──────────────────────────

app.post("/api/upload/:filename", async (req, res) => {
  try {
    const dir = join(__dirname, "..", "public", "data");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, req.params.filename);
    await writeFile(filePath, JSON.stringify(req.body, null, 0));
    const sizeMB = (Buffer.byteLength(JSON.stringify(req.body)) / 1e6).toFixed(1);
    console.log(`Uploaded ${req.params.filename} (${sizeMB}MB)`);
    res.json({ ok: true, file: req.params.filename, sizeMB });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scenarios (
      name        TEXT PRIMARY KEY,
      data        JSONB NOT NULL,
      saved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await pool.query(`ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marina_database (
      key        TEXT PRIMARY KEY,
      raw        JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marina_interest (
      marina_id  TEXT PRIMARY KEY,
      status     TEXT NOT NULL,
      notes      TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
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

// ── Marina database API ───────────────────────────────────────────────────────

// GET /api/marinas — return stored JSON (DB first, then static file fallback)
app.get("/api/marinas", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT raw FROM marina_database WHERE key='main'");
    if (rows.length) return res.json(rows[0].raw);
    // Fallback: read the seeded static file
    const filePath = join(__dirname, "..", isProd ? "dist" : "public", "data", "Main.json");
    if (existsSync(filePath)) {
      const raw = JSON.parse(await readFile(filePath, "utf8"));
      return res.json(raw);
    }
    res.json(null);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/marinas — save uploaded marina JSON to DB
app.post("/api/marinas", async (req, res) => {
  try {
    const body = req.body;
    await pool.query(
      `INSERT INTO marina_database (key, raw, updated_at)
       VALUES ('main', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET raw = EXCLUDED.raw, updated_at = NOW()`,
      [JSON.stringify(body)]
    );
    const total = Array.isArray(body.marinas) ? body.marinas.length
      : Array.isArray(body.data) ? body.data.length : "?";
    console.log(`Marina database updated — ${total} records`);
    res.json({ ok: true, total });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Marina interest tracking ──────────────────────────────────────────────────

app.get("/api/marina-interest", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT marina_id, status, notes, updated_at FROM marina_interest ORDER BY updated_at DESC"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/marina-interest/:id", async (req, res) => {
  try {
    const { status, notes = "" } = req.body;
    await pool.query(
      `INSERT INTO marina_interest (marina_id, status, notes, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (marina_id) DO UPDATE
         SET status = EXCLUDED.status, notes = EXCLUDED.notes, updated_at = NOW()`,
      [req.params.id, status, notes]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/marina-interest/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM marina_interest WHERE marina_id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Serve upload page and public/data in all modes ──────────────────────────
const publicPath = join(__dirname, "..", "public");
app.use("/upload.html", express.static(join(publicPath, "upload.html")));
app.use("/data", express.static(join(publicPath, "data")));

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
