// api/track-order.js

// 1) Node runtime kullan (Edge olmasın)
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

// Küçük yardımcı: env’de yanlış girilmiş domaini düzelt
function sanitizeDomain(raw = "") {
  return raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
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
  const SHOP_DOMAIN = sanitizeDomain(rawDomain); // PROTOKOL YOK, sadece domain
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
    const { orderNumber, email } = body || {};
    if (!orderNumber || !email) {
      setCors(res, origin);
      return res.status(400).json({ error: "Missing order number or email" });
    }

    const apiVersion = "2024-10";
    const normalized = String(orderNumber).startsWith("#") ? String(orderNumber) : `#${orderNumber}`;
    const qName  = encodeURIComponent(normalized);
    const qEmail = encodeURIComponent(String(email).trim());

    const url1 = `https://${SHOP_DOMAIN}/admin/api/${apiVersion}/orders.json?name=${qName}&email=${qEmail}&status=any`;
    console.log("[track-order] URL1:", url1);

    const r1 = await fetch(url1, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_TOKEN,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
    });

    const t1 = await r1.text();
    console.log("[track-order] URL1 status:", r1.status);
    // Sadece hata durumunda gövdeyi logla (PII kirletmeyelim)
    if (!r1.ok) console.log("[track-order] URL1 body:", t1);

    let d1; try { d1 = t1 ? JSON.parse(t1) : {}; } catch { d1 = { parseError: t1 }; }

    // Eşleşme yoksa email ile listele
    let orderData = d1;
    if (r1.ok && (!d1.orders || d1.orders.length === 0)) {
      const url2 = `https://${SHOP_DOMAIN}/admin/api/${apiVersion}/orders.json?email=${qEmail}&status=any`;
      console.log("[track-order] URL2:", url2);

      const r2 = await fetch(url2, {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_TOKEN,
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
      });

      const t2 = await r2.text();
      console.log("[track-order] URL2 status:", r2.status);
      if (!r2.ok) console.log("[track-order] URL2 body:", t2);

      let d2; try { d2 = t2 ? JSON.parse(t2) : {}; } catch { d2 = { parseError: t2 }; }
      if (r2.ok && d2.orders?.length) {
        const normalizedNoHash = normalized.replace(/^#/, "");
        const match = d2.orders.find(o => (o.name || "").replace(/^#/, "") === normalizedNoHash);
        if (match) orderData = { orders: [match] };
      }
    }

    setCors(res, origin);

    if (!orderData.orders || orderData.orders.length === 0) {
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
