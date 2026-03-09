// Netlify serverless function — generates RSA-PSS signed credentials for Kalshi WebSocket login.
// The browser cannot sign RSA-PSS keys, so we do it server-side and return the token.
import crypto from "crypto";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { apiKeyId, rsaPrivateKey } = body;
  if (!apiKeyId || !rsaPrivateKey) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing apiKeyId or rsaPrivateKey" }) };
  }

  try {
    const ts = Date.now();
    // Kalshi WS login signature: timestampMs + "GET" + "/trade-api/ws/v2"
    const message = String(ts) + "GET" + "/trade-api/ws/v2";
    const sign = crypto.createSign("sha256");
    sign.update(message);
    sign.end();
    const signature = sign.sign(
      {
        key: rsaPrivateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      },
      "base64"
    );

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ts, signature, apiKeyId }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: e?.message || String(e) }),
    };
  }
};
