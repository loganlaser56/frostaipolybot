// Netlify serverless function — fetches Binance BTC/USDT spot price + 15 one-minute klines.
// Binance public API requires no auth. Running server-side avoids CORS + region issues.
const BINANCE_BASE = "https://api.binance.com/api/v3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  try {
    // Parallel fetch: spot price + 15 one-minute klines
    const [priceResp, klinesResp] = await Promise.all([
      fetch(`${BINANCE_BASE}/ticker/price?symbol=BTCUSDT`),
      fetch(`${BINANCE_BASE}/klines?symbol=BTCUSDT&interval=1m&limit=15`),
    ]);

    if (!priceResp.ok || !klinesResp.ok) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ success: false, error: "Binance API error" }),
      };
    }

    const [priceData, rawKlines] = await Promise.all([
      priceResp.json(),
      klinesResp.json(),
    ]);

    const price = parseFloat(priceData.price);

    // Klines: [openTime, open, high, low, close, vol, closeTime, ...]
    const candles = rawKlines.map(k => ({
      time:  k[0],
      open:  parseFloat(k[1]),
      high:  parseFloat(k[2]),
      low:   parseFloat(k[3]),
      close: parseFloat(k[4]),
      vol:   parseFloat(k[5]),
    }));

    const last   = candles[candles.length - 1].close;
    const prev1m = candles[candles.length - 2].close;  // 1 complete minute ago
    const prev5m = candles[candles.length - 6].close;  // 5 complete minutes ago

    const change1m = prev1m > 0 ? ((last - prev1m) / prev1m) * 100 : 0;
    const change5m = prev5m > 0 ? ((last - prev5m) / prev5m) * 100 : 0;

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        success: true,
        price,
        change1m: parseFloat(change1m.toFixed(4)),
        change5m: parseFloat(change5m.toFixed(4)),
        candles,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ success: false, error: e?.message || String(e) }),
    };
  }
};
