// api/track-order.js

// Node runtime (Edge olmasın)
export const config = { runtime: "nodejs" };

const ALLOWED_ORIGINS = [
  "https://www.gorillagrowtent.com",
  "https://gorilla-grow-tent.myshopify.com",
];

function normalizeOrigin(o = "") { return o.replace(/\/$/, ""); }
function setCors(res, origin) {
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-Requested-With");
}

// Env’de yanlış girilmiş domaini düzelt (https://... veya sonda / geldiyse)
function sanitizeDomain(raw = "") {
  return raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

// Kullanıcıdan gelen orderToken’dan digit’leri çıkar
function extractDigits(token = "") {
  const m = String(token).match(/\d+/);
  return m ? m[0] : "";
}

// Order ismi adayları üret (deneme sırası önemli)
function buildNameCandidates(orderToken = "") {
  const raw = String(orderToken).trim();
  const digits = extractDigits(raw);
  const candidates = new Set();

  if (raw) candidates.add(raw);               // yazıldığı gibi
  if (digits) {
    candidates.add(`GG-${digits}`);           // GG-12345
    candidates.add(`#${digits}`);             // #12345
    candidates.add(digits);                   // 12345 (bazı mağazalarda işe yarayabilir)
  }

  // Büyük/küçük varyasyonları eklemek istersen:
  // (Shopify "name" çoğunlukla case-sensitive değil ama emniyet için)
  const more = Array.from(candidates).map(c => c.toUpperCase());
  more.forEach(v => candidates.add(v));

  return Array.from(candidates);
}

export default async function handler(req, res) {
  const origin = normalizeOrigin(req.headers.origin || "");
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  // Preflight
  if (req.method === "OPTIONS") {
    if (isAllowed) { setCors(res, origin); return res.status(204).end(); }
    res.setHeader("Vary", "Origin");
    return res.status(403).json({ error: "CORS: origin not allowed", origin });
  }

  if (!isAllowed) {
    res.setHeader("Vary", "Origin");
    return res.status(403).json({ error: "Forbidden origin", origin });
  }

  if (req.method !== "POST") {
    setCors(res, origin);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawDomain = process.env.SHOPIFY_STORE_DOMAIN || "";
  const SHOP_DOMAIN = sanitizeDomain(rawDomain); // sadece domain (protokolsüz)
  const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

  if (!SHOP_DOMAIN || !SHOPIFY_ADMIN_API_TOKEN) {
    setCors(res, origin);
    return res.status(500).json({
      error: "Missing Shopify env vars",
      detail: {
        SHOPIFY_STORE_DOMAIN: SHOP_DOMAIN ? "set" : "missing",
        SHOPIFY_ADMIN_API_TOKEN: SHOPIFY_ADMIN_API_TOKEN ? "set" : "missing"
      }
    });
  }

  // Body güvenli al
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
    // >>>>>>>>>>>>> Değişiklik: orderToken kullanıyoruz <<<<<<<<<<<<<
    const { orderToken, email } = body || {};
    if (!orderToken || !email) {
      setCors(res, origin);
      return res.status(400).json({ error: "Missing order token or email" });
    }

    const apiVersion = "2024-10";
    const qEmail = encodeURIComponent(String(email).trim());
    const nameCandidates = buildNameCandidates(orderToken);

    let orderData = null;

    // 1) İsim + email ile birkaç aday dene
    for (const candidate of nameCandidates) {
      const qName = encodeURIComponent(candidate);
      const url = `https://${SHOP_DOMAIN}/admin/api/${apiVersion}/orders.json?name=${qName}&email=${qEmail}&status=any`;
      // console.log("[track-order] Try name:", candidate, url);

      const r = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_TOKEN,
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
      });

      const t = await r.text();
      let d; try { d = t ? JSON.parse(t) : {}; } catch { d = { parseError: t }; }

      if (r.ok && d.orders?.length) {
        orderData = d;
        break;
      }
      // r.ok değilse PII loglamayalım; sadece debug için:
      // if (!r.ok) console.log("[track-order] name try failed:", candidate, r.status, t);
    }

    // 2) Bulunamadıysa: email ile listele, isim eşleştir
    if (!orderData) {
      const url2 = `https://${SHOP_DOMAIN}/admin/api/${apiVersion}/orders.json?email=${qEmail}&status=any`;
      const r2 = await fetch(url2, {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_TOKEN,
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
      });
      const t2 = await r2.text();
      let d2; try { d2 = t2 ? JSON.parse(t2) : {}; } catch { d2 = { parseError: t2 }; }

      if (r2.ok && d2.orders?.length) {
        // name eşleştirme: baştaki GG- veya # kaldırıp karşılaştır
        const tokenDigits = extractDigits(orderToken);
        const match = d2.orders.find(o => {
          const nm = String(o.name || "");
          const nmDigits = extractDigits(nm);
          return nmDigits && tokenDigits && nmDigits === tokenDigits;
        });
        if (match) {
          orderData = { orders: [match] };
        }
      }
    }

    setCors(res, origin);

    if (!orderData?.orders?.length) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orderData.orders[0] || {};
    const ful = Array.isArray(order.fulfillments) ? order.fulfillments : [];
    const firstFul = ful[0] || null;

    return res.status(200).json({
      order_id: order.id || null,
      order_name: (order.name || "").replace(/^#/, ""),
      order_name_with_hash: order.name || null,
      fulfillment_status: order.fulfillment_status || null,
      order_status_url: order.order_status_url || null,
      tracking_url: firstFul?.tracking_url || (firstFul?.tracking_urls?.[0] || null),
      financial_status: order.financial_status || null,
      processed_at: order.processed_at || order.created_at || null,
      email: order.email || null,
      shipping_address: order.shipping_address || null,
      line_items: Array.isArray(order.line_items) ? order.line_items.map(li => ({
        title: li.title,
        quantity: li.quantity,
        sku: li.sku,
        fulfillment_status: li.fulfillment_status || null
      })) : []
    });

  } catch (err) {
    console.error("[track-order] ERROR:", err);
    setCors(res, origin);
    return res.status(500).json({
      error: "server_error",
      detail: String(err?.message || err),
      stack: err?.stack || null
    });
  }
}
