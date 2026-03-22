const axios = require("axios");
const fs = require("fs");

const FILE_JSON = "data.json";

// Telegram config dari GitHub Secrets
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Kurs Rupiah
const USD_TO_IDR = 15000;

// CONFIG
const COINS_PER_PAGE = 100;   // 100 koin per request
const MAX_PAGES = 5;          // total 500 koin
const MAX_PRICE_IDR = 30000;  // maksimal harga koin yang ditampilkan
const PARALLEL_PAGES = 2;     // request paralel 2 page sekaligus

// FUNCTION TELEGRAM
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

// MAIN FUNCTION
async function getCrypto() {
  try {
    let oldData = {};
    if (fs.existsSync(FILE_JSON)) oldData = JSON.parse(fs.readFileSync(FILE_JSON));

    let newData = {};
    let candidates = [];

    const pages = Array.from({length: MAX_PAGES}, (_, i) => i + 1);

    // loop per batch parallel
    for (let i = 0; i < pages.length; i += PARALLEL_PAGES) {
      const batch = pages.slice(i, i + PARALLEL_PAGES);
      const requests = batch.map(page =>
        axios.get("https://api.coingecko.com/api/v3/coins/markets", {
          params: {
            vs_currency: "usd",
            order: "market_cap_asc", // koin kecil dulu
            per_page: COINS_PER_PAGE,
            page,
          },
          timeout: 10000
        })
      );

      const results = await Promise.all(requests);

      results.forEach(res => {
        res.data.forEach(c => {
          const symbol = c.symbol.toUpperCase();
          const priceUSD = c.current_price;
          const priceIDR = priceUSD * USD_TO_IDR;

          if (priceIDR >= MAX_PRICE_IDR) return; // filter harga maksimal

          const lowPrice = c.low_24h;
          const diffPercent = lowPrice > 0 ? ((priceUSD - lowPrice)/lowPrice*100).toFixed(2) : 0;

          if (diffPercent >= 0.9 && diffPercent <= 1.1) {
            candidates.push({ symbol, price: priceIDR, lowPrice: lowPrice*USD_TO_IDR, diffPercent });
          }

          // Update historis harga (2 terakhir)
          let history = oldData[symbol] || [];
          if (!Array.isArray(history)) history = [history];
          newData[symbol] = [...history, priceUSD].slice(-2);
        });
      });

      // Delay kecil antar batch supaya aman rate limit
      await new Promise(r => setTimeout(r, 500));
    }

    // Kirim Telegram jika ada kandidat
    if (candidates.length > 0) {
      let msg = "*🔎 COIN NEAR LOW ALERT*\n\n";
      candidates.forEach(c => {
        msg += `*${c.symbol}* | Price: Rp${c.price.toLocaleString("id-ID")} | Low: Rp${c.lowPrice.toLocaleString("id-ID")} | Δ: ${c.diffPercent}%\n`;
      });
      await sendTelegram(msg);
    } else {
      console.log("Tidak ada koin kecil yang mendekati low 1% saat ini.");
    }

    // Simpan JSON
    fs.writeFileSync(FILE_JSON, JSON.stringify(newData, null, 2));

  } catch(err) {
    console.error("Error:", err.message);
  }
}

getCrypto();
