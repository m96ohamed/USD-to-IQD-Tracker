// app/js/fx-sync.js
//
// Drop-in replacement for whatever currently calls the Central Bank API.
// Replace YOUR_BACKEND_URL below once you deploy server.js somewhere
// (see README.md for a free hosting option).

const RATE_API_URL = 'https://YOUR_BACKEND_URL/api/latest-iqd-rate';
const OFFICIAL_FALLBACK_RATE = 1310; // only used if everything else fails

async function syncLocalMarketRate() {
  // 1. If the user has set a manual rate in Settings, prefer that —
  //    parallel rates move fast and a manual override never breaks.
  const manualRate = localStorage.getItem('manual_iqd_rate');
  if (manualRate) {
    console.log(`Using manual rate: 1 USD = ${manualRate} IQD`);
    return Number(manualRate);
  }

  // 2. Otherwise, try to fetch the live scraped market rate.
  try {
    const res = await fetch(RATE_API_URL);
    const data = await res.json();

    if (data.success) {
      localStorage.setItem('usd_to_iqd_rate', data.ratePerUsd);
      localStorage.setItem('usd_to_iqd_rate_updated_at', data.fetchedAt);
      if (data.stale) {
        console.warn('Live scrape failed, using last known good rate:', data.warning);
      }
      console.log(`Rate synced: 1 USD = ${data.ratePerUsd} IQD`);
      return data.ratePerUsd;
    }
  } catch (err) {
    console.error('Could not reach rate backend:', err);
  }

  // 3. Last resort: whatever we last saved, or the official rate.
  const lastKnown = localStorage.getItem('usd_to_iqd_rate');
  return lastKnown ? Number(lastKnown) : OFFICIAL_FALLBACK_RATE;
}

// Run on app startup. You can also call this on a timer (e.g. every
// 15-30 minutes while the app is open) or on pull-to-refresh.
syncLocalMarketRate();
