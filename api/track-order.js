

const ALLOWED_ORIGINS = [
  "https://www.gorillagrowtent.com/",
  "https://gorilla-grow-tent.myshopify.com",
];

function setCors(res, origin) {
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin);


  if (req.method === "OPTIONS") {
    if (isAllowed) setCors(res, origin);
    return res.status(204).end();
  }

  if (!isAllowed) {
    return res.status(403).json({ error: "Forbidden origin", origin });
  }

  if (req.method !== "POST") {
    if (isAllowed) setCors(res, origin);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_TOKEN } = process.env;
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_API_TOKEN) {
    setCors(res, origin);
    return res.status(500).json({ error: "Missing Shopify env vars" });
  }

  try {
    const { orderNumber, email } = req.body || {};
    if (!orderNumber || !email) {
      setCors(res, origin);
      return res.status(400).json({ error: "Missing order number or email" });
    }

    const apiVersion = "2024-10";
    const normalized = orderNumber.toString().startsWith("#")
      ? orderNumber.toString()
      : `#${orderNumber}`;

    const qName = encodeURIComponent(normalized);
    const qEmail = encodeURIComponent(email.trim());

   
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${apiVersion}/orders.json?name=${qName}&email=${qEmail}&status=any`;
    let r = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_TOKEN,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
    });
    let text = await r.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { parseError: text }; }

    
    if (r.ok && (!data.orders || data.orders.length === 0)) {
      const url2 = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${apiVersion}/orders.json?email=${qEmail}&status=any`;
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
        const normalizedNoHash = normalized.replace(/^#/, "");
        const match = d2.orders.find(o => (o.name || "").replace(/^#/, "") === normalizedNoHash);
        if (match) data = { orders: [match] };
      }
    }

    setCors(res, origin);

    if (!data.orders || data.orders.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = data.orders[0] || {};
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
    setCors(res, origin);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
