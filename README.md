# ⚡ frostAIPolyBot

Automated BTC 5-minute prediction market trading bot for [Polymarket](https://polymarket.com).

## What it does
- Watches BTC 5-min candles for volume spikes using a rolling 20-candle average
- Enters YES (UP) or NO (DOWN) positions on BTC 5-min candle markets via Polymarket CLOB
- Closes positions immediately on profit (Fill-Or-Kill orders)
- Adaptive strategy engine: automatically switches between Normal / Defensive / Recovery / Aggressive modes based on win rate and drawdown
- Kelly-style bet sizing that scales with edge score and win rate
- Live WebSocket price feed from Polymarket

---

## Deploy to Netlify via GitHub

### 1. Install dependencies locally (optional, just to test)
```bash
npm install
npm run dev        # runs at http://localhost:3000
npm run build      # builds to /dist
```

### 2. Push to GitHub
```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/frostaipolybot.git
git push -u origin main
```

### 3. Connect to Netlify
1. Go to [netlify.com](https://netlify.com) → **Add new site** → **Import an existing project**
2. Choose **GitHub** and authorize Netlify
3. Select your `frostaipolybot` repo
4. Build settings are auto-detected from `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `dist`
5. Click **Deploy site** — live in ~60 seconds

### 4. Connect your Polymarket wallet
Once deployed, go to **Settings** in the app and enter:
- **Wallet type** — Email/Magic, MetaMask, or EOA
- **Private Key** — your wallet's private key (stored in memory only)
- **Funder Address** — your Polymarket proxy wallet address
- **API Key / Secret / Passphrase** — from polymarket.com → Settings → API

> ⚠️ Start in **📄 Paper** mode to verify performance before switching to **🔴 Live**.

---

## Live order execution note

Full EIP-712 order signing requires `ethers.js`. To enable it, install and import:

```bash
npm install ethers
```

Then in `src/App.jsx`, add at the top:
```js
import { Wallet } from 'ethers';
```

And update the `placeOrder` function's live execution path to sign using:
```js
const wallet = new Wallet(privateKey);
const signature = await wallet._signTypedData(domain, types, orderPayload);
```

The order payload structure is already built to the Polymarket CLOB spec.

---

## Tech stack
- React 18 + Vite 5
- Zero UI dependencies (pure inline styles)
- Polymarket Gamma API — market discovery
- Polymarket CLOB API — order placement
- Polymarket Data API — positions & balance
- WebSocket `wss://ws-subscriptions-clob.polymarket.com` — live prices

---

## ⚠️ Risk Warning
This is experimental software. Prediction market trading carries significant risk of loss.
Never trade more than you can afford to lose. Start with paper trading.
