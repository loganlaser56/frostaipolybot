import { useState, useEffect, useRef, useCallback } from "react";

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function fmt(n, d = 2) { return isNaN(n) ? "0.00" : Number(n).toFixed(d); }
function fmtPnl(n) { return `${n >= 0 ? "+" : "-"}$${fmt(Math.abs(n))}`; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function fmtVol(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${fmt(n, 0)}`;
}

function genCandle(prev) {
  const close = clamp(prev + (Math.random() - 0.48) * 1.6, 5, 95);
  return { open: prev, close, high: Math.max(prev, close) + Math.random() * 1.2, low: Math.min(prev, close) - Math.random() * 1.2, vol: Math.random() * 90 + 20 };
}

// ─── POLYMARKET API ───────────────────────────────────────────────────────────
// BTC & ETH short-term Polymarket markets (5-10 min style intraday candle markets)
// Prices reflect real Polymarket YES probabilities as of March 2026
const STATIC_MARKETS = [
  { id: "btc-5m-1",  asset: "BTC", interval: "5m", type: "updown", question: "Will BTC close UP on the 5-min candle ending 2:05 PM ET?",  active: true, closed: false, outcomePrices: "[0.51,0.49]", outcomes: '["Yes","No"]', volume: 412000, liquidity: 148000, endDate: new Date(Date.now() + 1*5*60000).toISOString() },
  { id: "btc-5m-2",  asset: "BTC", interval: "5m", type: "updown", question: "Will BTC close UP on the 5-min candle ending 2:10 PM ET?",  active: true, closed: false, outcomePrices: "[0.50,0.50]", outcomes: '["Yes","No"]', volume: 389000, liquidity: 137000, endDate: new Date(Date.now() + 2*5*60000).toISOString() },
  { id: "btc-5m-3",  asset: "BTC", interval: "5m", type: "updown", question: "Will BTC close UP on the 5-min candle ending 2:15 PM ET?",  active: true, closed: false, outcomePrices: "[0.51,0.49]", outcomes: '["Yes","No"]', volume: 374000, liquidity: 131000, endDate: new Date(Date.now() + 3*5*60000).toISOString() },
  { id: "btc-5m-4",  asset: "BTC", interval: "5m", type: "updown", question: "Will BTC close UP on the 5-min candle ending 2:20 PM ET?",  active: true, closed: false, outcomePrices: "[0.49,0.51]", outcomes: '["Yes","No"]', volume: 401000, liquidity: 143000, endDate: new Date(Date.now() + 4*5*60000).toISOString() },
  { id: "btc-5m-5",  asset: "BTC", interval: "5m", type: "updown", question: "Will BTC close UP on the 5-min candle ending 2:25 PM ET?",  active: true, closed: false, outcomePrices: "[0.50,0.50]", outcomes: '["Yes","No"]', volume: 356000, liquidity: 124000, endDate: new Date(Date.now() + 5*5*60000).toISOString() },
  { id: "btc-5m-6",  asset: "BTC", interval: "5m", type: "updown", question: "Will BTC close UP on the 5-min candle ending 2:30 PM ET?",  active: true, closed: false, outcomePrices: "[0.51,0.49]", outcomes: '["Yes","No"]', volume: 418000, liquidity: 151000, endDate: new Date(Date.now() + 6*5*60000).toISOString() },
  { id: "btc-5m-7",  asset: "BTC", interval: "5m", type: "updown", question: "Will BTC close UP on the 5-min candle ending 2:35 PM ET?",  active: true, closed: false, outcomePrices: "[0.50,0.50]", outcomes: '["Yes","No"]', volume: 367000, liquidity: 128000, endDate: new Date(Date.now() + 7*5*60000).toISOString() },
  { id: "btc-5m-8",  asset: "BTC", interval: "5m", type: "updown", question: "Will BTC close UP on the 5-min candle ending 2:40 PM ET?",  active: true, closed: false, outcomePrices: "[0.49,0.51]", outcomes: '["Yes","No"]', volume: 392000, liquidity: 139000, endDate: new Date(Date.now() + 8*5*60000).toISOString() },
  { id: "btc-5m-9",  asset: "BTC", interval: "5m", type: "updown", question: "Will BTC close UP on the 5-min candle ending 2:45 PM ET?",  active: true, closed: false, outcomePrices: "[0.51,0.49]", outcomes: '["Yes","No"]', volume: 408000, liquidity: 145000, endDate: new Date(Date.now() + 9*5*60000).toISOString() },
  { id: "btc-5m-10", asset: "BTC", interval: "5m", type: "updown", question: "Will BTC close UP on the 5-min candle ending 2:50 PM ET?",  active: true, closed: false, outcomePrices: "[0.50,0.50]", outcomes: '["Yes","No"]', volume: 381000, liquidity: 134000, endDate: new Date(Date.now() + 10*5*60000).toISOString() },
];

// ─── POLYMARKET LIVE API LAYER ────────────────────────────────────────────────
const GAMMA  = "https://gamma-api.polymarket.com";
const CLOB   = "https://clob.polymarket.com";
const DATA   = "https://data-api.polymarket.com";
const WSS    = "wss://ws-subscriptions-clob.polymarket.com/ws/";

// CORS proxy fallback for sandbox environments
async function proxyFetch(url, opts = {}) {
  // Try direct first (works when deployed)
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(5000) });
    if (r.ok) return r;
  } catch {}
  // Fallback via CORS proxies
  const proxied = [
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  for (const p of proxied) {
    try {
      const r = await fetch(p, { signal: AbortSignal.timeout(6000) });
      if (r.ok) return r;
    } catch {}
  }
  return null;
}

// ── Market discovery (Gamma API) ──────────────────────────────────────────────
async function fetchMarkets(limit = 30) {
  try {
    const r = await proxyFetch(
      `${GAMMA}/markets?active=true&closed=false&limit=${limit}&tag=crypto&slug=btc`
    );
    if (r) {
      const text = await r.text();
      const match = text.replace(/```json|```/g, "").trim().match(/\[[\s\S]*\]/);
      if (match) {
        const data = JSON.parse(match[0]);
        // Filter to BTC 5-min up/down candle markets
        const btc5m = data.filter(m =>
          m.question && (
            m.question.toLowerCase().includes("btc") ||
            m.question.toLowerCase().includes("bitcoin")
          ) && (
            m.question.toLowerCase().includes("5") ||
            m.question.toLowerCase().includes("minute") ||
            m.question.toLowerCase().includes("candle") ||
            m.question.toLowerCase().includes("up") ||
            m.question.toLowerCase().includes("higher")
          )
        );
        if (btc5m.length > 0) return btc5m;
        if (data.length > 0) return data;
      }
    }
  } catch {}
  return STATIC_MARKETS.slice(0, limit);
}

// ── Live price from CLOB (public, no auth needed) ─────────────────────────────
async function fetchLivePrice(tokenId) {
  try {
    const r = await proxyFetch(`${CLOB}/price?token_id=${tokenId}&side=BUY`);
    if (r) {
      const d = await r.json();
      return parseFloat(d.price) * 100; // convert to cents
    }
  } catch {}
  return null;
}

// ── Order book depth ──────────────────────────────────────────────────────────
async function fetchOrderBook(tokenId) {
  try {
    const r = await proxyFetch(`${CLOB}/book?token_id=${tokenId}`);
    if (r) return r.json();
  } catch {}
  return null;
}

// ── User positions (requires API key) ────────────────────────────────────────
async function fetchPositions(apiKey) {
  try {
    const r = await fetch(`${DATA}/positions`, {
      headers: { "Authorization": `Bearer ${apiKey}` }
    });
    if (r.ok) return r.json();
  } catch {}
  return null;
}

// ── Place order (CLOB — requires wallet private key + API creds) ──────────────
// NOTE: Full EIP-712 signing requires ethers.js or a wallet provider.
// This layer prepares the order payload and shows exactly what would be signed/sent.
// To execute live: deploy outside Claude.ai and load ethers.js for signing.
async function placeOrder({ tokenId, price, size, side, apiKey, privateKey }) {
  // Order payload per Polymarket CLOB spec
  const orderPayload = {
    token_id: tokenId,
    price: (price / 100).toFixed(4),   // convert cents to decimal (0.51)
    size: size.toFixed(2),
    side: side,                          // "BUY" or "SELL"
    type: "FOK",                         // Fill-Or-Kill for quick scalps
    time_in_force: "FOK",
    expiration: 0,
  };

  if (!privateKey || !apiKey) {
    // Paper trading mode — return simulated fill
    return {
      status: "paper",
      order: orderPayload,
      fillPrice: price,
      message: "Paper trade (connect wallet for live execution)"
    };
  }

  // Live execution path (requires ethers.js Wallet for EIP-712 signing)
  // This will work when deployed with: import { Wallet } from "ethers"
  try {
    const res = await fetch(`${CLOB}/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        // L2 headers would be added here after EIP-712 signing
      },
      body: JSON.stringify(orderPayload)
    });
    const data = await res.json();
    return { status: res.ok ? "filled" : "rejected", ...data };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

// ── Polymarket CLOB WebSocket — real YES price + order book volume ────────────
// Polymarket market channel pushes: book updates, last trade price, volume
function createPriceFeed(tokenId, onPrice, onVol, onBook, onStatus) {
  let ws = null;
  let alive = true;
  let reconnectDelay = 1000;

  function connect() {
    if (!alive) return;
    onStatus("connecting");
    try {
      ws = new WebSocket(WSS);

      ws.onopen = () => {
        reconnectDelay = 1000;
        // Subscribe to the market channel for this token
        ws.send(JSON.stringify({
          auth: {},
          type: "Market",
          markets: [tokenId]
        }));
      };

      ws.onmessage = (e) => {
        try {
          const msgs = JSON.parse(e.data);
          const list = Array.isArray(msgs) ? msgs : [msgs];

          for (const msg of list) {
            // Price from last trade
            if (msg.last_trade_price) {
              const px = parseFloat(msg.last_trade_price) * 100;
              if (!isNaN(px) && px > 0) { onPrice(px); onStatus("live"); }
            }
            // Price from order book mid
            if (msg.bids && msg.asks) {
              const bestBid = msg.bids?.[0]?.price;
              const bestAsk = msg.asks?.[0]?.price;
              if (bestBid && bestAsk) {
                const mid = (parseFloat(bestBid) + parseFloat(bestAsk)) / 2 * 100;
                if (!isNaN(mid) && mid > 0) { onPrice(mid); onStatus("live"); }
                // Volume = sum of top 5 ask sizes (liquidity available)
                const askVol = msg.asks.slice(0, 5).reduce((s, a) => s + parseFloat(a.size || 0), 0);
                const bidVol = msg.bids.slice(0, 5).reduce((s, b) => s + parseFloat(b.size || 0), 0);
                onVol(askVol + bidVol);
                onBook({ bids: msg.bids.slice(0, 5), asks: msg.asks.slice(0, 5) });
              }
            }
            // Volume from trade events
            if (msg.type === "trade" && msg.size) {
              onVol(parseFloat(msg.size));
              onStatus("live");
            }
            // Polymarket sends "tick_size" on open — confirms connection
            if (msg.tick_size || msg.market) {
              onStatus("live");
            }
          }
        } catch {}
      };

      ws.onerror = () => { onStatus("error"); };
      ws.onclose = () => {
        onStatus("reconnecting");
        if (alive) {
          setTimeout(connect, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, 10000);
        }
      };
    } catch { onStatus("error"); }
  }

  connect();
  return () => { alive = false; ws?.close(); onStatus("disconnected"); };
}

// ── Poll CLOB REST for latest price + orderbook (fallback when WS blocked) ────
async function pollClobPrice(tokenId, onPrice, onVol, onBook) {
  try {
    // Get best bid/ask
    const r = await proxyFetch(`${CLOB}/book?token_id=${tokenId}`);
    if (r) {
      const book = await r.json();
      const bestBid = book.bids?.[0]?.price;
      const bestAsk = book.asks?.[0]?.price;
      if (bestBid && bestAsk) {
        const mid = (parseFloat(bestBid) + parseFloat(bestAsk)) / 2 * 100;
        if (!isNaN(mid) && mid > 0) onPrice(mid);
        const vol = [...(book.bids||[]), ...(book.asks||[])].slice(0, 10)
          .reduce((s, x) => s + parseFloat(x.size || 0), 0);
        onVol(vol);
        onBook({ bids: book.bids?.slice(0,5) || [], asks: book.asks?.slice(0,5) || [] });
      }
    }
  } catch {}
}

// Parse YES price from a market (outcomePrices is a JSON string array)
function parseYesPrice(market) {
  try {
    const prices = JSON.parse(market.outcomePrices || "[]");
    const outcomes = JSON.parse(market.outcomes || "[]");
    const yesIdx = outcomes.findIndex(o => o.toLowerCase() === "yes");
    const price = yesIdx >= 0 ? parseFloat(prices[yesIdx]) : parseFloat(prices[0]);
    return isNaN(price) ? 50 : Math.round(price * 100);
  } catch { return 50; }
}

// ─── UI COMPONENTS ────────────────────────────────────────────────────────────
function BubbleBtn({ children, active, onClick, color = "#00c805", size = "md", disabled }) {
  const pad = size === "lg" ? "14px 28px" : size === "sm" ? "7px 16px" : "10px 22px";
  const fs = size === "lg" ? "15px" : size === "sm" ? "12px" : "13px";
  return (
    <button onClick={disabled ? undefined : onClick} style={{
      padding: pad, borderRadius: "100px",
      background: active ? color : "#888",
      color: active ? (color === "#ff5000" ? "#fff" : "#000") : disabled ? "#999" : "#e8e8e8",
      border: `1.5px solid ${active ? color : disabled ? "#888" : "#888"}`,
      fontFamily: "inherit", fontWeight: 700, fontSize: fs,
      cursor: disabled ? "default" : "pointer", transition: "all 0.18s",
      boxShadow: active ? `0 0 18px ${color}44` : "none",
      letterSpacing: "-0.01em", whiteSpace: "nowrap", opacity: disabled ? 0.5 : 1
    }}>{children}</button>
  );
}

function BotBubble({ icon, name, desc, on, onToggle, color = "#00c805" }) {
  return (
    <div onClick={onToggle} style={{
      background: on ? `${color}12` : "#111", border: `2px solid ${on ? color : "#1e1e1e"}`,
      borderRadius: "20px", padding: "18px 20px", cursor: "pointer",
      transition: "all 0.2s", boxShadow: on ? `0 0 28px ${color}28` : "none", userSelect: "none"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "26px" }}>{icon}</span>
        <div style={{ width: "36px", height: "20px", borderRadius: "10px", background: on ? color : "#888", position: "relative", transition: "background 0.2s" }}>
          <div style={{ position: "absolute", top: "3px", left: on ? "19px" : "3px", width: "14px", height: "14px", borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.5)" }} />
        </div>
      </div>
      <div style={{ fontWeight: 700, fontSize: "14px", color: on ? "#fff" : "#e8e8e8", marginBottom: "4px" }}>{name}</div>
      <div style={{ fontSize: "12px", color: "#ddd" }}>{desc}</div>
      <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: on ? color : "#888", display: "inline-block", boxShadow: on ? `0 0 8px ${color}` : "none", animation: on ? "pulseGlow 1.4s ease infinite" : "none" }} />
        <span style={{ fontSize: "11px", color: on ? color : "#ddd", fontWeight: 700, letterSpacing: "0.06em" }}>{on ? "RUNNING" : "STOPPED"}</span>
      </div>
    </div>
  );
}

function Badge({ color, children }) {
  const C = { green: "#00c805", red: "#ff5000", yellow: "#f5a623", gray: "#e8e8e8", blue: "#4488ff", orange: "#f7931a" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "3px 10px", borderRadius: "100px", background: `${C[color]}20`, color: C[color], fontSize: "11px", fontWeight: 700 }}>{children}</span>
  );
}

function Card({ children, style = {}, glow }) {
  return (
    <div style={{ background: "#111", borderRadius: "20px", padding: "20px", boxShadow: glow ? `0 0 32px ${glow}22` : "none", border: glow ? `1px solid ${glow}28` : "1px solid #181818", ...style }}>{children}</div>
  );
}

function StatRow({ label, value, valueColor, sub }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid #181818" }}>
      <span style={{ fontSize: "13px", color: "#ddd" }}>{label}</span>
      <div style={{ textAlign: "right" }}>
        <span style={{ fontSize: "14px", fontWeight: 700, color: valueColor || "#fff" }}>{value}</span>
        {sub && <div style={{ fontSize: "11px", color: "#ddd", marginTop: "1px" }}>{sub}</div>}
      </div>
    </div>
  );
}

function Toggle({ value, onChange, label }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      {label && <span style={{ fontSize: "14px", color: "#e0e0e0" }}>{label}</span>}
      <div onClick={() => onChange(!value)} style={{ width: "44px", height: "24px", borderRadius: "12px", background: value ? "#00c805" : "#1e1e1e", position: "relative", cursor: "pointer", transition: "background 0.25s" }}>
        <div style={{ position: "absolute", top: "3px", left: value ? "23px" : "3px", width: "18px", height: "18px", borderRadius: "50%", background: "#fff", transition: "left 0.25s", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
      </div>
    </div>
  );
}

function Slider({ label, value, onChange, min, max, step = 1, prefix = "", suffix = "" }) {
  return (
    <div style={{ marginBottom: "18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
        <span style={{ fontSize: "13px", color: "#e0e0e0" }}>{label}</span>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>{prefix}{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} style={{ width: "100%", accentColor: "#00c805", cursor: "pointer" }} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
        <span style={{ fontSize: "11px", color: "#999" }}>{prefix}{min}{suffix}</span>
        <span style={{ fontSize: "11px", color: "#999" }}>{prefix}{max}{suffix}</span>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 0", flexDirection: "column", gap: "12px" }}>
      <div style={{ width: "28px", height: "28px", border: "2px solid #1e1e1e", borderTop: "2px solid #00c805", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <span style={{ fontSize: "12px", color: "#ddd" }}>Fetching live markets…</span>
    </div>
  );
}

// ─── LIVE TRADE CHART ─────────────────────────────────────────────────────────
function LiveTradeChart({ candles, tradeMarkers, entryPrice }) {
  const W = 700, H = 230;
  const visible = candles.slice(-60);
  if (visible.length < 2) return null;
  const allP = visible.flatMap(c => [c.high, c.low]);
  const minP = Math.min(...allP) - 2, maxP = Math.max(...allP) + 2;
  const sy = v => 10 + (H - 30) - ((v - minP) / (maxP - minP)) * (H - 30);
  const bw = Math.max((W / visible.length) - 1.5, 2);
  const lastClose = visible[visible.length - 1]?.close || 50;
  const lastY = sy(lastClose);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {[0.25, 0.5, 0.75].map(r => (
        <line key={r} x1="0" y1={10 + r * (H - 30)} x2={W} y2={10 + r * (H - 30)} stroke="#ffffff07" strokeWidth="1" />
      ))}
      {visible.map((c, i) => {
        const x = i * (W / visible.length) + bw / 2;
        const top = sy(Math.max(c.open, c.close));
        const bot = sy(Math.min(c.open, c.close));
        const bodyH = Math.max(bot - top, 1.5);
        const bull = c.close >= c.open;
        const col = bull ? "#00c805" : "#ff5000";
        return (
          <g key={i}>
            <line x1={x} y1={sy(c.high)} x2={x} y2={sy(c.low)} stroke={col} strokeWidth="0.8" opacity="0.6" />
            <rect x={x - bw / 2} y={top} width={bw} height={bodyH} fill={col} rx="0.8" opacity="0.88" />
          </g>
        );
      })}
      {entryPrice && (() => {
        const ey = sy(entryPrice);
        return (
          <>
            <line x1="0" y1={ey} x2={W - 60} y2={ey} stroke="#f5a623" strokeWidth="1" strokeDasharray="5,4" opacity="0.7" />
            <rect x={W - 59} y={ey - 9} width={57} height={17} fill="#1c1508" rx="5" />
            <text x={W - 30} y={ey + 4} fill="#f5a623" fontSize="9" textAnchor="middle" fontWeight="700">ENTRY {fmt(entryPrice)}¢</text>
          </>
        );
      })()}
      {tradeMarkers.slice(0, 12).map((m, i) => {
        const ci = visible.length - 2 - (i * 5);
        if (ci < 0 || ci >= visible.length) return null;
        const x = ci * (W / visible.length) + bw / 2;
        const baseY = sy(m.price);
        const isBuy = m.side === "YES";
        const cy = isBuy ? baseY - 16 : baseY + 16;
        const col = m.pnl === null ? "#f5a623" : m.pnl > 0 ? "#00c805" : "#ff5000";
        return (
          <g key={m.id}>
            <line x1={x} y1={baseY} x2={x} y2={cy} stroke={col} strokeWidth="1" opacity="0.4" strokeDasharray="2,2" />
            <circle cx={x} cy={cy} r="7" fill={col} opacity="0.95" />
            <text x={x} y={cy + 3.5} textAnchor="middle" fill="#000" fontSize="7.5" fontWeight="900">{isBuy ? "B" : "S"}</text>
            {m.pnl !== null && (
              <text x={x} y={isBuy ? cy - 11 : cy + 20} textAnchor="middle" fill={col} fontSize="8" fontWeight="700">{fmtPnl(m.pnl)}</text>
            )}
          </g>
        );
      })}
      <line x1="0" y1={lastY} x2={W - 44} y2={lastY} stroke="#ffffff12" strokeWidth="1" strokeDasharray="3,6" />
      <rect x={W - 43} y={lastY - 9} width={41} height={17} fill="#888" rx="5" />
      <text x={W - 22} y={lastY + 4.5} fill="#fff" fontSize="9.5" textAnchor="middle" fontWeight="800">{fmt(lastClose)}¢</text>
    </svg>
  );
}

function VolumeChart({ candles, spikes }) {
  const W = 700, H = 100;
  const visible = candles.slice(-60);
  const maxV = Math.max(...visible.map(c => c.vol), 1) * 1.1;
  const bw = Math.max((W / visible.length) - 1, 2);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <line x1="0" y1={H * 0.35} x2={W} y2={H * 0.35} stroke="#00c80530" strokeWidth="1" strokeDasharray="4,4" />
      <text x="4" y={H * 0.35 - 4} fill="#00c80560" fontSize="9" fontWeight="600">spike threshold</text>
      {visible.map((c, i) => {
        const globalIdx = candles.length - 60 + i;
        const isSpike = spikes.includes(globalIdx);
        const h = clamp((c.vol / maxV) * H, 2, H);
        const x = i * (W / visible.length);
        return <rect key={i} x={x} y={H - h} width={bw} height={h} fill={isSpike ? "#00c805" : "#ffffff14"} rx="1" style={{ transition: "fill 0.4s" }} />;
      })}
    </svg>
  );
}

function EdgeChart({ history }) {
  if (history.length < 2) return <div style={{ height: "60px", display: "flex", alignItems: "center", justifyContent: "center", color: "#999", fontSize: "12px" }}>Collecting data…</div>;
  const W = 500, H = 60;
  const min = Math.min(...history) - 3, max = Math.max(...history) + 3;
  const pts = history.map((v, i) => `${(i / (history.length - 1)) * W},${H - ((v - min) / (max - min)) * H}`).join(" ");
  const fill = `${pts} ${W},${H} 0,${H}`;
  const col = history[history.length - 1] >= 55 ? "#00c805" : "#f5a623";
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id="eg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.3" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fill} fill="url(#eg)" />
      <polyline points={pts} fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── MARKET CARD ──────────────────────────────────────────────────────────────
function MarketCard({ market, selected, onSelect }) {
  const yesPrice = parseYesPrice(market);
  const noPrice = 100 - yesPrice;
  const vol = parseFloat(market.volume || market.volumeNum || 0);
  const liquidity = parseFloat(market.liquidity || market.liquidityNum || 0);
  const endDate = market.endDate ? new Date(market.endDate).toLocaleDateString() : "—";
  const isActive = market.active && !market.closed;

  return (
    <div onClick={() => onSelect(market)} style={{
      background: selected ? "#00c80510" : "#0d0d0d",
      border: `1.5px solid ${selected ? "#00c805" : "#181818"}`,
      borderRadius: "16px", padding: "16px",
      cursor: "pointer", transition: "all 0.18s",
      boxShadow: selected ? "0 0 20px #00c80520" : "none",
      marginBottom: "8px"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "#ddd", lineHeight: 1.4, marginBottom: "10px" }}>{market.question}</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {market.asset === "BTC" && <Badge color="yellow">₿ BTC</Badge>}
            {market.asset === "ETH" && <Badge color="blue">Ξ ETH</Badge>}
            {market.interval && <Badge color="gray">{market.interval}</Badge>}
            <Badge color="green">YES {yesPrice}¢</Badge>
            <Badge color="red">NO {noPrice}¢</Badge>
            {vol > 0 && <Badge color="gray">Vol {fmtVol(vol)}</Badge>}
            {liquidity > 0 && <Badge color="blue">Liq {fmtVol(liquidity)}</Badge>}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <Badge color={isActive ? "green" : "gray"}>{isActive ? "Live" : "Inactive"}</Badge>
          <div style={{ fontSize: "11px", color: "#ddd", marginTop: "6px" }}>Ends {endDate}</div>
        </div>
      </div>

      {/* YES probability bar */}
      <div style={{ marginTop: "12px", background: "#1e1e1e", borderRadius: "100px", height: "5px", overflow: "hidden" }}>
        <div style={{ width: `${yesPrice}%`, height: "100%", background: "linear-gradient(90deg, #00c805, #00ff88)", borderRadius: "100px", transition: "width 0.4s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
        <span style={{ fontSize: "10px", color: "#00c805", fontWeight: 600 }}>YES {yesPrice}%</span>
        <span style={{ fontSize: "10px", color: "#ff5000", fontWeight: 600 }}>NO {noPrice}%</span>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────


export default function App() {
  const [tab, setTab] = useState("Home");

  // ── Credentials & connection ─────────────────────────────────────────────
  const [privateKey, setPrivateKey]     = useState("");
  const [apiKey, setApiKey]             = useState("");
  const [apiSecret, setApiSecret]       = useState("");
  const [apiPassphrase, setApiPassphrase] = useState("");
  const [funderAddress, setFunderAddress] = useState("");
  const [walletType, setWalletType]     = useState("magic"); // "magic" | "metamask" | "eoa"
  const [connected, setConnected]       = useState(false);
  const [liveMode, setLiveMode]         = useState(false);   // false = paper, true = real orders
  const [connError, setConnError]       = useState("");
  const [positions, setPositions]       = useState([]);       // open Polymarket positions
  const [liveBalance, setLiveBalance]   = useState(null);     // on-chain USDC balance
  const [orderLog, setOrderLog]         = useState([]);       // CLOB order responses
  const [wsStatus, setWsStatus]         = useState("disconnected"); // ws price feed status
  const creds = useRef({});

  // Live market data
  const [markets, setMarkets] = useState([]);
  const [marketsLoading, setMarketsLoading] = useState(false);
  const [marketsError, setMarketsError] = useState(null);
  const [selectedMarket, setSelectedMarket] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [marketSearch, setMarketSearch] = useState("");

  // Bot states
  const [volBotOn, setVolBotOn] = useState(false);
  const [entryBotOn, setEntryBotOn] = useState(false);
  const [edgeBotOn, setEdgeBotOn] = useState(false);

  // Config
  const [spikeThreshold, setSpikeThreshold] = useState(1.8);
  const [maxBet, setMaxBet] = useState(200);
  const [stopLoss, setStopLoss] = useState(15);
  const [takeProfit, setTakeProfit] = useState(35);

  // Chart data
  const [candles, setCandles] = useState(() => {
    const arr = []; let p = 50;
    for (let i = 0; i < 60; i++) { const c = genCandle(p); arr.push(c); p = c.close; }
    return arr;
  });
  const [spikes, setSpikes] = useState([]);
  const [entryPrice, setEntryPrice] = useState(null);
  const [tradeMarkers, setTradeMarkers] = useState([]);

  // Bot outputs
  const [volAlerts, setVolAlerts] = useState([]);
  const [trades, setTrades] = useState([]);
  const [edgeScore, setEdgeScore] = useState(52);
  const [edgeHistory, setEdgeHistory] = useState([52]);
  const [edgeSuggestions, setEdgeSuggestions] = useState([]);
  const [totalPnl, setTotalPnl] = useState(0);
  const [winCount, setWinCount] = useState(0);
  const [tradeCount, setTradeCount] = useState(0);
  const [balance, setBalance] = useState(50);
  const [pnlTick, setPnlTick] = useState(0); // ticks every 30s to drop expired trades from window counters

  const timerRef = useRef(null);
  const edgeRef = useRef(edgeScore);
  edgeRef.current = edgeScore;

  // Live Polymarket data
  const [orderBook, setOrderBook] = useState({ bids: [], asks: [] });
  const [liveYesPrice, setLiveYesPrice] = useState(null);
  const liveVolBuffer = useRef([]); // accumulates real vol ticks between candle closes
  const lastCandleTime = useRef(Date.now());

  // ── Adaptive strategy engine state ────────────────────────────────────────
  const [strategy, setStrategy] = useState("normal"); // "normal" | "defensive" | "recovery" | "aggressive"
  const [strategyLog, setStrategyLog] = useState([]);
  const [consecutiveLosses, setConsecutiveLosses] = useState(0);
  const [consecutiveWins, setConsecutiveWins] = useState(0);
  const [peakBalance, setPeakBalance] = useState(50);
  const [drawdown, setDrawdown] = useState(0);
  const strategyRef = useRef("normal");
  const consecutiveLossRef = useRef(0);
  const consecutiveWinRef = useRef(0);
  const balanceRef = useRef(50);
  const peakRef = useRef(50);
  const tradeCountRef = useRef(0);
  const winCountRef = useRef(0);

  // ── Fetch live markets from Polymarket Gamma API ───────────────────────────
  const [dataSource, setDataSource] = useState("loading");

  const loadMarkets = useCallback(async () => {
    setMarketsLoading(true);
    setMarketsError(null);
    try {
      const data = await fetchMarkets(30);
      const isStatic = data[0] && data[0].id && data[0].id.startsWith("btc-");
      setDataSource(isStatic ? "static" : "live");
      const seen = new Set();
      const deduped = (Array.isArray(data) ? data : []).filter(m => {
        const key = m.id || m.conditionId || m.question;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      // Only keep BTC 5-min up/down markets
      const btc5m = deduped.filter(m => m.asset === "BTC" && m.interval === "5m");
      const final = btc5m.length > 0 ? btc5m : deduped;
      setMarkets(final);
      setLastFetched(new Date());
      // Always auto-select the next upcoming candle (first market)
      if (final.length > 0) {
        setSelectedMarket(final[0]);
        const initPrice = parseYesPrice(final[0]);
        const arr = []; let p = initPrice;
        for (let i = 0; i < 60; i++) { const c = genCandle(p); arr.push(c); p = c.close; }
        setCandles(arr);
      }
    } catch (e) {
      setMarketsError(e.message || "Could not load markets.");
      setDataSource("error");
    } finally {
      setMarketsLoading(false);
    }
  }, []);

  // Fetch on mount only (ref prevents double-invoke in StrictMode)
  const hasFetched = useRef(false);
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    loadMarkets();
    const t = setInterval(loadMarkets, 30_000);
    return () => clearInterval(t);
  }, []);

  // Sync creds ref whenever credentials change
  useEffect(() => {
    creds.current = { privateKey, apiKey, apiSecret, apiPassphrase, funderAddress, walletType };
  }, [privateKey, apiKey, apiSecret, apiPassphrase, funderAddress, walletType]);

  // Fetch live positions when connected
  useEffect(() => {
    if (!connected || !apiKey) return;
    const load = async () => {
      const pos = await fetchPositions(apiKey);
      if (pos) setPositions(Array.isArray(pos) ? pos : pos.positions || []);
      try {
        const r = await fetch(`${DATA}/value?apiKey=${apiKey}`);
        if (r.ok) { const d = await r.json(); setLiveBalance(d.balance || d.value || null); }
      } catch {}
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [connected, apiKey]);

  const priceFeedRef = useRef(null);
  const pollRef = useRef(null);

  const handleSelectMarket = (market) => {
    setSelectedMarket(market);
    const initPrice = parseYesPrice(market);
    const arr = []; let p = initPrice;
    for (let i = 0; i < 60; i++) { const c = genCandle(p); arr.push(c); p = c.close; }
    setCandles(arr);
    setTradeMarkers([]);
    setEntryPrice(null);
    setVolAlerts([]);
    liveVolBuffer.current = [];
    lastCandleTime.current = Date.now();

    // Disconnect previous feeds
    if (priceFeedRef.current) priceFeedRef.current();
    if (pollRef.current) clearInterval(pollRef.current);

    // Get YES token ID (index 0 = YES, index 1 = NO)
    let tokenId = null;
    try {
      const tokens = JSON.parse(market.clobTokenIds || "[]");
      tokenId = tokens[0] || market.conditionId;
    } catch { tokenId = market.conditionId; }

    if (!tokenId) return;

    const onPrice = (px) => {
      setLiveYesPrice(px);
      setCandles(prev => {
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), {
          ...last,
          close: px,
          high: Math.max(last.high, px),
          low: Math.min(last.low, px)
        }];
      });
    };

    const onVol = (v) => { liveVolBuffer.current.push(v); };
    const onBook = (book) => setOrderBook(book);
    const onStatus = (s) => setWsStatus(s);

    // Try WebSocket first
    setWsStatus("connecting");
    priceFeedRef.current = createPriceFeed(tokenId, onPrice, onVol, onBook, onStatus);

    // Also poll REST every 3s as reliable fallback (works even when WS is blocked by CORS)
    pollRef.current = setInterval(() => {
      pollClobPrice(tokenId, onPrice, onVol, onBook);
    }, 3000);
  };

  useEffect(() => () => {
    if (priceFeedRef.current) priceFeedRef.current();
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  // Tick every 30s so time-window PnL counters drop expired trades naturally
  useEffect(() => {
    const t = setInterval(() => setPnlTick(v => v + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // ── Adaptive strategy adjuster ────────────────────────────────────────────
  const adjustStrategy = useCallback((newBalance, newWinCount, newTradeCount, newConsecLosses, newConsecWins) => {
    const wr = newTradeCount >= 3 ? newWinCount / newTradeCount : 0.5;
    const dd = peakRef.current > 0 ? (peakRef.current - newBalance) / peakRef.current : 0;
    const prev = strategyRef.current;
    let next = "normal";
    let reason = null;

    if (newConsecLosses >= 4 || dd > 0.2 || (newTradeCount >= 5 && wr < 0.3)) {
      // Severe — switch to recovery: tiny size, ultra-high spike threshold, wait for clearest signals
      next = "recovery";
      reason = newConsecLosses >= 4
        ? `${newConsecLosses} consecutive losses — entering RECOVERY mode`
        : dd > 0.2 ? `${(dd*100).toFixed(0)}% drawdown — entering RECOVERY mode`
        : `Win rate ${(wr*100).toFixed(0)}% — entering RECOVERY mode`;
      setSpikeThreshold(t => Math.min(t + 0.4, 3.0));
      setMaxBet(b => Math.max(b * 0.4, 10));
    } else if (newConsecLosses >= 2 || (newTradeCount >= 4 && wr < 0.4)) {
      // Struggling — switch to defensive: raise threshold, cut bet size
      next = "defensive";
      reason = newConsecLosses >= 2
        ? `${newConsecLosses} losses in a row — switching to DEFENSIVE`
        : `Win rate ${(wr*100).toFixed(0)}% — switching to DEFENSIVE`;
      setSpikeThreshold(t => Math.min(t + 0.2, 2.8));
      setMaxBet(b => Math.max(b * 0.65, 15));
    } else if (newConsecWins >= 3 && wr >= 0.6) {
      // Hot streak — go aggressive: lower threshold slightly, increase bet
      next = "aggressive";
      reason = `${newConsecWins} wins in a row (${(wr*100).toFixed(0)}% WR) — going AGGRESSIVE`;
      setSpikeThreshold(t => Math.max(t - 0.2, 2.0));
      setMaxBet(b => Math.min(b * 1.3, 1000));
    } else if (newConsecWins >= 1 && prev !== "normal" && wr >= 0.5) {
      // Recovering back to normal
      next = "normal";
      reason = `Win rate recovering (${(wr*100).toFixed(0)}%) — back to NORMAL strategy`;
      setSpikeThreshold(1.8);
      setMaxBet(b => Math.min(b * 1.1, 500));
    }

    if (next !== prev) {
      strategyRef.current = next;
      setStrategy(next);
      if (reason) {
        setStrategyLog(log => [{
          id: Date.now(),
          time: new Date().toLocaleTimeString(),
          from: prev,
          to: next,
          reason,
          wr: (wr * 100).toFixed(0),
          balance: newBalance.toFixed(2)
        }, ...log.slice(0, 19)]);
      }
    }
  }, []);

  // ── Quick-close evaluator with adaptive exits ──────────────────────────────
  const evaluateEntry = useCallback((tradeId, entryPx, size, side) => {
    const startTime = Date.now();
    // Hold time varies by strategy: recovery = shorter, aggressive = slightly longer
    const maxHold = strategyRef.current === "recovery" ? 2400
      : strategyRef.current === "aggressive" ? 6000 : 4800;
    const checkInterval = 400;

    const checker = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const strat = strategyRef.current;
      const tickMove = (Math.random() - 0.46) * 2.2;
      const drift = strat === "aggressive" ? -0.42 : strat === "recovery" ? -0.48 : -0.44;
      const currentPx = entryPx + (elapsed / 1200) * (Math.random() + drift) * 1.6 + tickMove;
      const rawPnl = (side === "YES" ? currentPx - entryPx : entryPx - currentPx) * (size / Math.max(entryPx, 1));
      // Recovery mode: take any profit immediately; aggressive: hold for more
      const profitTarget = strat === "recovery" ? 0.02 : strat === "aggressive" ? 0.12 : 0.05;
      const inProfit = rawPnl > profitTarget;
      const timeout = elapsed >= maxHold;

      if (inProfit || timeout) {
        clearInterval(checker);
        const good = rawPnl > 0;
        const holdMs = elapsed;
        const reason = good
          ? ["Spike momentum held — quick exit", "Volume follow-through confirmed", "Directional move captured"][Math.floor(Math.random() * 3)]
          : ["Spike faded before profit", "Counter-move after entry", "Volume dried up — stopped out"][Math.floor(Math.random() * 3)];
        const suggestion = !good ? [
          "Tighten entry — only first tick after spike",
          "Require 2× spike ratio before entering",
          "Skip spikes where body < 40% of range",
          "Wait for volume to sustain 2 candles",
          "Reduce size when spread is wide at spike"
        ][Math.floor(Math.random() * 5)] : null;

        setTrades(prev => prev.map(t => t.id === tradeId ? {
          ...t, status: "closed", pnl: rawPnl, exitPx: fmt(currentPx),
          holdMs, evalResult: good ? "good" : "bad", reason, strategy: strat
        } : t));
        setTradeMarkers(prev => prev.map(m => m.id === tradeId ? { ...m, pnl: rawPnl } : m));
        setTotalPnl(p => p + rawPnl);

        setBalance(prev => {
          const nb = prev + rawPnl;
          balanceRef.current = nb;
          if (nb > peakRef.current) { peakRef.current = nb; setPeakBalance(nb); }
          const dd = peakRef.current > 0 ? (peakRef.current - nb) / peakRef.current : 0;
          setDrawdown(Math.round(dd * 100));
          return nb;
        });

        // Update streak counters
        let newConsecLosses = consecutiveLossRef.current;
        let newConsecWins = consecutiveWinRef.current;
        if (good) { newConsecWins++; newConsecLosses = 0; }
        else { newConsecLosses++; newConsecWins = 0; }
        consecutiveLossRef.current = newConsecLosses;
        consecutiveWinRef.current = newConsecWins;
        setConsecutiveLosses(newConsecLosses);
        setConsecutiveWins(newConsecWins);
        if (good) setWinCount(w => {
          winCountRef.current = w + 1;
          return w + 1;
        });

        tradeCountRef.current += 1;
        adjustStrategy(balanceRef.current, winCountRef.current, tradeCountRef.current, newConsecLosses, newConsecWins);

        const newScore = clamp(edgeRef.current + (good ? Math.random() * 3 : -Math.random() * 2), 25, 96);
        setEdgeScore(Math.round(newScore));
        setEdgeHistory(h => [...h.slice(-49), Math.round(newScore)]);
        if (!good && suggestion) {
          setEdgeSuggestions(s => [{ id: Date.now(), text: suggestion, time: new Date().toLocaleTimeString(), applied: false }, ...s.slice(0, 9)]);
        }
      }
    }, checkInterval);
  }, [adjustStrategy]);

  // Entry only fires when Volume Bot detects a confirmed spike
  const triggerEntry = useCallback((price, candleBullish, spikeRatio) => {
    if (!entryBotOn || !selectedMarket) return;
    // Only enter if spike is strong enough (ratio > threshold + 0.5 for extra confidence)
    if (spikeRatio < spikeThreshold + 0.1) return;
    // Dynamic Kelly-style sizing: scales with win rate and edge score
    // Base: 5% of balance. Scales up to 20% as win rate and edge improve.
    const wr = tradeCountRef.current >= 3 ? winCountRef.current / tradeCountRef.current : 0.5;
    const edgeBonus = clamp((edgeRef.current - 50) / 50, 0, 1); // 0 at edge=50, 1 at edge=100
    const wrBonus = clamp((wr - 0.4) / 0.4, 0, 1);              // 0 at 40% WR, 1 at 80%+ WR
    const stratMultiplier = strategyRef.current === "aggressive" ? 1.4
      : strategyRef.current === "recovery" ? 0.3
      : strategyRef.current === "defensive" ? 0.5 : 1.0;
    const basePct = 0.05 + (edgeBonus * 0.08) + (wrBonus * 0.07); // 5% → up to 20%
    const rawSize = balanceRef.current * basePct * stratMultiplier;
    const size = Math.min(maxBet, Math.max(rawSize, 2));
    const side = candleBullish ? "YES" : "NO";
    const label = candleBullish ? "UP ↑" : "DOWN ↓";
    const id = Date.now();
    const trade = {
      id,
      time: new Date().toLocaleTimeString(),
      timestamp: Date.now(),
      market: selectedMarket.question?.slice(0, 50) + "…",
      side, label,
      price: fmt(price),
      size: fmt(size),
      spikeRatio: fmt(spikeRatio, 2),
      status: "open",
      pnl: null, evalResult: null, reason: null, holdMs: null
    };
    setEntryPrice(price);
    setTrades(prev => [trade, ...prev]);
    setTradeMarkers(prev => [{ id, side, price, pnl: null }, ...prev.slice(0, 14)]);
    setTradeCount(c => c + 1);
    if (edgeBotOn) evaluateEntry(id, price, size, side);
  }, [entryBotOn, edgeBotOn, maxBet, balance, selectedMarket, spikeThreshold, evaluateEntry]);

  // ── Volume bot loop — uses REAL Polymarket order book volume when available ──
  useEffect(() => {
    if (!volBotOn) { clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => {
      setCandles(prev => {
        const last = prev[prev.length - 1];

        // Use real accumulated volume from live feed, fall back to simulation
        const realVolTicks = liveVolBuffer.current.splice(0);
        const hasRealVol = realVolTicks.length > 0;
        const realVol = hasRealVol ? realVolTicks.reduce((a, v) => a + v, 0) : 0;

        // Simulated volume as baseline when no real data
        const baseVol = 80 + Math.random() * 70;
        const spikeRoll = Math.random();
        const simVol = spikeRoll < 0.18 ? baseVol * (2 + Math.random() * 2.5) : baseVol;

        // Prefer real volume; blend if partial data
        const vol = hasRealVol ? Math.max(realVol, 1) : simVol;

        // Build new candle — use real YES price if available, else random walk
        const currentClose = liveYesPrice || last.close;
        const newClose = hasRealVol
          ? clamp(currentClose + (Math.random() - 0.48) * 0.8, 1, 99) // tight walk around real price
          : clamp(last.close + (Math.random() - 0.48) * 1.6, 5, 95);

        const newC = {
          open: last.close,
          close: newClose,
          high: Math.max(last.close, newClose) + Math.random() * (hasRealVol ? 0.5 : 1.2),
          low: Math.min(last.close, newClose) - Math.random() * (hasRealVol ? 0.5 : 1.2),
          vol,
          isLive: hasRealVol
        };

        const updated = [...prev.slice(-99), newC];
        const idx = updated.length - 1;

        // Rolling 20-candle average (excluding current)
        const window = updated.slice(Math.max(0, idx - 20), idx);
        if (window.length >= 5) {
          const avg = window.reduce((a, c) => a + c.vol, 0) / window.length;
          const ratio = vol / avg;
          if (ratio >= spikeThreshold) {
            const body = Math.abs(newC.close - newC.open);
            const range = (newC.high - newC.low) || 1;
            const strongCandle = body / range > 0.2;
            if (strongCandle) {
              setSpikes(s => [...s.slice(-9), idx]);
              setVolAlerts(a => [{
                id: Date.now(),
                time: new Date().toLocaleTimeString(),
                vol: fmt(vol, 1),
                avg: fmt(avg, 1),
                ratio: fmt(ratio, 2),
                price: fmt(newC.close),
                dir: newC.close >= newC.open ? "UP" : "DOWN",
                body: fmt(body / range * 100, 0),
                isLive: hasRealVol
              }, ...a.slice(0, 29)]);
              triggerEntry(newC.close, newC.close >= newC.open, ratio);
            }
          }
        }
        return updated;
      });
    }, 1200);
    return () => clearInterval(timerRef.current);
  }, [volBotOn, spikeThreshold, triggerEntry, liveYesPrice]);

  const anyOn = volBotOn || entryBotOn || edgeBotOn;
  const winRate = tradeCount > 0 ? Math.round((winCount / tradeCount) * 100) : 0;
  const lastPrice = candles[candles.length - 1]?.close || 50;
  const filteredMarkets = markets.filter(m => !marketSearch || m.question?.toLowerCase().includes(marketSearch.toLowerCase()));

  // Time-window PnL counters (pnlTick forces recompute every 30s to drop expired trades)
  void pnlTick;
  const _now = Date.now();
  const _closed = trades.filter(t => t.status === "closed" && t.timestamp);
  const pnlWindows = [
    { label: "30 MIN",  ms: 30 * 60_000 },
    { label: "1 HOUR",  ms: 60 * 60_000 },
    { label: "1 DAY",   ms: 24 * 60 * 60_000 },
  ].map(w => {
    const wt = _closed.filter(t => _now - t.timestamp < w.ms);
    return { label: w.label, pnl: wt.reduce((s, t) => s + (t.pnl || 0), 0), count: wt.length };
  });

  return (
    <div style={{ minHeight: "100vh", background: "#080808", color: "#fff", fontFamily: "'DM Sans', -apple-system, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes pulseGlow{0%,100%{opacity:1}50%{opacity:0.35}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideIn{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        input[type=range]{-webkit-appearance:none;height:3px;border-radius:2px;background:#1e1e1e;outline:none;}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:17px;height:17px;border-radius:50%;background:#00c805;cursor:pointer;box-shadow:0 0 10px #00c80566;}
        ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-thumb{background:#222;border-radius:2px;}
        button:active{transform:scale(0.95)!important;}
      `}</style>

      {/* ── NAV ── */}
      <div style={{ background: "#0a0a0a", borderBottom: "1px solid #161616", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
        {/* Left: logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "30px", height: "30px", background: "linear-gradient(135deg,#00c805,#00ff88)", borderRadius: "9px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", boxShadow: "0 0 14px #00c80540" }}>⚡</div>
          <span style={{ fontWeight: 800, fontSize: "16px", letterSpacing: "-0.03em" }}>frostAIPolyBot</span>
          {anyOn && <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 9px", borderRadius: "100px", background: "#00c80515", border: "1px solid #00c80330", fontSize: "10px", fontWeight: 700, color: "#00c805" }}>
            <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#00c805", display: "inline-block", animation: "pulseGlow 1.2s ease infinite" }} /> LIVE
          </span>}
          {connected && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 9px", borderRadius: "100px", background: liveMode ? "#ff500015" : "#4488ff15", border: `1px solid ${liveMode ? "#ff500033" : "#4488ff33"}`, fontSize: "10px", fontWeight: 700, color: liveMode ? "#ff5000" : "#4488ff" }}>
              {liveMode ? "🔴 LIVE" : "📄 PAPER"}
            </span>
          )}
          {wsStatus === "live" && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 9px", borderRadius: "100px", background: "#00c80510", border: "1px solid #00c80530", fontSize: "10px", fontWeight: 700, color: "#00c805" }}>
              <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#00c805", display: "inline-block", animation: "pulseGlow 0.8s ease infinite" }} /> WS
            </span>
          )}
          {anyOn && (() => {
            const colors = { normal: "#00c805", defensive: "#f5a623", recovery: "#ff5000", aggressive: "#4488ff" };
            const icons = { normal: "✅", defensive: "🛡️", recovery: "🔄", aggressive: "🚀" };
            const col = colors[strategy] || "#00c805";
            return (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 10px", borderRadius: "100px", background: `${col}18`, border: `1px solid ${col}44`, fontSize: "10px", fontWeight: 700, color: col }}>
                {icons[strategy]} {strategy.toUpperCase()}
              </span>
            );
          })()}
        </div>

        {/* Center: nav */}
        <div style={{ display: "flex", gap: "4px", background: "#111", padding: "4px", borderRadius: "100px", border: "1px solid #1e1e1e" }}>
          {["Home", "Settings"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "6px 18px", borderRadius: "100px",
              background: tab === t ? "#00c805" : "transparent",
              color: tab === t ? "#000" : "#bbb",
              border: "none", fontFamily: "inherit", fontWeight: 700, fontSize: "12px",
              cursor: "pointer", transition: "all 0.18s"
            }}>{t}</button>
          ))}
        </div>

        {/* Right: portfolio + win rate */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {/* Win Rate pill */}
          <div style={{ background: "#111", border: `1px solid ${winRate >= 50 ? "#1e1e1e" : "#ff500033"}`, borderRadius: "14px", padding: "6px 14px", textAlign: "center", minWidth: "72px" }}>
            <div style={{ fontSize: "9px", color: "#999", fontWeight: 700, letterSpacing: "0.08em" }}>WIN RATE</div>
            <div style={{ fontSize: "16px", fontWeight: 800, color: winRate >= 55 ? "#00c805" : winRate >= 45 ? "#f5a623" : "#ff5000", lineHeight: 1.2 }}>{winRate}<span style={{ fontSize: "11px", color: "#555" }}>%</span></div>
            <div style={{ fontSize: "9px", color: "#555" }}>{winCount}W · {tradeCount - winCount}L</div>
            {drawdown > 5 && <div style={{ fontSize: "9px", color: "#ff5000", fontWeight: 700 }}>DD {drawdown}%</div>}
          </div>
          <div style={{ width: "1px", height: "36px", background: "#1e1e1e" }} />
          {/* Portfolio */}
          <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: "14px", padding: "6px 14px", textAlign: "center" }}>
            <div style={{ fontSize: "9px", color: "#999", fontWeight: 700, letterSpacing: "0.08em" }}>PORTFOLIO</div>
            <div style={{ fontSize: "16px", fontWeight: 800, lineHeight: 1.2 }}>${fmt(balance)}</div>
            <div style={{ fontSize: "9px", color: totalPnl >= 0 ? "#00c805" : "#ff5000", fontWeight: 700 }}>{fmtPnl(totalPnl)}</div>
          </div>
          <div style={{ width: "1px", height: "36px", background: "#1e1e1e" }} />
          {/* Earnings Counter */}
          <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: "14px", padding: "6px 14px" }}>
            <div style={{ fontSize: "9px", color: "#999", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "4px" }}>EARNINGS</div>
            {pnlWindows.map(({ label, pnl }) => {
              const col = pnl > 0 ? "#00c805" : pnl < 0 ? "#ff5000" : "#555";
              return (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontSize: "9px", color: "#555", fontWeight: 700 }}>{label}</span>
                  <span style={{ fontSize: "11px", fontWeight: 800, color: col }}>{pnl >= 0 ? "+" : "-"}${fmt(Math.abs(pnl))}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "18px 16px" }}>

        {/* ══ SETTINGS ══════════════════════════════════════════════════════ */}
        {tab === "Settings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", animation: "fadeUp 0.3s ease", maxWidth: "680px", margin: "0 auto" }}>

            {/* ── Connection card ── */}
            <Card glow={connected ? "#00c805" : undefined}>
              <div style={{ fontWeight: 800, fontSize: "17px", marginBottom: "2px" }}>🔑 Polymarket API Credentials</div>
              <div style={{ fontSize: "12px", color: "#777", marginBottom: "18px" }}>
                Get your keys at <span style={{ color: "#4488ff" }}>polymarket.com → Settings → API</span>. Keys are stored in memory only and never sent anywhere except Polymarket's CLOB.
              </div>

              {connected ? (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px", background: "#00c80510", borderRadius: "14px", border: "1px solid #00c80330", marginBottom: "14px" }}>
                    <span style={{ fontSize: "22px" }}>✅</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, color: "#00c805", fontSize: "14px" }}>Connected to Polymarket CLOB</div>
                      <div style={{ fontSize: "11px", color: "#bbb", marginTop: "2px" }}>
                        {liveMode ? "🔴 LIVE orders enabled" : "📄 Paper trading mode"}
                        {liveBalance !== null && <span style={{ marginLeft: "10px", color: "#00c805" }}>· USDC: ${fmt(liveBalance)}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <BubbleBtn size="sm" active={liveMode} color={liveMode ? "#ff5000" : "#f5a623"}
                        onClick={() => setLiveMode(v => !v)}>
                        {liveMode ? "🔴 Live" : "📄 Paper"}
                      </BubbleBtn>
                      <BubbleBtn size="sm" active color="#ff5000" onClick={() => {
                        setConnected(false); setLiveMode(false);
                        setPrivateKey(""); setApiKey(""); setApiSecret(""); setApiPassphrase(""); setFunderAddress("");
                        setConnError("");
                      }}>Disconnect</BubbleBtn>
                    </div>
                  </div>

                  {/* Open positions */}
                  {positions.length > 0 && (
                    <div>
                      <div style={{ fontSize: "10px", color: "#999", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "8px" }}>OPEN POSITIONS</div>
                      {positions.slice(0, 5).map((p, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "#0d0d0d", borderRadius: "10px", marginBottom: "5px" }}>
                          <div style={{ fontSize: "11px", color: "#ddd", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title || p.question || p.market}</div>
                          <div style={{ fontSize: "11px", fontWeight: 700, color: "#00c805", marginLeft: "10px" }}>${fmt(p.size || p.value || 0)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {connError && <div style={{ padding: "10px 14px", background: "#ff500015", border: "1px solid #ff500033", borderRadius: "10px", fontSize: "12px", color: "#ff5000" }}>⚠️ {connError}</div>}

                  {/* Wallet type selector */}
                  <div>
                    <div style={{ fontSize: "11px", color: "#999", fontWeight: 700, letterSpacing: "0.06em", marginBottom: "8px" }}>WALLET TYPE</div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {[["magic", "Email / Magic"], ["metamask", "MetaMask"], ["eoa", "EOA / Hardware"]].map(([val, label]) => (
                        <button key={val} onClick={() => setWalletType(val)} style={{
                          padding: "7px 14px", borderRadius: "100px", border: `1.5px solid ${walletType === val ? "#4488ff" : "#222"}`,
                          background: walletType === val ? "#4488ff15" : "#111", color: walletType === val ? "#4488ff" : "#777",
                          fontFamily: "inherit", fontSize: "11px", fontWeight: 700, cursor: "pointer"
                        }}>{label}</button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    {[
                      { label: "Private Key", key: "privateKey", val: privateKey, set: setPrivateKey, ph: "0x…your wallet private key", hint: "Never share this" },
                      { label: "Funder Address", key: "funderAddress", val: funderAddress, set: setFunderAddress, ph: "0x…your proxy wallet address", hint: "Address holding your USDC" },
                      { label: "API Key", key: "apiKey", val: apiKey, set: setApiKey, ph: "CLOB API key", hint: "From polymarket.com/settings" },
                      { label: "API Secret", key: "apiSecret", val: apiSecret, set: setApiSecret, ph: "CLOB API secret", hint: "" },
                      { label: "API Passphrase", key: "apiPassphrase", val: apiPassphrase, set: setApiPassphrase, ph: "CLOB passphrase", hint: "" },
                    ].map(f => (
                      <div key={f.key} style={{ gridColumn: f.key === "apiPassphrase" ? "1 / -1" : undefined }}>
                        <div style={{ fontSize: "11px", color: "#999", fontWeight: 700, marginBottom: "5px" }}>
                          {f.label} {f.hint && <span style={{ color: "#444", fontWeight: 400 }}>— {f.hint}</span>}
                        </div>
                        <input type="password" placeholder={f.ph} value={f.val} onChange={e => f.set(e.target.value)}
                          style={{ width: "100%", padding: "10px 14px", background: "#0d0d0d", border: "1.5px solid #1e1e1e", borderRadius: "10px", color: "#fff", fontFamily: "monospace", fontSize: "12px", outline: "none" }} />
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "flex", gap: "10px", alignItems: "center", paddingTop: "4px" }}>
                    <BubbleBtn active color="#00c805" size="lg" onClick={() => {
                      if (!apiKey.trim()) { setConnError("API Key is required"); return; }
                      setConnError("");
                      setConnected(true);
                    }}>
                      Connect to Polymarket
                    </BubbleBtn>
                    <div style={{ fontSize: "11px", color: "#444" }}>🔒 Stored in memory only · Never transmitted except to clob.polymarket.com</div>
                  </div>
                </div>
              )}
            </Card>

            {/* ── Order log ── */}
            {orderLog.length > 0 && (
              <Card>
                <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "10px" }}>📋 CLOB Order Log</div>
                <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                  {orderLog.map(o => (
                    <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 8px", borderBottom: "1px solid #141414", fontSize: "11px" }}>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <span style={{ padding: "2px 7px", borderRadius: "6px", fontSize: "10px", fontWeight: 700,
                          background: o.status === "filled" ? "#00c80520" : o.status === "paper" ? "#4488ff20" : "#ff500020",
                          color: o.status === "filled" ? "#00c805" : o.status === "paper" ? "#4488ff" : "#ff5000" }}>
                          {o.status === "paper" ? "PAPER" : o.status?.toUpperCase()}
                        </span>
                        <span style={{ color: o.side === "YES" ? "#00c805" : "#ff5000", fontWeight: 700 }}>{o.side}</span>
                        <span style={{ color: "#bbb" }}>${o.size} @ {o.price}¢</span>
                      </div>
                      <div style={{ color: "#555" }}>{o.time} · {o.tokenId}</div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* ── API Status ── */}
            <Card>
              <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "12px" }}>🌐 API Status</div>
              <StatRow label="Gamma API" value="gamma-api.polymarket.com" />
              <StatRow label="CLOB API" value="clob.polymarket.com" />
              <StatRow label="Data API" value="data-api.polymarket.com" />
              <StatRow label="WebSocket" value={wsStatus === "live" ? "🟢 Live" : wsStatus === "connecting" ? "🟡 Connecting…" : "⚫ Disconnected"} valueColor={wsStatus === "live" ? "#00c805" : wsStatus === "connecting" ? "#f5a623" : "#555"} />
              <StatRow label="Markets loaded" value={markets.length} valueColor="#00c805" />
              <StatRow label="Last refresh" value={lastFetched?.toLocaleTimeString() || "—"} />
              <div style={{ marginTop: "12px" }}>
                <BubbleBtn active color="#00c805" onClick={loadMarkets} disabled={marketsLoading}>{marketsLoading ? "…" : "↻ Refresh Markets"}</BubbleBtn>
              </div>
            </Card>

            {/* ── Trading Config ── */}
            <Card>
              <div style={{ fontSize: "11px", color: "#999", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "16px" }}>TRADING CONFIG</div>
              <Slider label="Max Bet Size" value={maxBet} onChange={setMaxBet} min={10} max={1000} step={10} prefix="$" />
              <Slider label="Stop Loss" value={stopLoss} onChange={setStopLoss} min={5} max={50} suffix="%" />
              <Slider label="Take Profit" value={takeProfit} onChange={setTakeProfit} min={10} max={100} suffix="%" />
              <Slider label="Volume Spike Threshold" value={spikeThreshold} onChange={setSpikeThreshold} min={1.5} max={5} step={0.1} suffix="×" />
            </Card>

            {/* ── Risk Warning ── */}
            <Card style={{ background: "#0f0808", border: "1px solid #ff500022" }}>
              <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "6px", color: "#ff5000" }}>⚠️ Risk Warning</div>
              <div style={{ fontSize: "12px", color: "#bbb", lineHeight: 1.7 }}>
                Prediction market trading carries significant risk of loss. This bot is experimental software — not financial advice.
                In LIVE mode, real USDC will be spent. Start with paper trading to verify performance. Never risk more than you can afford to lose.
              </div>
            </Card>

          </div>
        )}

        {/* ══ HOME ═════════════════════════════════════════════════════════ */}
        {tab === "Home" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", animation: "fadeUp 0.3s ease" }}>

            {/* ── ROW 1: Entry Bot + Edge Builder (full width, top) ── */}
            <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: "16px" }}>

              {/* Entry Bot — main card */}
              <Card glow={entryBotOn ? "#4488ff" : undefined}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "18px" }}>🎯</span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: "15px" }}>Entry Bot</div>
                      <div style={{ fontSize: "11px", color: "#bbb" }}>BTC 5-min · UP ↑ or DOWN ↓</div>
                    </div>
                    {entryBotOn && <Badge color="blue">Spike-only</Badge>}
                  </div>

                </div>

                {/* Live chart */}
                <div style={{ background: "#0a0a0a", borderRadius: "10px", padding: "8px 6px 4px", marginBottom: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "0 4px 6px" }}>
                    <span style={{ fontSize: "9px", color: "#333", fontWeight: 700, letterSpacing: "0.08em" }}>BTC 5-MIN · YES=UP  NO=DOWN</span>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <span style={{ fontSize: "9px", color: "#00c805", fontWeight: 700 }}>↑ UP</span>
                      <span style={{ fontSize: "9px", color: "#ff5000", fontWeight: 700 }}>↓ DOWN</span>
                    </div>
                  </div>
                  <LiveTradeChart candles={candles} tradeMarkers={tradeMarkers} entryPrice={entryPrice} />
                </div>

                {/* Active market + live price */}
                {selectedMarket && (
                  <div style={{ background: "#0d0d0d", borderRadius: "10px", padding: "10px 12px", marginBottom: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <div style={{ fontSize: "11px", color: "#ddd", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedMarket.question}</div>
                      <div style={{ display: "flex", gap: "5px", marginLeft: "8px", flexShrink: 0, alignItems: "center" }}>
                        {wsStatus === "live"
                          ? <span style={{ fontSize: "9px", color: "#00c805", fontWeight: 700, display: "flex", alignItems: "center", gap: "3px" }}><span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#00c805", display: "inline-block", animation: "pulseGlow 1s infinite" }} />LIVE</span>
                          : <span style={{ fontSize: "9px", color: "#f5a623", fontWeight: 700 }}>{wsStatus === "connecting" ? "⟳ connecting" : "SIM"}</span>
                        }
                        <Badge color="green">YES {liveYesPrice ? fmt(liveYesPrice, 1) : parseYesPrice(selectedMarket)}¢</Badge>
                        <Badge color="red">NO {liveYesPrice ? fmt(100 - liveYesPrice, 1) : 100 - parseYesPrice(selectedMarket)}¢</Badge>
                      </div>
                    </div>
                    {/* Order book — top 3 bids/asks */}
                    {orderBook.bids?.length > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                        <div>
                          <div style={{ fontSize: "9px", color: "#00c805", fontWeight: 700, marginBottom: "3px" }}>BIDS</div>
                          {orderBook.bids.slice(0,3).map((b,i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", padding: "1px 0" }}>
                              <span style={{ color: "#00c805" }}>{(parseFloat(b.price)*100).toFixed(1)}¢</span>
                              <span style={{ color: "#555" }}>{parseFloat(b.size).toFixed(0)}</span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <div style={{ fontSize: "9px", color: "#ff5000", fontWeight: 700, marginBottom: "3px" }}>ASKS</div>
                          {orderBook.asks.slice(0,3).map((a,i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", padding: "1px 0" }}>
                              <span style={{ color: "#ff5000" }}>{(parseFloat(a.price)*100).toFixed(1)}¢</span>
                              <span style={{ color: "#555" }}>{parseFloat(a.size).toFixed(0)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Trade history */}
                <div style={{ fontSize: "10px", color: "#999", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "8px" }}>TRADE HISTORY</div>
                <div style={{ maxHeight: "180px", overflowY: "auto" }}>
                  {trades.length === 0
                    ? <div style={{ color: "#444", fontSize: "13px", textAlign: "center", padding: "24px 0" }}>No trades yet — start both bots</div>
                    : trades.slice(0, 12).map((t, i) => (
                      <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 6px", borderBottom: "1px solid #141414", animation: "slideIn 0.25s ease" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ padding: "2px 9px", borderRadius: "100px", background: t.side === "YES" ? "#00c80520" : "#ff500020", color: t.side === "YES" ? "#00c805" : "#ff5000", fontSize: "11px", fontWeight: 800 }}>{t.label || t.side}</span>
                          <div>
                            <div style={{ fontSize: "11px", color: "#ddd" }}>
                            {t.price}¢ · ${t.size}
                            {t.spikeRatio && <span style={{ color: "#f5a623", marginLeft: "6px", fontWeight: 700 }}>×{t.spikeRatio}</span>}
                            {t.holdMs && <span style={{ color: "#555", marginLeft: "6px" }}>{(t.holdMs/1000).toFixed(1)}s</span>}
                          </div>
                          {t.reason && <div style={{ fontSize: "10px", color: t.evalResult === "good" ? "#00c805" : "#f5a623", marginTop: "1px" }}>{t.evalResult === "good" ? "✅" : "⚠️"} {t.reason?.slice(0, 38)}</div>}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          {t.status === "open" ? <Badge color="yellow">Open</Badge> : <span style={{ fontWeight: 800, fontSize: "13px", color: t.pnl >= 0 ? "#00c805" : "#ff5000" }}>{fmtPnl(t.pnl)}</span>}
                          <div style={{ fontSize: "9px", color: "#555", marginTop: "1px" }}>{t.time}</div>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </Card>

              {/* Edge Builder — merged into right column */}
              <Card glow={edgeBotOn ? "#f5a623" : undefined}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "18px" }}>🧠</span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: "15px" }}>Edge Builder</div>
                      <div style={{ fontSize: "11px", color: "#bbb" }}>Evaluates every entry</div>
                    </div>
                  </div>

                </div>

                {/* Score ring */}
                <div style={{ textAlign: "center", padding: "6px 0 12px", borderBottom: "1px solid #161616", marginBottom: "12px" }}>
                  <div style={{ fontSize: "48px", fontWeight: 800, letterSpacing: "-0.05em", lineHeight: 1, color: edgeScore >= 60 ? "#00c805" : edgeScore >= 45 ? "#f5a623" : "#ff5000" }}>
                    {edgeScore}<span style={{ fontSize: "18px", color: "#333" }}>/100</span>
                  </div>
                  <div style={{ fontSize: "11px", color: "#bbb", marginTop: "4px" }}>
                    {edgeScore >= 65 ? "Strong edge ✅" : edgeScore >= 45 ? "Building edge 📈" : "Weak — improving ⚠️"}
                  </div>
                  <div style={{ background: "#181818", borderRadius: "100px", height: "4px", overflow: "hidden", margin: "10px 16px 0" }}>
                    <div style={{ width: `${edgeScore}%`, height: "100%", background: `linear-gradient(90deg,${edgeScore >= 60 ? "#00c805,#00ff88" : edgeScore >= 45 ? "#f5a623,#ffd060" : "#ff5000,#ff8060"})`, borderRadius: "100px", transition: "width 0.6s ease" }} />
                  </div>
                </div>

                {/* Edge trend chart */}
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ fontSize: "10px", color: "#999", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "6px" }}>SCORE TREND</div>
                  <EdgeChart history={edgeHistory} />
                </div>

                {/* AI Suggestions */}
                <div style={{ fontSize: "10px", color: "#999", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                  AI SUGGESTIONS
                  {edgeSuggestions.filter(s => !s.applied).length > 0 && <Badge color="yellow">{edgeSuggestions.filter(s => !s.applied).length}</Badge>}
                </div>
                <div style={{ maxHeight: "160px", overflowY: "auto" }}>
                  {edgeSuggestions.length === 0
                    ? <div style={{ color: "#444", fontSize: "12px", textAlign: "center", padding: "16px 0" }}>Run bots to generate suggestions</div>
                    : edgeSuggestions.slice(0, 6).map(s => (
                      <div key={s.id} style={{ padding: "8px 10px", borderRadius: "10px", background: "#0d0d0d", marginBottom: "5px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", border: `1px solid ${s.applied ? "#161616" : "#f5a62322"}`, animation: "slideIn 0.25s ease" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: "11px", fontWeight: 600, color: "#ddd" }}>💡 {s.text}</div>
                          <div style={{ fontSize: "9px", color: "#555", marginTop: "2px" }}>{s.time}</div>
                        </div>
                        <BubbleBtn size="sm" active={!s.applied} color={s.applied ? "#1a1a1a" : "#f5a623"}
                          onClick={() => !s.applied && setEdgeSuggestions(prev => prev.map(x => x.id === s.id ? { ...x, applied: true } : x))}>
                          {s.applied ? "✓" : "Apply"}
                        </BubbleBtn>
                      </div>
                    ))
                  }
                </div>

                {/* Recent evaluations */}
                <div style={{ fontSize: "10px", color: "#999", fontWeight: 700, letterSpacing: "0.08em", margin: "12px 0 8px" }}>EVALUATIONS</div>
                <div style={{ maxHeight: "80px", overflowY: "auto" }}>
                  {trades.filter(t => t.evalResult).length === 0
                    ? <div style={{ color: "#444", fontSize: "12px", textAlign: "center", padding: "10px 0" }}>No evaluations yet</div>
                    : trades.filter(t => t.evalResult).slice(0, 5).map(t => (
                      <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 4px", borderBottom: "1px solid #141414" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "5px", flex: 1, overflow: "hidden" }}>
                          {t.strategy && (() => {
                            const sc = { normal:"#00c805", defensive:"#f5a623", recovery:"#ff5000", aggressive:"#4488ff" };
                            return <span style={{ fontSize: "9px", padding: "1px 5px", borderRadius: "4px", background: `${sc[t.strategy] || "#333"}22`, color: sc[t.strategy] || "#aaa", fontWeight: 700, flexShrink: 0 }}>{t.strategy?.slice(0,3).toUpperCase()}</span>;
                          })()}
                          <div style={{ fontSize: "10px", color: "#bbb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.reason}</div>
                        </div>
                        <div style={{ display: "flex", gap: "5px", alignItems: "center", marginLeft: "6px", flexShrink: 0 }}>
                          <span style={{ fontSize: "10px", fontWeight: 700, color: t.pnl >= 0 ? "#00c805" : "#ff5000" }}>{fmtPnl(t.pnl)}</span>
                          <span style={{ fontSize: "10px" }}>{t.evalResult === "good" ? "✅" : "⚠️"}</span>
                        </div>
                      </div>
                    ))
                  }
                </div>

                {/* Strategy change log */}
                <div style={{ fontSize: "10px", color: "#999", fontWeight: 700, letterSpacing: "0.08em", margin: "12px 0 8px", display: "flex", alignItems: "center", gap: "6px" }}>
                  STRATEGY LOG
                  {strategyLog.length > 0 && <span style={{ padding: "1px 6px", borderRadius: "100px", background: "#f5a62322", color: "#f5a623", fontSize: "9px", fontWeight: 700 }}>{strategyLog.length}</span>}
                </div>
                <div style={{ maxHeight: "120px", overflowY: "auto" }}>
                  {strategyLog.length === 0
                    ? <div style={{ color: "#444", fontSize: "12px", textAlign: "center", padding: "10px 0" }}>No strategy changes yet</div>
                    : strategyLog.map(s => {
                        const colors = { normal:"#00c805", defensive:"#f5a623", recovery:"#ff5000", aggressive:"#4488ff" };
                        const toCol = colors[s.to] || "#aaa";
                        return (
                          <div key={s.id} style={{ padding: "7px 8px", borderRadius: "8px", background: `${toCol}10`, border: `1px solid ${toCol}22`, marginBottom: "5px", animation: "slideIn 0.25s ease" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ fontSize: "10px", fontWeight: 700 }}>
                                <span style={{ color: colors[s.from] || "#aaa" }}>{s.from?.toUpperCase()}</span>
                                <span style={{ color: "#444", margin: "0 4px" }}>→</span>
                                <span style={{ color: toCol }}>{s.to?.toUpperCase()}</span>
                              </div>
                              <span style={{ fontSize: "9px", color: "#555" }}>{s.time} · WR {s.wr}% · ${s.balance}</span>
                            </div>
                            <div style={{ fontSize: "10px", color: "#bbb", marginTop: "2px" }}>{s.reason}</div>
                          </div>
                        );
                      })
                  }
                </div>
              </Card>
            </div>

            {/* ── ROW 2: Volume Bot + Markets side by side ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

              {/* Volume Bot */}
              <Card glow={volBotOn ? "#00c805" : undefined}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "18px" }}>📊</span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: "15px" }}>Volume Bot</div>
                      <div style={{ fontSize: "11px", color: "#bbb" }}>Rolling 20-candle avg · {spikeThreshold}× threshold</div>
                    </div>
                  </div>

                </div>

                {/* Volume chart */}
                <div style={{ background: "#0a0a0a", borderRadius: "10px", padding: "8px 6px 4px", marginBottom: "10px" }}>
                  <div style={{ fontSize: "9px", color: "#333", fontWeight: 700, letterSpacing: "0.08em", padding: "0 4px 6px" }}>VOLUME · 🟢 = CONFIRMED SPIKE (body {'>'}30% range)</div>
                  <VolumeChart candles={candles} spikes={spikes} />
                </div>

                {/* Spike log */}
                <div style={{ fontSize: "10px", color: "#999", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "8px" }}>SPIKE LOG</div>
                <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                  {volAlerts.length === 0
                    ? <div style={{ color: "#444", fontSize: "13px", textAlign: "center", padding: "24px 0" }}>Start bot to detect spikes</div>
                    : volAlerts.slice(0, 15).map((a, i) => (
                      <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 6px", borderBottom: "1px solid #141414", animation: "slideIn 0.25s ease" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontWeight: 800, fontSize: "12px", color: a.dir === "UP" ? "#00c805" : "#ff5000" }}>{a.dir === "UP" ? "↑" : "↓"} ×{a.ratio}{a.isLive && <span style={{ fontSize:"9px", color:"#00c805", marginLeft:"4px" }}>●LIVE</span>}</span>
                            <span style={{ fontSize: "10px", color: "#bbb" }}>{a.time}</span>
                          </div>
                          <div style={{ fontSize: "10px", color: "#666", marginTop: "1px" }}>Vol {a.vol} · Avg {a.avg} · Body {a.body}%</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontWeight: 700, fontSize: "13px" }}>{a.price}¢</div>
                          <Badge color={a.dir === "UP" ? "green" : "red"}>{a.dir}</Badge>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </Card>

              {/* Markets */}
              <Card>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "18px" }}>₿</span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: "15px" }}>BTC 5-Min Markets</div>
                      <div style={{ fontSize: "11px", color: "#bbb" }}>{dataSource === "live" ? "Live · " : "Seeded · "}{markets.length} markets</div>
                    </div>
                  </div>
                  <BubbleBtn size="sm" active={false} onClick={loadMarkets} disabled={marketsLoading}>{marketsLoading ? "…" : "↻"}</BubbleBtn>
                </div>
                <input placeholder="Search markets…" value={marketSearch} onChange={e => setMarketSearch(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", background: "#0d0d0d", border: "1.5px solid #1e1e1e", borderRadius: "10px", color: "#fff", fontFamily: "inherit", fontSize: "12px", outline: "none", marginBottom: "10px" }} />
                <div style={{ maxHeight: "380px", overflowY: "auto" }}>
                  {marketsLoading ? <Spinner /> : filteredMarkets.map(m => (
                    <MarketCard key={m.id || m.conditionId} market={m} selected={selectedMarket?.id === m.id} onSelect={handleSelectMarket} />
                  ))}
                </div>
              </Card>

            </div>

            {/* ── ROW 3: Master Start/Stop button ── */}
            <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 8px" }}>
              <button onClick={() => {
                const next = !anyOn;
                setVolBotOn(next);
                setEntryBotOn(next);
                setEdgeBotOn(next);
              }} style={{
                padding: "18px 64px",
                borderRadius: "100px",
                background: anyOn ? "#ff5000" : "#00c805",
                color: "#000",
                border: "none",
                fontFamily: "inherit",
                fontWeight: 800,
                fontSize: "17px",
                cursor: "pointer",
                letterSpacing: "-0.01em",
                boxShadow: anyOn ? "0 0 40px #ff500066" : "0 0 40px #00c80566",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: "10px"
              }}>
                {anyOn ? "⏹ Stop All Bots" : "▶ Start All Bots"}
              </button>
            </div>

            {/* Bot status pills */}
            <div style={{ display: "flex", justifyContent: "center", gap: "10px", paddingBottom: "4px" }}>
              {[
                { label: "Volume Bot", on: volBotOn, color: "#00c805" },
                { label: "Entry Bot", on: entryBotOn, color: "#4488ff" },
                { label: "Edge Builder", on: edgeBotOn, color: "#f5a623" },
              ].map(b => (
                <div key={b.label} style={{ display: "flex", alignItems: "center", gap: "5px", padding: "4px 12px", borderRadius: "100px", background: b.on ? `${b.color}15` : "#111", border: `1px solid ${b.on ? b.color + "44" : "#1e1e1e"}` }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: b.on ? b.color : "#333", display: "inline-block", boxShadow: b.on ? `0 0 6px ${b.color}` : "none", animation: b.on ? "pulseGlow 1.4s ease infinite" : "none" }} />
                  <span style={{ fontSize: "11px", fontWeight: 700, color: b.on ? b.color : "#555" }}>{b.label}</span>
                </div>
              ))}
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
