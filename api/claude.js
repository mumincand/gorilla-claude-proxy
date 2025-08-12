// api/claude.js
export const config = { runtime: "nodejs" };

const ALLOWED_ORIGINS = [
  "https://www.gorillagrowtent.com",
  "https://gorillagrowtent.com",
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

  if (req.method === "OPTIONS") {
    if (isAllowed) { setCors(res, origin); return res.status(204).end(); }
    return res.status(403).json({ error: "CORS: origin not allowed", origin });
  }

  if (!isAllowed) return res.status(403).json({ error: "Forbidden origin", origin });

  if (req.method !== "POST") {
    setCors(res, origin);
    return res.status(405).json({ error: "Method not allowed" });
  }

  setCors(res, origin);

  try {
    const body = req.body || {};
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY" });
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });

    const data = await r.json();
    return res.status(r.status).json(data);

  } catch (err) {
    return res.status(500).json({ error: "server_error", detail: String(err) });
  }
}
