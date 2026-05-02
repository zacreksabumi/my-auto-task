const axios = require("axios");
const fs = require("fs");

const FILE_JSON = "data.json";
const COINS_FILE = "ajaibCoins.json";

// Telegram config
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Kurs Rupiah
const USD_TO_IDR = 15000;

// CONFIG
const MAX_PRICE_IDR = 30000;
const RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const DIFF_PERCENT_MIN = -20;
const DIFF_PERCENT_MAX = 0.1;

// Load koin dari file JSON
let ajaibCoins = [];
if (fs.existsSync(COINS_FILE)) {
  ajaibCoins = JSON.parse(fs.readFileSync(COINS_FILE));
} else {
  console.error("❌ File ajaibCoins.json tidak ditemukan!");
  process.exit(1);
}

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

// Fetch retry
async function fetchWithRetry(url, params, retries = RETRIES) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.get(url, { params, timeout: 10000 });
    } catch (err) {
      if (err.response?.status === 429) {
        console.warn(`⚠️ Rate limit, retry ${i + 1}/${retries}`);
        await sleep(RETRY_DELAY_MS);
      } else {
        throw err;
      }
    }
  }
  throw new Error("Gagal fetch setelah retry");
}

// Main
async function getCrypto() {
  try {
    let oldData = {};
    if (fs.existsSync(FILE_JSON)) {
      oldData = JSON.parse(fs.readFileSync(FILE_JSON));
    }

    let newData = {};
    let candidates = [];

    const ids = ajaibCoins.map(c => c.coingeckoId).join(',');

    const res = await fetchWithRetry(
      "https://api.coingecko.com/api/v3/coins/markets",
      {
        vs_currency: "usd",
        ids,
        per_page: ajaibCoins.length
      }
    );

    res.data.forEach(c => {
      const symbol = c.symbol.toUpperCase();
      const priceUSD = c.current_price;
      const priceIDR = priceUSD * USD_TO_IDR;

      if (priceIDR >= MAX_PRICE_IDR) return;

      const lowPrice = c.low_24h;
      const diffPercent = lowPrice > 0
        ? ((priceUSD - lowPrice) / lowPrice * 100).toFixed(2)
        : 0;

      if (
        (diffPercent >= DIFF_PERCENT_MIN && diffPercent <= DIFF_PERCENT_MAX) ||
        priceUSD <= lowPrice
      ) {
        candidates.push({
          symbol,
          price: priceIDR,
          lowPrice: lowPrice * USD_TO_IDR,
          diffPercent,
          belowLow: priceUSD <= lowPrice
        });
      }

      let history = oldData[symbol] || [];
      if (!Array.isArray(history)) history = [history];

      newData[symbol] = [...history, priceUSD].slice(-2);
    });

    if (candidates.length > 0) {
      const unique = [];
      const seen = new Set();

      candidates.forEach(c => {
        if (!seen.has(c.symbol)) {
          seen.add(c.symbol);
          unique.push(c);
        }
      });

      let msg = "*AKUN ZAC | 🔎 NEAR LOW*\n DATA DARI COINFGECKO\n\n";

      unique.forEach(c => {
        msg += `*${c.symbol}* | Price: Rp${c.price.toLocaleString("id-ID")} | Low: Rp${c.lowPrice.toLocaleString("id-ID")} | Δ: ${c.diffPercent}%`;
        if (c.belowLow) msg += " 💥 Below Low!";
        msg += "\n";
      });

      await sendTelegram(msg);
    } else {
      console.log("Tidak ada koin mendekati low.");
    }

    fs.writeFileSync(FILE_JSON, JSON.stringify(newData, null, 2));

  } catch (err) {
    console.error("Error:", err.message);
  }
}

getCrypto();
