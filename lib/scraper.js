// lib/scraper.js
//
// Shared logic used by both /api/rates.js and /api/latest-iqd-rate.js.
// Same scraping approach as the original Express version — this file
// just has no framework dependency, since Vercel functions don't need one.
 
// Add or remove channels here — the only thing you touch to change sources.
const CHANNELS = [
  { id: 'dollariraqi', label: 'بورصة الكفاح والحارثية (@dollariraqi)', url: 'https://t.me/s/dollariraqi' },
  { id: 'dollar_price', label: 'سعر الدولار اليوم (@dollar_price)', url: 'https://t.me/s/dollar_price' }
];
 
// The Central Bank peg barely moves (it's policy-set, not market-set), so
// a constant is fine — just double check it every so often.
const OFFICIAL_RATE_IQD = 1310;
 
const CACHE_MS = 5 * 60 * 1000; // re-scrape each channel at most every 5 min
const BAGHDAD_REGEX = /بغداد[\s\S]{0,30}?([\d]{2,3}[.,]\d{3})/;
 
// NOTE on Vercel: this cache lives in memory for as long as a given
// function instance stays "warm". Vercel may spin up a fresh, empty-cache
// instance between requests if traffic is light — that's fine, it just
// means occasional requests take slightly longer while it re-scrapes,
// never a broken response.
const cache = {}; // { [channelId]: { data, fetchedAt } }
 
// Pulls the plain text out of each Telegram message bubble without an
// HTML-parsing library. Telegram's public preview wraps each message's
// text in <div class="tgme_widget_message_text ...">...</div> with no
// nested divs inside (just inline tags like <br>, <a>, <b>, <i>), so
// grabbing everything up to the next </div> is safe here.
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
 
module.exports = { CHANNELS, OFFICIAL_RATE_IQD, getChannelRate };
