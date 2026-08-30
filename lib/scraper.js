// lib/scraper.js
//
// Shared logic used by both /api/rates.js and /api/latest-iqd-rate.js.
//
// CHANGED: this now extracts a rate PER CITY from each post, instead of only
// matching بغداد. Cities the channels don't post about simply come back
// absent — never guessed, and never filled in with another city's number.

// Add or remove channels here — the only thing you touch to change sources.
const CHANNELS = [
  { id: 'dollariraqi', label: 'بورصة الكفاح والحارثية (@dollariraqi)', url: 'https://t.me/s/dollariraqi' },
  { id: 'dollar_price', label: 'سعر الدولار اليوم (@dollar_price)', url: 'https://t.me/s/dollar_price' }
];

// The Central Bank peg barely moves (it's policy-set, not market-set), so
// a constant is fine — just double check it every so often.
const OFFICIAL_RATE_IQD = 1310;

const CACHE_MS = 5 * 60 * 1000; // re-scrape each channel at most every 5 min

// ---------------------------------------------------------------------
// Cities
// ---------------------------------------------------------------------
// `id` is what the app matches on, so keep these stable.
//
// `aliases` covers the spelling variants these channels actually use:
// with/without the ال- prefix, أ/ا at the start (very common in casual
// posts), and the Kurdish-Arabic forms for the northern cities. Aliases are
// matched against text that has already been normalised by normalizeArabic()
// below, so diacritics and letter variants don't need separate entries.
const CITIES = [
  { id: 'baghdad',      label: 'بغداد',      aliases: ['بغداد'] },
  { id: 'erbil',        label: 'أربيل',      aliases: ['اربيل', 'هولير', 'اربل'] },
  { id: 'sulaymaniyah', label: 'السليمانية', aliases: ['السليمانيه', 'سليمانيه', 'سليماني'] },
  { id: 'duhok',        label: 'دهوك',       aliases: ['دهوك', 'دهك'] },
  { id: 'mosul',        label: 'الموصل',     aliases: ['الموصل', 'موصل', 'نينوى'] },
  { id: 'basra',        label: 'البصرة',     aliases: ['البصره', 'بصره'] },
  { id: 'kirkuk',       label: 'كركوك',      aliases: ['كركوك'] },
  { id: 'najaf',        label: 'النجف',      aliases: ['النجف', 'نجف'] },
  { id: 'karbala',      label: 'كربلاء',     aliases: ['كربلاء', 'كربلا'] },
  { id: 'anbar',        label: 'الأنبار',    aliases: ['الانبار', 'انبار', 'الرمادي', 'رمادي'] },
  { id: 'diyala',       label: 'ديالى',      aliases: ['ديالى', 'بعقوبة', 'بعقوبه'] },
  { id: 'babil',        label: 'بابل',       aliases: ['بابل', 'الحلة', 'الحله'] }
];

/**
 * Normalises Arabic text so alias matching doesn't need to account for every
 * spelling: strips diacritics/tatweel, unifies أإآ→ا, ى→ي, ة→ه, and converts
 * Arabic-Indic digits (٠-٩ and ۰-۹) to ASCII so the number regex works on
 * posts that use them.
 */
function normalizeArabic(text) {
  return text
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '') // diacritics
    .replace(/\u0640/g, '')                                          // tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

// A price like 154.100 / 154,100 (IQD per $100) or 1541 / 1,541 (per $1).
const RATE_NUMBER = /(\d{2,3}[.,]\d{3}|\d{4,6})/;

/**
 * Converts a matched number to IQD-per-USD.
 *
 * Channels quote per $100 ("154.100") far more often than per $1, so the
 * result is sanity-checked against a plausible band and rescaled if needed.
 * Anything still outside the band is rejected rather than published — a bad
 * number is worse than a missing one.
 */
function toRatePerUsd(raw) {
  const digits = parseInt(String(raw).replace(/[.,]/g, ''), 10);
  if (!Number.isFinite(digits)) return null;

  const candidates = [digits / 100, digits, digits / 1000];
  for (const value of candidates) {
    // parallel-market USD/IQD has sat roughly between 1,100 and 2,500
    if (value >= 1000 && value <= 3000) return +value.toFixed(2);
  }
  return null;
}

/**
 * Pulls every city rate out of one message.
 *
 * Scans for city names, then looks for a number in the text BETWEEN that city
 * and the next city mention (capped at 60 chars). Bounding at the next city
 * is what stops "أربيل ... بغداد 154.100" from wrongly assigning Baghdad's
 * number to Erbil.
 */
function extractCityRates(rawText) {
  const text = normalizeArabic(rawText);
  const hits = [];

  CITIES.forEach(city => {
    city.aliases.forEach(alias => {
      const needle = normalizeArabic(alias);
      let from = 0;
      for (;;) {
        const at = text.indexOf(needle, from);
        if (at === -1) break;
        hits.push({ city: city.id, at, end: at + needle.length });
        from = at + needle.length;
      }
    });
  });

  if (!hits.length) return {};
  hits.sort((a, b) => a.at - b.at);

  const out = {};
  hits.forEach((hit, i) => {
    const next = hits[i + 1];
    const limit = Math.min(next ? next.at : text.length, hit.end + 60);
    const window = text.slice(hit.end, limit);
    const match = window.match(RATE_NUMBER);
    if (!match) return;
    const rate = toRatePerUsd(match[1]);
    // first mention of a city in a post wins — later ones are usually
    // yesterday's comparison or a buy/sell second figure
    if (rate && out[hit.city] === undefined) out[hit.city] = rate;
  });

  return out;
}

// ---------------------------------------------------------------------
// Scraping
// ---------------------------------------------------------------------
// NOTE on Vercel: this cache lives in memory for as long as a given
// function instance stays "warm". Vercel may spin up a fresh, empty-cache
// instance between requests if traffic is light — that's fine, it just
// means occasional requests take slightly longer while it re-scrapes,
// never a broken response.
const cache = {}; // { [channelId]: { data, fetchedAt } }

// Pulls the plain text out of each Telegram message bubble without an
// HTML-parsing library.
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

  // Posts run oldest -> newest. Scan backwards and merge: the newest post
  // usually covers Baghdad only, while a slightly older one may list the
  // other cities, so taking just the first match would lose them. Each city
  // keeps its NEWEST value, and we stop early once every city is filled.
  const rates = {};
  const seenAt = {};
  let sourceSnippet = null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messages[i];
    const found = extractCityRates(text);
    const keys = Object.keys(found);
    if (!keys.length) continue;

    keys.forEach(city => {
      if (rates[city] === undefined) {
        rates[city] = found[city];
        seenAt[city] = i;
      }
    });
    if (!sourceSnippet) sourceSnippet = text.trim().slice(0, 120);
    if (Object.keys(rates).length === CITIES.length) break;
  }

  if (!Object.keys(rates).length) {
    throw new Error(`No city rate found in recent posts from ${channel.id}`);
  }

  return {
    id: channel.id,
    label: channel.label,
    // Baghdad stays the headline figure for backwards compatibility with any
    // existing consumer of ratePerUsd / ratePer100Usd.
    ratePerUsd: rates.baghdad !== undefined ? rates.baghdad : null,
    ratePer100Usd: rates.baghdad !== undefined ? Math.round(rates.baghdad * 100) : null,
    cityRates: rates,                       // { baghdad: 1541, erbil: 1545, ... }
    cities: Object.keys(rates),
    sourceSnippet,
    fetchedAt: new Date().toISOString()
  };
}

async function getChannelRate(channel) {
  const entry = cache[channel.id] || { data: null, fetchedAt: 0 };
  const isStale = Date.now() - entry.fetchedAt > CACHE_MS;

  if (!isStale && entry.data) return { ...entry.data, success: true, stale: false };

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

module.exports = {
  CHANNELS,
  CITIES,
  OFFICIAL_RATE_IQD,
  getChannelRate,
  // exported for testing
  extractCityRates,
  normalizeArabic,
  toRatePerUsd
};
