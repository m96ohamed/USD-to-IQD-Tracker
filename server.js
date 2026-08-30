// server.js
//
// What this does:
// Iraq's official Central Bank rate (~1,310 IQD/$1) is not what people
// actually pay in exchange shops. The real "street" rate is posted several
// times a day on public Telegram channels that most Iraqi rate-tracking
// sites/apps read from.
//
// This server reads TWO such channels' PUBLIC web previews
// (t.me/s/<channel>, no login needed, same page Google can index), pulls
// the newest Baghdad rate out of each one separately, and serves them
// side by side as JSON — plus the official rate — so your site/app can
// show "A / B / C" like you wanted.
//
// Verified against both channels' live content on 2026-08-29. Message
// formats differ slightly between channels (number on the same line,
// number on the next line, with or without a dash) — the regex below
// was tested against real examples of each and handles all of them.
// "بغداد" = Baghdad. We grab the number that follows it.

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors()); // lets your site/app call this from a browser

// Add or remove channels here — that's the only thing you touch to
// change your sources. Any public Telegram channel that posts a
// "بغداد: 123,456" style line will work.
const CHANNELS = [
  { id: 'dollariraqi', label: 'بورصة الكفاح والحارثية (@dollariraqi)', url: 'https://t.me/s/dollariraqi' },
  { id: 'dollar_price', label: 'سعر الدولار اليوم (@dollar_price)', url: 'https://t.me/s/dollar_price' }
];

// The Central Bank peg barely moves (it's policy-set, not market-set), so
// a constant is fine — just double check it every so often. If your app
// already has a working live source for this, use that instead and
// ignore this constant entirely.
const OFFICIAL_RATE_IQD = 1310;

const CACHE_MS = 5 * 60 * 1000; // re-scrape each channel at most every 5 min
const BAGHDAD_REGEX = /بغداد[\s\S]{0,30}?([\d]{2,3}[.,]\d{3})/;

const cache = {}; // { [channelId]: { data, fetchedAt } }

// Pulls the plain text out of each Telegram message bubble, without
// needing an HTML-parsing library. Telegram's public preview wraps each
// message's text in <div class="tgme_widget_message_text ...">...</div>
// with no nested divs inside (just inline tags like <br>, <a>, <b>, <i>),
// so grabbing everything up to the next </div> is safe here.
function extractMessages(html) {
  const blocks = [...html.matchAll(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g)];
  return blocks.map(m =>
    m[1]
      .replace(/<br\s*\/?>/gi, '\n')   // line breaks matter for the "number on next line" case
      .replace(/<[^>]+>/g, '')          // strip remaining tags (links, bold, emoji spans)
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  );
}

async function scrapeChannel(channel) {
  const response = await fetch(channel.url, {
    headers: { 'User-Agent': 'Mozilla/5.0' } // some hosts block requests with no UA
  });
  if (!response.ok) throw new Error(`Telegram page returned HTTP ${response.status}`);
  const html = await response.text();

  const messages = extractMessages(html);

  // Posts run oldest -> newest, so scan backwards to find the most recent
  // post that actually contains a Baghdad rate (some posts are about
  // other cities, remittance fees, ads, or are photos with no rate text).
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messages[i];
    const match = text.match(BAGHDAD_REGEX);
    if (match) {
      const per100 = parseInt(match[1].replace(/[.,]/g, ''), 10); // IQD per $100
      return {
        id: channel.id,
        label: channel.label,
        ratePer100Usd: per100,
        ratePerUsd: +(per100 / 100).toFixed(2), // IQD per $1
        sourceSnippet: text.trim().slice(0, 120),
        fetchedAt: new Date().toISOString()
      };
    }
  }
  throw new Error(`No Baghdad rate found in recent posts from ${channel.id}`);
}

async function getChannelRate(channel) {
  const entry = cache[channel.id] || { data: null, fetchedAt: 0 };
  const isStale = Date.now() - entry.fetchedAt > CACHE_MS;

  if (!isStale) return { ...entry.data, success: true, stale: false };

  try {
    const data = await scrapeChannel(channel);
    cache[channel.id] = { data, fetchedAt: Date.now() };
    return { ...data, success: true, stale: false };
  } catch (err) {
    // Scrape failed for this one channel — fall back to its last good
    // value if we have one, rather than dropping it from the response.
    if (entry.data) return { ...entry.data, success: true, stale: true, warning: err.message };
    return { id: channel.id, label: channel.label, success: false, error: err.message };
  }
}

// Combined endpoint: every channel's latest rate + the official rate,
// side by side — exactly the A / B / C list for your site.
app.get('/api/rates', async (req, res) => {
  const marketRates = await Promise.all(CHANNELS.map(getChannelRate));

  const goodRates = marketRates.filter(r => r.success).map(r => r.ratePerUsd);
  const averageMarketRate = goodRates.length
    ? +(goodRates.reduce((a, b) => a + b, 0) / goodRates.length).toFixed(2)
    : null;

  res.json({
    success: true,
    fetchedAt: new Date().toISOString(),
    officialRate: { label: 'البنك المركزي العراقي (Central Bank)', ratePerUsd: OFFICIAL_RATE_IQD },
    marketRates,          // [{ id, label, ratePerUsd, ratePer100Usd, ... }, ...]
    averageMarketRate     // handy single number if your budgeting math wants one
  });
});

// Kept for backwards compatibility with the single-rate version — returns
// just the first channel that's currently working.
app.get('/api/latest-iqd-rate', async (req, res) => {
  for (const channel of CHANNELS) {
    const result = await getChannelRate(channel);
    if (result.success) return res.json({ success: true, ...result });
  }
  res.status(502).json({ success: false, error: 'All channels failed' });
});

app.get('/', (req, res) => res.send('IQD rate API is running. Try /api/rates'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rate API running on port ${PORT}`));
