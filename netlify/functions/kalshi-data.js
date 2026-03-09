// Netlify serverless function — fetches public Kalshi market data server-side.
// No CORS restrictions here; browser just calls /.netlify/functions/kalshi-data.
const KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  const { type, ticker, limit = 20 } = event.queryStringParameters || {};

  // ── GET MARKETS ─────────────────────────────────────────────────────────────
  if (type === "markets") {
    try {
      // Try BTC series tickers — Kalshi uses different slugs across products
      const seriesTickers = ["KXBTC", "BTCUSD", "BTC"];
      let markets = [];

      for (const series of seriesTickers) {
        const url = `${KALSHI_API}/markets?series_ticker=${series}&status=open&limit=${limit}`;
        const resp = await fetch(url, {
          headers: { "Accept": "application/json" },
        });
        if (resp.ok) {
          const data = await resp.json();
          const list = data.markets || [];
          if (list.length > 0) {
            markets = list;
            break;
          }
        }
      }

      // If series filter returns nothing, fetch all open markets and filter for BTC
      if (markets.length === 0) {
        const resp = await fetch(`${KALSHI_API}/markets?status=open&limit=100`, {
          headers: { "Accept": "application/json" },
        });
        if (resp.ok) {
          const data = await resp.json();
          const all = data.markets || [];
          markets = all.filter(m => {
            const t = (m.ticker + " " + (m.title || "") + " " + (m.subtitle || "")).toLowerCase();
            return t.includes("btc") || t.includes("bitcoin");
          });
        }
      }

      const mapped = markets.map(m => ({
        id:           m.ticker,
        question:     m.title || m.subtitle || m.ticker,
        yesPrice:     m.yes_ask ?? m.yes_bid ?? 50,
        noPrice:      m.no_ask  ?? m.no_bid  ?? 50,
        volume:       m.volume  || 0,
        openInterest: m.open_interest || 0,
        endDate:      m.close_time || m.expiration_time || null,
        active:       m.status === "open",
        asset:        "BTC",
      }));

      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ success: true, markets: mapped }),
      };
    } catch (e) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ success: false, error: e?.message || String(e) }),
      };
    }
  }

  // ── GET SINGLE MARKET PRICE ──────────────────────────────────────────────────
  if (type === "price" && ticker) {
    try {
      const resp = await fetch(`${KALSHI_API}/markets/${encodeURIComponent(ticker)}`, {
        headers: { "Accept": "application/json" },
      });
      if (!resp.ok) {
        return { statusCode: resp.status, headers: CORS, body: JSON.stringify({ success: false }) };
      }
      const data = await resp.json();
      const m = data.market || data;
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          success: true,
          yes_bid: m.yes_bid,
          yes_ask: m.yes_ask,
          no_bid:  m.no_bid,
          no_ask:  m.no_ask,
          volume:  m.volume,
          open_interest: m.open_interest,
        }),
      };
    } catch (e) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ success: false, error: e?.message || String(e) }),
      };
    }
  }

  return {
    statusCode: 400,
    headers: CORS,
    body: JSON.stringify({ error: "Missing type param (markets | price)" }),
  };
};
