// lib/scraper.js
//
// Shared logic used by both /api/rates.js and /api/latest-iqd-rate.js.
//
// CHANGED: this now extracts a rate PER CITY from each post, instead of only
// matching بغداد. Cities the channels don't post about simply come back
// absent — never guessed, and never filled in with another city's number.

// Add or remove channels here — the only thing you touch to change sources.
//
// `type` selects the parser:
//   'telegram' (default) — public t.me/s/ channel preview, multi-city
//   'exchange'           — an exchange company's own rate board (HTML), single city
//   'json'               — a JSON endpoint, for sites that render rates with
//                          JavaScript (their HTML contains no numbers, so the
//                          'exchange' parser would find nothing)
//   'facebook'           — a Facebook Page's posts via the Graph API. NOT
//                          scraping facebook.com (that's blocked and against
//                          their ToS) — this needs a Page access token, so it
//                          only works for a Page you own or have been granted
//                          access to. See README.
const CHANNELS = [
  { id: 'dollariraqi', label: 'بورصة الكفاح والحارثية (@dollariraqi)', url: 'https://t.me/s/dollariraqi' },
  { id: 'dollar_price', label: 'سعر الدولار اليوم (@dollar_price)', url: 'https://t.me/s/dollar_price' },
  {
    id: 'azura_gold',
    label: 'ئازورا گۆڵد - هەولێر (@azura_gold)',
    url: 'https://t.me/s/azura_gold',
    // Kurdistan region only — restricting the city pool means a passing
    // mention of بغداد in a post can never be published as a Baghdad rate
    cities: ['erbil', 'sulaymaniyah', 'duhok'],
    // Its usual post gives ONE dollar rate ("نرخی دۆلار ••• 154.000 دینار")
    // with the city only in the signature (زێڕینگری ئازورا ــ هەولێر).
    //
    // That single rate is published for ALL THREE Kurdistan cities, because
    // the channel covers the region rather than just its own shop. This is a
    // deliberate, per-channel exception to the usual rule that a city never
    // borrows another city's number — it is opt-in via `defaultCities` and
    // applies to this source only.
    //
    // If a post ever names cities individually, the city-adjacency extractor
    // handles it and this fallback never fires.
    defaultCities: ['erbil', 'sulaymaniyah', 'duhok']
  },
  {
    id: 'khaki_shaqlawa',
    label: 'خاكي شقلاوة - أربيل (khakishaqlawa.com)',
    url: 'https://khakishaqlawa.com/',
    type: 'exchange',
    // This is an Erbil exchange company, so its board IS the Erbil rate —
    // the Telegram channels only publish Baghdad, so this fills a real gap.
    city: 'erbil',
    // Their board quotes buy/sell per $100. 'mid' is the fairest single number
    // for budgeting; set to 'sell' if you'd rather use what you'd pay to buy
    // dollars, or 'buy' for what you'd get selling them.
    side: 'mid'
  }

  // ------------------------------------------------------------------
  // Tekan Exchange (Erbil) — DISABLED until its data endpoint is known.
  //
  // tekanexchange.net renders its rate cards with JavaScript: the served
  // HTML contains no numbers, so the 'exchange' HTML parser finds nothing.
  // Once you've identified the JSON request the page makes (see README §
  // "Finding a JS-rendered site's endpoint"), fill in `url` and the two
  // path settings below and remove `enabled: false`.
  //
  // , {
  //   id: 'tekan',
  //   label: 'صرافة تيكان - أربيل (tekanexchange.net)',
  //   url: 'https://tekanexchange.net/<THE ENDPOINT YOU FOUND>',
  //   type: 'json',
  //   city: 'erbil',
  //   side: 'mid',
  //   // where to find the USD row inside the JSON. `listPath` is the array,
  //   // `match` identifies the USD entry, and the field names hold the rates.
  //   listPath: 'rates',            // e.g. data.rates = [...]
  //   match: { field: 'code', value: 'USD' },
  //   buyField: 'buy',
  //   sellField: 'sell'
  // }
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
  // Kurdish spellings sit alongside the Arabic ones; normalizeArabic() is
  // applied to aliases as well as to post text, so both forms converge.
  { id: 'erbil',        label: 'أربيل',      aliases: ['اربيل', 'اربل', 'هولير', 'هەولێر', 'ھەولێر'] },
  { id: 'sulaymaniyah', label: 'السليمانية', aliases: ['السليمانيه', 'سليمانيه', 'سليماني', 'سلێمانی', 'سلێمانی', 'سليماني'] },
  { id: 'duhok',        label: 'دهوك',       aliases: ['دهوك', 'دهك', 'دهۆک', 'دھۆک'] },
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
    // Kurdish (Sorani) letters — Kurdistan channels write هەولێر / سلێمانی /
    // دھۆک with characters that don't exist in Arabic. Aliases are normalised
    // through this same function, so both sides land on the same form and the
    // Arabic and Kurdish spellings of a city match each other.
    .replace(/ک/g, 'ك')
    .replace(/[یێ]/g, 'ي')
    .replace(/ۆ/g, 'و')
    .replace(/ە/g, 'ه')
    .replace(/ھ/g, 'ه')
    .replace(/ڵ/g, 'ل')
    .replace(/ڕ/g, 'ر')
    .replace(/پ/g, 'ب')
    .replace(/[ڤﭬ]/g, 'ف')
    .replace(/گ/g, 'ك')
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

// Words that mark a line as being about something OTHER than the USD rate.
// Gold channels post ounce prices and per-karat gold prices in the same
// message, and some of those numbers fall inside a plausible rate range —
// e.g. "زێڕی عەیار 22 به 1.000 ملیۆن" parses to 1000, which would otherwise be
// published as a dollar rate. Anchoring on the label is the only safe way.
const NOT_A_RATE_WORDS = [
  'عەیار', 'عيار', 'ئۆنسە', 'اونصة', 'اونص', 'ounce',
  'زێڕ', 'زير', 'ذهب', 'گرام', 'غرام', 'ملیۆن', 'مليون', 'هەزار'
];
const DOLLAR_WORDS = ['دۆلار', 'دولار', 'dollar', 'usd'];
const RATE_WORDS = ['نرخ', 'سعر', 'rate'];

/**
 * Finds the USD rate on a line identified by its LABEL rather than by an
 * adjacent city name.
 *
 * Needed for channels that post a single regional rate with the city only in
 * the signature — e.g. @azura_gold, whose message reads
 * "💵 نرخی دۆلار ••• 154.000 دینار" with "هەولێر" many lines below, next to a
 * phone number. City-adjacency matching finds nothing there, and grabbing any
 * number would pick up the gold prices.
 */
function extractLabeledRate(rawText) {
  const norm = (v) => normalizeArabic(String(v));
  const excluded = NOT_A_RATE_WORDS.map(norm);
  const dollars = DOLLAR_WORDS.map(norm);
  const rates = RATE_WORDS.map(norm);

  const lines = normalizeArabic(rawText).split('\n');
  const candidates = [];

  lines.forEach(line => {
    if (!dollars.some(w => line.includes(w))) return;      // must mention dollars
    if (excluded.some(w => line.includes(w))) return;      // ...but not gold/ounce
    const nums = (line.match(/\d[\d.,]{2,}/g) || [])
      .map(toRatePerUsd)
      .filter(Boolean);
    if (!nums.length) return;
    // a line that also says "price/نرخ" is the strongest signal
    candidates.push({ rate: nums[0], strong: rates.some(w => line.includes(w)) });
  });

  if (!candidates.length) return null;
  const strong = candidates.find(c => c.strong);
  return (strong || candidates[0]).rate;
}

/**
 * Pulls every city rate out of one message.
 *
 * Scans for city names, then looks for a number in the text BETWEEN that city
 * and the next city mention (capped at 60 chars). Bounding at the next city
 * is what stops "أربيل ... بغداد 154.100" from wrongly assigning Baghdad's
 * number to Erbil.
 */
function extractCityRates(rawText, allowedCities) {
  const text = normalizeArabic(rawText);
  const hits = [];

  // A channel can declare which cities it covers. A Kurdistan-only channel
  // must never publish a Baghdad number just because a post happens to
  // mention بغداد in passing (a comparison, a news line, an ad).
  const pool = allowedCities && allowedCities.length
    ? CITIES.filter(c => allowedCities.includes(c.id))
    : CITIES;

  pool.forEach(city => {
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

/**
 * Parses an exchange company's rate board (e.g. khakishaqlawa.com).
 *
 * Deliberately markup-agnostic: rather than depending on a particular table
 * structure, it strips tags to plain text and finds the IQD row by its label,
 * then reads the next two numbers as buy and sell. A site redesign that keeps
 * the same visible content therefore keeps working.
 *
 * Boards quote per $100 (e.g. 153,725), which toRatePerUsd() normalises.
 */
function parseExchangeBoard(html, channel) {
  // collapse to text, keeping row boundaries so labels stay next to numbers
  const text = normalizeArabic(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(tr|div|p|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/[ \t]+/g, ' ')
  );

  // the USD/IQD row: labelled IQD or دینار (Kurdish دینار / Arabic دينار)
  const lines = text.split('\n');
  for (const line of lines) {
    if (!/IQD|دينار|دينار|دينار/i.test(line) && !/دينار/.test(line) && !/IQD/i.test(line)) continue;
    const nums = (line.match(/\d[\d.,]{2,}/g) || [])
      .map(n => toRatePerUsd(n))
      .filter(Boolean);
    if (nums.length >= 2) {
      const [buy, sell] = nums;
      const side = channel.side || 'mid';
      const rate = side === 'buy' ? buy
        : side === 'sell' ? sell
          : +((buy + sell) / 2).toFixed(2);
      return { rate, buy, sell };
    }
    if (nums.length === 1) return { rate: nums[0], buy: nums[0], sell: nums[0] };
  }
  return null;
}

async function scrapeExchangeBoard(channel) {
  const response = await fetch(channel.url, {
    headers: {
      // these boards commonly reject requests without a browser-like UA
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en,ar;q=0.9,ku;q=0.8'
    }
  });
  if (!response.ok) throw new Error(`${channel.id} returned HTTP ${response.status}`);

  const parsed = parseExchangeBoard(await response.text(), channel);
  if (!parsed) throw new Error(`No IQD rate found on ${channel.id}`);

  const city = channel.city || 'erbil';
  return {
    id: channel.id,
    label: channel.label,
    ratePerUsd: parsed.rate,
    ratePer100Usd: Math.round(parsed.rate * 100),
    buyPerUsd: parsed.buy,
    sellPerUsd: parsed.sell,
    cityRates: { [city]: parsed.rate },
    cities: [city],
    sourceSnippet: `buy ${parsed.buy} / sell ${parsed.sell}`,
    fetchedAt: new Date().toISOString()
  };
}

/** Walks a dotted path ("data.rates") through an object, tolerating gaps. */
function atPath(obj, path) {
  if (!path) return obj;
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

/**
 * Reads a rate from a JSON endpoint — for sites that render their board with
 * JavaScript, where there is nothing to scrape in the HTML.
 *
 * Configured rather than hardcoded, because every site's JSON differs: point
 * `listPath` at the array, `match` at the USD row, and name the buy/sell
 * fields. Falls back to scanning for a USD-looking entry if `match` is absent.
 */
async function scrapeJsonSource(channel) {
  const response = await fetch(channel.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*'
    }
  });
  if (!response.ok) throw new Error(`${channel.id} returned HTTP ${response.status}`);

  const data = await response.json();
  const list = atPath(data, channel.listPath);
  if (!Array.isArray(list)) throw new Error(`${channel.id}: no array at "${channel.listPath || '(root)'}"`);

  const m = channel.match || { field: 'code', value: 'USD' };
  const row = list.find(r => r && String(r[m.field] || '').toUpperCase().includes(String(m.value).toUpperCase()));
  if (!row) throw new Error(`${channel.id}: no ${m.value} row found`);

  const buy = toRatePerUsd(row[channel.buyField || 'buy']);
  const sell = toRatePerUsd(row[channel.sellField || 'sell']);
  const usable = [buy, sell].filter(Boolean);
  if (!usable.length) throw new Error(`${channel.id}: ${m.value} row had no usable rate`);

  const side = channel.side || 'mid';
  const rate = (side === 'buy' && buy) ? buy
    : (side === 'sell' && sell) ? sell
      : +(usable.reduce((a, b) => a + b, 0) / usable.length).toFixed(2);

  const city = channel.city || 'erbil';
  return {
    id: channel.id,
    label: channel.label,
    ratePerUsd: rate,
    ratePer100Usd: Math.round(rate * 100),
    buyPerUsd: buy || null,
    sellPerUsd: sell || null,
    cityRates: { [city]: rate },
    cities: [city],
    sourceSnippet: `buy ${buy || '—'} / sell ${sell || '—'}`,
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Reads recent posts from a Facebook Page via the Graph API and runs the same
 * per-city extraction used for Telegram — a rate post is a rate post,
 * whichever platform it's on.
 *
 * Requires a Page access token in `process.env.FB_PAGE_TOKEN` (or a per-channel
 * `tokenEnv`). Deliberately NOT a facebook.com scrape: that is blocked for
 * datacenter IPs and violates Facebook's terms.
 */
async function scrapeFacebookPage(channel) {
  const tokenVar = channel.tokenEnv || 'FB_PAGE_TOKEN';
  const token = process.env[tokenVar];
  if (!token) {
    throw new Error(`${channel.id}: ${tokenVar} is not set — see README on getting a Page token`);
  }

  const version = channel.graphVersion || 'v21.0';
  const limit = channel.postLimit || 15;
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(channel.pageId)}/posts`
    + `?fields=message,created_time&limit=${limit}&access_token=${encodeURIComponent(token)}`;

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await response.json().catch(() => null);

  if (!response.ok || (body && body.error)) {
    // surface Facebook's own message — token expiry and permission problems
    // are by far the most common failure, and they're self-explanatory
    const msg = body && body.error ? body.error.message : `HTTP ${response.status}`;
    throw new Error(`${channel.id}: ${msg}`);
  }

  const posts = (body && body.data) || [];
  // newest first from Graph, so scan forward and merge — same approach as
  // Telegram, where the newest post may only cover one city
  const rates = {};
  let sourceSnippet = null;
  for (const post of posts) {
    if (!post.message) continue;
    const found = extractCityRates(post.message, channel.cities);
    Object.keys(found).forEach(city => {
      if (rates[city] === undefined) rates[city] = found[city];
    });
    if (!sourceSnippet && Object.keys(found).length) {
      sourceSnippet = post.message.trim().slice(0, 120);
    }
    if (channel.cities && Object.keys(rates).length === channel.cities.length) break;
  }

  if (!Object.keys(rates).length) {
    throw new Error(`No city rate found in the last ${limit} posts from ${channel.id}`);
  }

  return {
    id: channel.id,
    label: channel.label,
    ratePerUsd: rates.baghdad !== undefined ? rates.baghdad : null,
    ratePer100Usd: rates.baghdad !== undefined ? Math.round(rates.baghdad * 100) : null,
    cityRates: rates,
    cities: Object.keys(rates),
    sourceSnippet,
    fetchedAt: new Date().toISOString()
  };
}

async function scrapeChannel(channel) {
  if (channel.type === 'facebook') return scrapeFacebookPage(channel);
  if (channel.type === 'json') return scrapeJsonSource(channel);
  if (channel.type === 'exchange') return scrapeExchangeBoard(channel);
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
  const expectedCityCount = (channel.cities && channel.cities.length) || CITIES.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messages[i];
    const found = extractCityRates(text, channel.cities);

    // Channels that post one regional rate label it rather than naming a city
    // on the same line. `defaultCities` (or `defaultCity`) says which cities
    // that one rate should be published for.
    const fallbackCities = channel.defaultCities
      || (channel.defaultCity ? [channel.defaultCity] : null);
    if (!Object.keys(found).length && fallbackCities) {
      const labeled = extractLabeledRate(text);
      if (labeled) fallbackCities.forEach(c => { found[c] = labeled; });
    }

    const keys = Object.keys(found);
    if (!keys.length) continue;

    keys.forEach(city => {
      if (rates[city] === undefined) {
        rates[city] = found[city];
        seenAt[city] = i;
      }
    });
    if (!sourceSnippet) sourceSnippet = text.trim().slice(0, 120);
    if (Object.keys(rates).length === expectedCityCount) break;
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
  parseExchangeBoard,
  scrapeJsonSource,
  scrapeFacebookPage,
  atPath,
  CITIES,
  OFFICIAL_RATE_IQD,
  getChannelRate,
  // exported for testing
  extractCityRates,
  extractLabeledRate,
  normalizeArabic,
  toRatePerUsd
};
