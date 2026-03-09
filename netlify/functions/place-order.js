// Netlify serverless function — places orders on Kalshi via RSA-PSS signed requests.
// Runs server-side so it's not subject to browser CORS restrictions.
import crypto from "crypto";

const KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function kalshiSign(timestampMs, method, path, pemKey) {
  const message = String(timestampMs) + method + path;
  const sign = crypto.createSign("sha256");
  sign.update(message);
  sign.end();
  return sign.sign(
    {
      key: pemKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    },
    "base64"
  );
}

function kalshiHeaders(method, path, apiKeyId, pemKey) {
  const ts = Date.now();
  return {
    "Content-Type": "application/json",
    "KALSHI-ACCESS-KEY": apiKeyId,
    "KALSHI-ACCESS-TIMESTAMP": String(ts),
    "KALSHI-ACCESS-SIGNATURE": kalshiSign(ts, method, path, pemKey),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { action, apiKeyId, rsaPrivateKey } = body;

  if (!apiKeyId || !rsaPrivateKey) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "Missing apiKeyId or rsaPrivateKey" }),
    };
  }

  // ── GET BALANCE ──────────────────────────────────────────────────────────────
  if (action === "balance") {
    const path = "/trade-api/v2/portfolio/balance";
    try {
      const resp = await fetch(`${KALSHI_API}/portfolio/balance`, {
        headers: kalshiHeaders("GET", path, apiKeyId, rsaPrivateKey),
      });
      const data = await resp.json();
      if (!resp.ok) {
        return { statusCode: resp.status, headers: CORS, body: JSON.stringify({ error: data?.detail || JSON.stringify(data) }) };
      }
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, balance: data.balance }) };
    } catch (e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e?.message || String(e) }) };
    }
  }

  // ── PLACE ORDER ──────────────────────────────────────────────────────────────
  const { ticker, side, yesPriceCents, contracts } = body;

  if (!ticker || !side || yesPriceCents == null || !contracts) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "Missing order fields: ticker, side, yesPriceCents, contracts" }),
    };
  }

  const path = "/trade-api/v2/portfolio/orders";
  const orderBody = {
    ticker,
    side,           // "yes" or "no"
    action: "buy",
    count: Math.max(1, Math.round(contracts)),
    time_in_force: "fill_or_kill",
    // Price field depends on which side we're buying
    ...(side === "yes" ? { yes_price: Math.round(yesPriceCents) } : { no_price: Math.round(100 - yesPriceCents) }),
  };

  try {
    const resp = await fetch(`${KALSHI_API}/portfolio/orders`, {
      method: "POST",
      headers: kalshiHeaders("POST", path, apiKeyId, rsaPrivateKey),
      body: JSON.stringify(orderBody),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return {
        statusCode: resp.status,
        headers: CORS,
        body: JSON.stringify({ success: false, error: data?.detail || JSON.stringify(data) }),
      };
    }
    const order = data.order || data;
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, orderId: order.order_id || order.id, status: order.status, result: order }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ success: false, error: e?.message || String(e) }),
    };
  }
};
