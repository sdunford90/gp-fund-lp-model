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

// ── File upload endpoint ─────────────────────────────────────────────────────

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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marina_outreach (
      id              SERIAL PRIMARY KEY,
      marina_id       TEXT NOT NULL,
      contact_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      method          TEXT NOT NULL DEFAULT 'call',
      contact_name    TEXT NOT NULL DEFAULT '',
      response_status TEXT NOT NULL DEFAULT 'no_response',
      notes           TEXT NOT NULL DEFAULT '',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS marina_outreach_marina_idx ON marina_outreach(marina_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marina_activity (
      id          SERIAL PRIMARY KEY,
      marina_id   TEXT NOT NULL,
      event_type  TEXT NOT NULL,
      old_value   TEXT NOT NULL DEFAULT '',
      new_value   TEXT NOT NULL DEFAULT '',
      note        TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS marina_activity_marina_idx ON marina_activity(marina_id)`);
  // Migrate legacy binary status values to pipeline stage names
  await pool.query(`UPDATE marina_interest SET status = 'watchlist' WHERE status = 'interested'`);
  await pool.query(`UPDATE marina_interest SET status = 'pass' WHERE status = 'not_interested'`);
  console.log("DB ready");
}

// ── Scenario API ──────────────────────────────────────────────────────────────

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

app.get("/api/marinas", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT raw FROM marina_database WHERE key='main'");
    if (rows.length) return res.json(rows[0].raw);
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

// ── Marina interest / pipeline stage tracking ─────────────────────────────────

const STAGE_LABELS = {
  watchlist: "Watchlist", under_review: "Under Review", loi_sent: "LOI Sent",
  due_diligence: "Due Diligence", closed: "Closed", pass: "Passed",
};

app.get("/api/marina-interest", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT marina_id, status, notes, updated_at FROM marina_interest ORDER BY updated_at DESC"
    );
    res.json(rows.map(r => ({ ...r, stage_label: STAGE_LABELS[r.status] || r.status })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Pipeline tracker — enriched joined data for all staged marinas ─────────────
app.get("/api/pipeline", async (req, res) => {
  try {
    const [intRes, outRes, actRes, marinaRes] = await Promise.all([
      pool.query("SELECT marina_id, status, notes, updated_at FROM marina_interest ORDER BY updated_at DESC"),
      pool.query("SELECT marina_id, COUNT(*) AS outreach_count FROM marina_outreach GROUP BY marina_id"),
      pool.query("SELECT DISTINCT ON (marina_id) marina_id, event_type, note, created_at FROM marina_activity ORDER BY marina_id, created_at DESC"),
      pool.query("SELECT raw FROM marina_database WHERE key='main'"),
    ]);
    const interests = intRes.rows;
    if (!interests.length) return res.json([]);

    // Build marina lookup from DB; fallback to JSON file
    let allMarinas = [];
    if (marinaRes.rows.length) {
      const raw = marinaRes.rows[0].raw;
      allMarinas = Array.isArray(raw?.marinas) ? raw.marinas : Array.isArray(raw) ? raw : [];
    } else {
      const filePath = join(__dirname, "..", isProd ? "dist" : "public", "data", "Main.json");
      if (existsSync(filePath)) {
        const raw = JSON.parse(await readFile(filePath, "utf8"));
        allMarinas = Array.isArray(raw?.marinas) ? raw.marinas : Array.isArray(raw) ? raw : [];
      }
    }

    const marinaMap = Object.fromEntries(allMarinas.map(m => [m.id, m]));
    const outreachMap = Object.fromEntries(outRes.rows.map(o => [o.marina_id, parseInt(o.outreach_count)]));
    const activityMap = Object.fromEntries(actRes.rows.map(a => [a.marina_id, a]));

    const result = interests.map(i => {
      const m = marinaMap[i.marina_id] || {};
      return {
        marina_id: i.marina_id,
        status: i.status,
        stage_label: STAGE_LABELS[i.status] || i.status,
        notes: i.notes,
        updated_at: i.updated_at,
        name: m.name || i.marina_id,
        city: m.city || null,
        state: m.state || null,
        region: m.region || null,
        address: m.address || null,
        harbor: m.harbor || null,
        slips: m.slips || null,
        linear_ft: m.linear_ft || null,
        has_fuel_dock: m.has_fuel_dock || false,
        diesel: m.diesel || null,
        reviews: m.reviews || null,
        lat: m.lat || null,
        lon: m.lon || null,
        hotel_market: m.hotel_market || null,
        source_url: m.source_url || null,
        phone: m.phone || null,
        outreach_count: outreachMap[i.marina_id] || 0,
        last_activity: activityMap[i.marina_id] || null,
      };
    });
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/marina-interest/:id", async (req, res) => {
  try {
    const { status, notes = "" } = req.body;
    // Read current state for activity logging
    const { rows: cur } = await pool.query(
      "SELECT status, notes FROM marina_interest WHERE marina_id = $1",
      [req.params.id]
    );
    const oldStatus = cur.length ? cur[0].status : null;
    const oldNotes = cur.length ? cur[0].notes : "";

    await pool.query(
      `INSERT INTO marina_interest (marina_id, status, notes, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (marina_id) DO UPDATE
         SET status = EXCLUDED.status, notes = EXCLUDED.notes, updated_at = NOW()`,
      [req.params.id, status, notes]
    );

    // Log stage change
    if (oldStatus !== status) {
      await pool.query(
        `INSERT INTO marina_activity (marina_id, event_type, old_value, new_value, note)
         VALUES ($1, 'stage_change', $2, $3, '')`,
        [req.params.id, oldStatus || "unreviewed", status]
      );
    }
    // Log note save when notes are non-empty and changed
    if (notes.trim() && notes !== oldNotes) {
      await pool.query(
        `INSERT INTO marina_activity (marina_id, event_type, old_value, new_value, note)
         VALUES ($1, 'note_saved', '', '', $2)`,
        [req.params.id, notes.substring(0, 300)]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/marina-interest/:id", async (req, res) => {
  try {
    const { rows: cur } = await pool.query(
      "SELECT status FROM marina_interest WHERE marina_id = $1",
      [req.params.id]
    );
    await pool.query("DELETE FROM marina_interest WHERE marina_id = $1", [req.params.id]);
    if (cur.length && cur[0].status) {
      await pool.query(
        `INSERT INTO marina_activity (marina_id, event_type, old_value, new_value, note)
         VALUES ($1, 'stage_change', $2, 'unreviewed', '')`,
        [req.params.id, cur[0].status]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Marina outreach contact log ───────────────────────────────────────────────

app.get("/api/marina-outreach/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM marina_outreach WHERE marina_id = $1 ORDER BY contact_date DESC",
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/marina-outreach/:id", async (req, res) => {
  try {
    const { contact_date, method = "call", contact_name = "", response_status = "no_response", notes = "" } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO marina_outreach (marina_id, contact_date, method, contact_name, response_status, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, contact_date || new Date().toISOString(), method, contact_name, response_status, notes]
    );
    await pool.query(
      `INSERT INTO marina_activity (marina_id, event_type, old_value, new_value, note)
       VALUES ($1, 'outreach', '', $2, $3)`,
      [req.params.id, method, `${contact_name || "Unknown"}: ${notes}`.substring(0, 300)]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/marina-outreach/:id/:entry_id", async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM marina_outreach WHERE id = $1 AND marina_id = $2",
      [req.params.entry_id, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── AirROI short-term rental market data ──────────────────────────────────────
// Wraps the AirROI API. Set AIRROI_API_KEY in environment to enable live data.
// Endpoint shape based on https://airroi.com — adjust AIRROI_BASE / fields if
// your account uses a different version of the API.

const AIRROI_BASE = process.env.AIRROI_BASE || "https://api.airroi.com/v1";
const AIRROI_KEY = process.env.AIRROI_API_KEY || "";
const _airroiCache = new Map(); // key: lat,lon  → {data, ts}
const AIRROI_TTL_MS = 1000 * 60 * 60 * 12; // 12h cache

function mockAirroi(lat, lon) {
  // Deterministic pseudo-random so the same coords show the same mock values.
  const seed = Math.abs(Math.round((lat || 0) * 1000) + Math.round((lon || 0) * 1000));
  const rand = (min, max) => min + ((seed * 9301 + 49297) % 233280) / 233280 * (max - min);
  return {
    _source: "mock",
    market_name: "Sample Market",
    active_listings: Math.round(rand(120, 1800)),
    occupancy: +rand(0.45, 0.78).toFixed(3),
    adr: Math.round(rand(180, 460)),
    revpar: Math.round(rand(95, 320)),
    annual_revenue: Math.round(rand(28000, 92000)),
    avg_daily_rate_yoy: +rand(-0.05, 0.18).toFixed(3),
    occupancy_yoy: +rand(-0.08, 0.12).toFixed(3),
    revenue_yoy: +rand(-0.06, 0.22).toFixed(3),
    median_property_value: Math.round(rand(380000, 1450000)),
    rev_per_property: Math.round(rand(22000, 88000)),
    top_bedrooms: [
      { bedrooms: 1, share: +rand(0.05, 0.25).toFixed(2), adr: Math.round(rand(140, 250)) },
      { bedrooms: 2, share: +rand(0.20, 0.45).toFixed(2), adr: Math.round(rand(180, 320)) },
      { bedrooms: 3, share: +rand(0.20, 0.40).toFixed(2), adr: Math.round(rand(250, 460)) },
      { bedrooms: 4, share: +rand(0.05, 0.20).toFixed(2), adr: Math.round(rand(320, 620)) },
    ],
    seasonality: [
      { month: "Jan", occupancy: +rand(0.30, 0.55).toFixed(2), adr: Math.round(rand(150, 280)) },
      { month: "Feb", occupancy: +rand(0.35, 0.58).toFixed(2), adr: Math.round(rand(160, 290)) },
      { month: "Mar", occupancy: +rand(0.42, 0.65).toFixed(2), adr: Math.round(rand(180, 320)) },
      { month: "Apr", occupancy: +rand(0.48, 0.70).toFixed(2), adr: Math.round(rand(190, 340)) },
      { month: "May", occupancy: +rand(0.55, 0.78).toFixed(2), adr: Math.round(rand(210, 380)) },
      { month: "Jun", occupancy: +rand(0.65, 0.88).toFixed(2), adr: Math.round(rand(240, 440)) },
      { month: "Jul", occupancy: +rand(0.72, 0.92).toFixed(2), adr: Math.round(rand(280, 520)) },
      { month: "Aug", occupancy: +rand(0.70, 0.90).toFixed(2), adr: Math.round(rand(280, 510)) },
      { month: "Sep", occupancy: +rand(0.58, 0.78).toFixed(2), adr: Math.round(rand(230, 400)) },
      { month: "Oct", occupancy: +rand(0.50, 0.72).toFixed(2), adr: Math.round(rand(200, 360)) },
      { month: "Nov", occupancy: +rand(0.40, 0.62).toFixed(2), adr: Math.round(rand(170, 310)) },
      { month: "Dec", occupancy: +rand(0.42, 0.65).toFixed(2), adr: Math.round(rand(180, 330)) },
    ],
    updated_at: new Date().toISOString(),
  };
}

app.get("/api/airroi", async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: "lat & lon required" });
  }
  const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = _airroiCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < AIRROI_TTL_MS) {
    return res.json(cached.data);
  }

  // No key configured → return deterministic mock so the UI still renders.
  if (!AIRROI_KEY) {
    const data = mockAirroi(lat, lon);
    _airroiCache.set(cacheKey, { data, ts: Date.now() });
    return res.json(data);
  }

  try {
    const url = `${AIRROI_BASE}/markets/metrics?lat=${lat}&lon=${lon}`;
    const r = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${AIRROI_KEY}`,
        "Accept": "application/json",
      },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.warn(`AirROI ${r.status}: ${body.slice(0, 200)}`);
      const data = { ...mockAirroi(lat, lon), _source: "mock_fallback", _error: `AirROI ${r.status}` };
      _airroiCache.set(cacheKey, { data, ts: Date.now() });
      return res.json(data);
    }
    const json = await r.json();
    const data = { ...json, _source: "airroi", updated_at: new Date().toISOString() };
    _airroiCache.set(cacheKey, { data, ts: Date.now() });
    res.json(data);
  } catch (e) {
    console.error("AirROI fetch failed:", e.message);
    const data = { ...mockAirroi(lat, lon), _source: "mock_fallback", _error: e.message };
    _airroiCache.set(cacheKey, { data, ts: Date.now() });
    res.json(data);
  }
});

// ── Marina activity timeline ──────────────────────────────────────────────────

app.get("/api/marina-activity/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM marina_activity WHERE marina_id = $1 ORDER BY created_at DESC LIMIT 50",
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Static file serving ───────────────────────────────────────────────────────
const publicPath = join(__dirname, "..", "public");
app.use("/upload.html", express.static(join(publicPath, "upload.html")));
app.use("/data", express.static(join(publicPath, "data")));

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
