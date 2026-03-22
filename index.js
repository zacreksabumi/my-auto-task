const axios = require("axios");
const fs = require("fs");

const FILE_JSON = "data.json";

// Telegram config
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Kurs Rupiah
const USD_TO_IDR = 15000;

// CONFIG
const COINS_PER_PAGE = 100;      // 100 koin per request
const MAX_PAGES = 3;             // scan 3 page → 300 koin kecil
const MAX_PRICE_IDR = 30000;     // harga maksimal koin
const PAGE_DELAY_MS = 10000;     // delay 10 detik antar page
const RETRIES = 3;               // retry saat 429
const RETRY_DELAY_MS = 5000;     // delay 5 detik antar retry
const DIFF_PERCENT_MIN = 0.9;
const DIFF_PERCENT_MAX = 1.1;

// Telegram function
async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: "Markdown"
    });
    console.log("✅ Pesan Telegram terkirim");
  } catch (err) {
    console.error("❌ Error Telegram:", err.response?.data || err.message);
  }
}

// Delay helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch dengan retry saat kena 429
async function fetchWithRetry(url, params, retries = RETRIES, delayMs = RETRY_DELAY_MS) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await axios.get(url, { params, timeout: 10000 });
      return res;
    } catch (err) {
      if (err.response?.status === 429) {
        console.warn(`⚠️ Rate limit hit, retry ${i + 1}/${retries}...`);
        await sleep(delayMs);
      } else {
        throw err;
      }
    }
  }
  throw new Error("Failed after retries due to rate limit");
}

// Main function
async function getCrypto() {
  try {
    let oldData = {};
    if (fs.existsSync(FILE_JSON)) oldData = JSON.parse(fs.readFileSync(FILE_JSON));

    let newData = {};
    let candidates = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      console.log(`Scanning page ${page}...`);
      const res = await fetchWithRetry("https://api.coingecko.com/api/v3/coins/markets", {
        vs_currency: "usd",
        order: "market_cap_asc",
        per_page: COINS_PER_PAGE,
        page,
      });

      res.data.forEach(c => {
        const symbol = c.symbol.toUpperCase();
        const priceUSD = c.current_price;
        const priceIDR = priceUSD * USD_TO_IDR;

        if (priceIDR >= MAX_PRICE_IDR) return;

        const lowPrice = c.low_24h;
        const diffPercent = lowPrice > 0 ? ((priceUSD - lowPrice)/lowPrice*100).toFixed(2) : 0;

        // Near low ±1%
        if ((diffPercent >= DIFF_PERCENT_MIN && diffPercent <= DIFF_PERCENT_MAX) || priceUSD <= lowPrice) {
          candidates.push({ 
            symbol, 
            price: priceIDR, 
            lowPrice: lowPrice*USD_TO_IDR, 
            diffPercent,
            belowLow: priceUSD <= lowPrice
          });
        }

        // Update historis harga 2 terakhir
        let history = oldData[symbol] || [];
        if (!Array.isArray(history)) history = [history];
        newData[symbol] = [...history, priceUSD].slice(-2);
      });

      await sleep(PAGE_DELAY_MS);
    }

    // Hapus duplikasi sebelum kirim Telegram
    if (candidates.length > 0) {
      const uniqueCandidates = [];
      const seen = new Set();
      candidates.forEach(c => {
        if (!seen.has(c.symbol)) {
          seen.add(c.symbol);
          uniqueCandidates.push(c);
        }
      });

      let msg = "*🔎 COIN NEAR LOW ALERT*\n\n";
      uniqueCandidates.forEach(c => {
        msg += `*${c.symbol}* | Price: Rp${c.price.toLocaleString("id-ID")} | Low: Rp${c.lowPrice.toLocaleString("id-ID")} | Δ: ${c.diffPercent}%`;
        if (c.belowLow) msg += " 💥 Price below 24h low!";
        msg += "\n";
      });
      await sendTelegram(msg);
    } else {
      console.log("Tidak ada koin kecil yang mendekati low atau di bawah low 24h saat ini.");
    }

    fs.writeFileSync(FILE_JSON, JSON.stringify(newData, null, 2));

  } catch(err) {
    console.error("Error:", err.message);
  }
}

getCrypto();
