// api/claude.js
export const config = { runtime: "nodejs" };

const ALLOWED_ORIGINS = [
  "https://www.gorillagrowtent.com",      // DİKKAT: sondaki / yok
  "https://gorilla-grow-tent.myshopify.com",
];

function normalizeOrigin(o = "") { return o.replace(/\/$/, ""); }
function setCors(res, origin) {
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-Requested-With");
}

export default async function handler(req, res) {
  const origin = normalizeOrigin(req.headers.origin || "");
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  // Preflight (OPTIONS)
  if (req.method === "OPTIONS") {
    if (isAllowed) { setCors(res, origin); return res.status(204).end(); }
    res.setHeader("Vary", "Origin");
    return res.status(403).json({ error: "CORS: origin not allowed", origin });
  }

  if (!isAllowed) {
    res.setHeader("Vary", "Origin");
    return res.status(403).json({ error: "Forbidden: bad origin", origin });
  }

  if (req.method !== "POST") {
    setCors(res, origin);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    setCors(res, origin);
    return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY" });
  }

  // Body’yi güvenle al (Vercel bazen req.body boş olabilir)
  let body = req.body;
  if (!body) {
    try {
      const text = await new Promise((resolve) => {
        let d = ""; req.on("data", c => d += c); req.on("end", () => resolve(d));
      });
      body = text ? JSON.parse(text) : {};
    } catch { body = {}; }
  }

  try {
    const {
      messages = [],
      system = "You are a helpful assistant.",
      model = "claude-3-5-sonnet-20241022",
      max_tokens = 800,
      temperature = 0.7,
    } = body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      setCors(res, origin);
      return res.status(400).json({ error: "messages array is required" });
    }

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens, temperature, system, messages }),
    });

    const detailText = await upstream.text();
    if (!upstream.ok) {
      setCors(res, origin);
      return res.status(upstream.status).json({ error: "Anthropic error", detail: detailText });
    }

    const data = detailText ? JSON.parse(detailText) : {};
    setCors(res, origin);
    return res.status(200).json(data);

  } catch (e) {
    console.error("[claude] ERROR:", e);
    setCors(res, origin);
    return res.status(500).json({ error: "server_error", detail: String(e?.message || e) });
  }
}

