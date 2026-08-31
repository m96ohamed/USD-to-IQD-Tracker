# IQD Rates API — multiple sources and multiple cities, side by side

Reads the latest USD/IQD rates from **two** public Telegram channels
separately, plus the official Central Bank rate, and returns all of them
together — so your site can show A / B / C.

As of the multi-city update it also extracts a **separate rate per city**
where the channels publish one, instead of only reading Baghdad.

Sources used right now:
- `@dollariraqi` — https://t.me/s/dollariraqi (40K+ subscribers) — Baghdad
- `@dollar_price` — https://t.me/s/dollar_price (46K+ subscribers) — Baghdad
- `@azura_gold` — https://t.me/s/azura_gold — a **gold dealer in Erbil** that
  posts one daily USD line among its gold prices (see "Label-anchored rates")
- `khakishaqlawa.com` — an exchange company in **Erbil**, so this is a real
  Erbil rate rather than a Baghdad one (see "Exchange-company sources" below)
- Central Bank official rate (constant, since it's policy-set and rarely moves)

## Files in this project

```
api/
  rates.js            <- deploys to /api/rates            (the A/B/C combined endpoint)
  latest-iqd-rate.js  <- deploys to /api/latest-iqd-rate   (single rate, for fx-sync.js)
lib/
  scraper.js          <- shared scraping logic used by both of the above
server.js             <- same logic as an Express app, for LOCAL TESTING or other hosts
package.json
fx-sync.js            <- drop into your app's codebase
```

You don't need to touch `server.js` at all for Vercel — it's just there
in case you ever want to run this locally the old way, or deploy to a
different host later. Vercel only looks at the `api/` folder.

> **If you're updating an existing deployment:** `server.js` still contains
> the *old* Baghdad-only logic unless you port it across. Vercel ignores it,
> so this only matters if you run locally with `npm start`.

## 1. Deploy to Vercel (no credit card required)

1. Push this whole folder to the same GitHub repo you already made
   (or a new one) — same drag-and-drop upload method as before.
2. Go to vercel.com → sign up/log in with GitHub.
3. Click **Add New → Project**, pick your repo, click **Deploy**.
   Vercel auto-detects the `api/` folder — no build command, no start
   command, nothing to configure.
4. In a minute or two you'll get a URL like `https://your-project.vercel.app`.
5. Test it: open `https://your-project.vercel.app/api/rates` in your
   browser. You should see JSON like:

```json
{
  "success": true,
  "officialRate": { "label": "البنك المركزي العراقي (Central Bank)", "ratePerUsd": 1310 },
  "marketRates": [
    { "id": "dollariraqi:baghdad", "city": "baghdad", "ratePerUsd": 1541, "success": true },
    { "id": "dollariraqi:erbil",   "city": "erbil",   "ratePerUsd": 1545, "success": true },
    { "id": "dollar_price:baghdad","city": "baghdad", "ratePerUsd": 1543.5, "success": true }
  ],
  "cityAverages": { "baghdad": 1542.25, "erbil": 1545 },
  "unavailableCities": ["sulaymaniyah", "duhok", "mosul", "basra", "kirkuk",
                        "najaf", "karbala", "anbar", "diyala", "babil"],
  "averageMarketRate": 1542.25
}
```

Note the shape change: `marketRates` now contains **one entry per channel per
city**, each tagged with a `city` field. `ratePerUsd` at the channel level
still carries the Baghdad figure, so anything already reading it keeps working.

### The two fields to look at first

- **`cityAverages`** — cities that were actually found, averaged across
  whichever channels reported them.
- **`unavailableCities`** — cities the scraper knows about but nobody
  published. These are reported explicitly rather than silently omitted, so a
  client can display "none available" without having to guess why.

## 2. Adding or removing a channel

Everything lives in one array in `lib/scraper.js`:

```js
const CHANNELS = [
  { id: 'dollariraqi', label: 'بورصة الكفاح والحارثية (@dollariraqi)', url: 'https://t.me/s/dollariraqi' },
  { id: 'dollar_price', label: 'سعر الدولار اليوم (@dollar_price)', url: 'https://t.me/s/dollar_price' }
];
```

Add a line with a new channel's `t.me/s/<channel>` URL and Vercel will
pick it up on your next push — no other code changes needed, as long as
it posts a "بغداد: 123,456" style line somewhere.

## 3. Exchange-company sources (non-Telegram)

A channel can set `type: 'exchange'` to scrape a currency exchange's own rate
board instead of a Telegram feed:

```js
{
  id: 'khaki_shaqlawa',
  label: 'خاكي شقلاوة - أربيل (khakishaqlawa.com)',
  url: 'https://khakishaqlawa.com/',
  type: 'exchange',
  city: 'erbil',   // the company's location IS the city this rate belongs to
  side: 'mid'      // 'mid' | 'buy' | 'sell'
}
```

- **`city`** is set explicitly, since a shop's board is that city's rate. This
  is how Erbil gets real data while the Telegram channels only cover Baghdad.
- **`side`** picks which number to publish. Boards quote buy and sell (e.g.
  153,725 / 153,800 per $100); `mid` averages them, which is the fairest single
  number for budgeting. Use `sell` for what you'd pay to buy dollars, or `buy`
  for what you'd get selling them. Both raw figures are returned as
  `buyPerUsd` / `sellPerUsd` regardless.
- The parser is **markup-agnostic**: it strips tags to text, finds the row
  labelled IQD/دينار, and reads the next two numbers. A site redesign that
  keeps the same visible content keeps working. Tested against table markup,
  div markup, an Arabic-only label, and a single-number row.

## Restricting a channel to certain cities

A channel can declare the cities it covers:

```js
{
  id: 'azura_gold',
  label: 'ئازورا گۆڵد - كوردستان (@azura_gold)',
  url: 'https://t.me/s/azura_gold',
  cities: ['erbil', 'sulaymaniyah', 'duhok']
}
```

Without this, a passing mention of بغداد in one of its posts — a comparison, a
news line, an ad — would be published as a Baghdad rate from a channel that
doesn't actually track Baghdad. With it, only the listed cities are extracted.
Omit `cities` and the channel is scanned for all of them, as before.

### Label-anchored rates (`defaultCity`)

Some channels post **one** regional rate and never name the city on that line.
@azura_gold is the example: its daily post reads

```
⚪ ئۆنسەی زێر  4454 دۆلار
🟡 زێڕی عەیار 21 به 955 هەزار دینار
🔴 زێڕی عەیار 22 به 1.000 ملیۆن دینار
💵 نرخی دۆلار ••• 154.000 دینار      ← the only line we want
زێڕینگری ئــازورا ــ هەولێر           ← the city, 3 lines below
بازاڕی زێڕینگران ژ.م 07504861391      ← a phone number
```

City-adjacency matching finds nothing here, because هەولێر sits next to a phone
number, not a rate. Worse, **two of the gold prices survive the sanity band**:
`1.000` and `1.091` million dinar (22k and 24k gold) parse to 1000 and 1091,
which look like plausible dollar rates. Grabbing any number would publish a
gold price as the exchange rate.

So a channel can set `defaultCities`, which switches on label-anchored
extraction: find the line that mentions **dollars** but not gold/ounce words
(عەیار, ئۆنسە, زێڕ, ملیۆن, هەزار …), preferring one that also says نرخ/سعر,
and read the rate from there. Verified against the real post: it returns 1540
from `154.000`, and returns nothing for the ounce line, both gold lines, the
phone-number signature, and a post with no dollar line at all.

```js
defaultCities: ['erbil', 'sulaymaniyah', 'duhok']
```

The single rate is published for **every** city listed. For @azura_gold that's
all three Kurdistan cities, since the channel covers the region rather than
just its own shop.

This is a deliberate, **per-channel** exception to the rule that a city never
borrows another city's number — it only applies where `defaultCities` is set,
and it's opt-in precisely so the choice is visible in the config rather than
buried in the parser. Baghdad and everywhere else are unaffected.

City-adjacency still runs first, so if the channel ever posts per-city rates
those are used instead and the fallback never fires. (`defaultCity` as a single
string is still accepted, and behaves as a one-city list.)

### Kurdish spellings

Kurdistan channels write city names in Sorani: **هەولێر**, **سلێمانی**,
**دھۆک**. These use letters that don't exist in Arabic (ک ی ێ ۆ ە ھ ڵ ڕ), so
`normalizeArabic()` now folds them to their Arabic equivalents. Aliases are
normalised through the same function, so the Arabic and Kurdish spellings of a
city converge on one form and either will match. Tested with Sorani script, the
alternate ھ, Arabic spellings, and posts mixing both.

## Finding a JS-rendered site's endpoint

Some exchange sites (e.g. **tekanexchange.net**) don't put their rates in the
HTML at all — the page ships empty and JavaScript fills in the cards after
load. Fetching the page returns only the logo and headings, so the `exchange`
HTML parser finds nothing. There is no point pointing a scraper at the page
itself; you need the request the page makes.

To find it, on a desktop browser:

1. Open the site, press **F12** → **Network** tab.
2. Tick **Fetch/XHR** to filter out images and scripts.
3. Reload the page.
4. Look for a request whose response contains the rate numbers — usually JSON,
   often named something like `rates`, `prices`, `api/...`, or a Google
   Sheets / Firebase / Supabase URL.
5. Click it → **Response** tab → note the **URL** and the **shape** of the JSON
   (which array holds the rows, what the USD row's fields are called).

Then add a `type: 'json'` channel — a commented-out template for Tekan is
already in `lib/scraper.js`, ready to fill in:

```js
{
  id: 'tekan',
  label: 'صرافة تيكان - أربيل (tekanexchange.net)',
  url: 'https://tekanexchange.net/<the endpoint you found>',
  type: 'json',
  city: 'erbil',
  side: 'mid',
  listPath: 'rates',                      // dotted path to the array, e.g. 'data.rates'
  match: { field: 'code', value: 'USD' }, // how to spot the USD row
  buyField: 'buy',
  sellField: 'sell'
}
```

The parser handles per-$100 (153,725) and per-$1 (1537.25) quoting, nested
paths, string numbers with commas, and a row that only has one side.

**If there's no such request**, the rates may be embedded in the page's
JavaScript bundle or rendered from a server template that our fetcher can't
trigger. In that case scraping isn't practical without a headless browser —
which won't run on a plain Vercel function — and the honest answer is to skip
that source or ask the company whether they publish a feed.

## Facebook Pages — what's actually possible

**Scraping facebook.com does not work.** A server-side fetch gets a login wall
or an empty JavaScript shell; requests from datacenter IPs (like Vercel's) are
blocked aggressively; class names are obfuscated and rotate, so any selector
breaks within weeks; and it violates Facebook's Terms of Service. This is
unlike the `t.me/s/` pages, which Telegram publishes deliberately for
unauthenticated reading.

The supported route is the **Graph API**, which returns clean JSON. A
`type: 'facebook'` channel does this:

```js
{
  id: 'some_fb_page',
  label: 'اسم الصفحة (Facebook)',
  type: 'facebook',
  pageId: '1234567890',        // numeric Page ID or the page's username
  tokenEnv: 'FB_PAGE_TOKEN',   // optional; this is the default
  postLimit: 15
}
```

Post text runs through the **same per-city extractor** as Telegram, so a post
listing بغداد / أربيل / السليمانية yields all three, merged across recent posts
exactly as the Telegram scraper does.

### The catch: you need a Page access token

This is the part that decides whether it's viable for you:

- **If it's your own Page** (or you're an admin): straightforward. Create an
  app at developers.facebook.com, generate a Page access token, exchange it for
  a long-lived one, and set it as `FB_PAGE_TOKEN` in Vercel's environment
  variables. Long-lived Page tokens generally don't expire while the admin's
  password is unchanged, but they can be invalidated — the scraper surfaces
  Facebook's own error message when that happens, and the channel reports
  `success: false` while the others keep working.
- **If it's someone else's Page**: reading another Page's posts requires the
  **Page Public Content Access** permission, which needs App Review plus
  Business Verification, and Meta grants it sparingly for this kind of use.
  Realistically, this is not worth pursuing for a personal budgeting app.

### Practical advice

Most Iraqi rate pages post the same content to **both** Facebook and Telegram.
If the page you have in mind also has a Telegram channel, add that instead —
it's one line in `CHANNELS`, needs no token, no app review, and no ongoing
credential maintenance. That's why the two existing sources are Telegram.

### Risks specific to this kind of source

- **It's one company's board, not a market aggregate.** Two Telegram channels
  disagreeing is a sanity check; a single shop is a single opinion, and it may
  be stale outside business hours.
- **Anti-bot protection.** Plain requests without a browser-like User-Agent are
  refused, so the scraper sends one. If the site later adds Cloudflare or
  similar, requests from Vercel's datacenter IPs may be blocked — that channel
  would simply report `success: false` while the others carry on.
- **Be polite.** This is a small business's own site, not a public API. The
  existing 5-minute per-channel cache applies here too; don't lower it.

## 4. Adding or fixing a city

Cities live in a second array in the same file:

```js
const CITIES = [
  { id: 'baghdad', label: 'بغداد', aliases: ['بغداد'] },
  { id: 'erbil',   label: 'أربيل', aliases: ['اربيل', 'هولير', 'اربل'] },
  ...
];
```

Currently covered: baghdad, erbil, sulaymaniyah, duhok, mosul, basra, kirkuk,
najaf, karbala, anbar, diyala, babil.

**If a city you expect shows up in `unavailableCities`:** open that channel's
`t.me/s/...` page, look at how it actually writes the city's name, and add
that spelling to the city's `aliases`. That's the only change needed — the
`id` is what clients match on, so it must stay stable.

You usually don't need to add variants for diacritics, ـتطويل, أ/إ/آ vs ا,
ى vs ي, or ة vs ه — text is normalised before matching, so those are handled.
Arabic-Indic digits (١٥٤.١٠٠) are converted too.

### How a rate is matched

1. **Normalise** the post (`normalizeArabic`): strip diacritics and tatweel,
   unify أإآ→ا, ى→ي, ة→ه, convert ٠-٩ and ۰-۹ to ASCII digits.
2. **Bound the search.** For each city mention, the number is looked for only
   in the text *between that city and the next city mention* (capped at 60
   characters). This is what stops a post reading `اربيل` on one line and
   `بغداد 154.100` on the next from assigning Baghdad's number to Erbil.
3. **Sanity-check the number.** `toRatePerUsd()` accepts per-$100 (`154.100`)
   or per-$1 (`1541`) quoting and only accepts a result in the 1,000–3,000
   band. Anything outside is rejected rather than published — a post reading
   `بغداد اليوم درجة الحرارة 45` yields nothing rather than a nonsense rate.
4. **Merge across posts.** Messages are scanned newest→oldest and merged,
   because the newest post often covers Baghdad only while a slightly older
   one lists the other cities. Each city keeps its newest value.

## 5. Show A / B / C on your site

```html
<div id="rates"></div>
<script>
  fetch('https://your-project.vercel.app/api/rates')
    .then(r => r.json())
    .then(data => {
      const rows = data.marketRates
        .filter(r => r.success && r.city === 'baghdad')
        .map(r => `${r.label}: ${r.ratePerUsd} IQD`);
      rows.push(`${data.officialRate.label}: ${data.officialRate.ratePerUsd} IQD`);
      document.getElementById('rates').innerHTML = rows.join('<br>');
    });
</script>
```

To list every city instead, iterate `data.cityAverages`.

## 6. For your app's own currency conversion (fx-sync.js)

Update the URL in `fx-sync.js`:

```js
const RATE_API_URL = 'https://your-project.vercel.app/api/latest-iqd-rate';
```

That endpoint returns whichever of the two channels is currently working
(so one channel going down doesn't break your app's conversions). It now also
accepts a city:

```
/api/latest-iqd-rate            -> Baghdad (unchanged default)
/api/latest-iqd-rate?city=erbil -> Erbil, or HTTP 502 if no channel has it
```

If you want your app's math to use the average of both channels instead, point
it at `/api/rates` and read `averageMarketRate` (Baghdad) or
`cityAverages.<city>`.

**The Tabooga app reads `/api/rates` directly** and matches on the `city`
field, so any city the API starts publishing appears in the app's city picker
automatically — no app-side change needed.

## Important caveats — read before relying on this

- **Both channels are unofficial.** They're the same kind of public
  Telegram channels most Iraqi rate sites and apps already read from —
  free, but with no guarantee they stay online or keep the same format.
- **Non-Baghdad cities are unverified.** The multi-city extraction is tested
  against realistic and adversarial sample posts, but *not* against live data —
  so it's not confirmed that these channels post rates for cities other than
  Baghdad at all. If they don't, `unavailableCities` will simply list
  everything else, which is correct behaviour rather than a bug. Check
  `/api/rates` after deploying to see what's really there.
- **If a channel changes its message format**, that one channel will
  start failing (`"success": false` for it) while the other keeps
  working. Fixing it means adjusting `CITIES` aliases or `RATE_NUMBER` in
  `lib/scraper.js` after checking a fresh post on that channel's
  `t.me/s/...` page. (The old single `BAGHDAD_REGEX` no longer exists — it was
  replaced by the per-city matcher described above.)
- **A failed scrape falls back to the last good value.** `getChannelRate()`
  returns `success: true` with `stale: true` and a `warning` when it serves a
  cached value after a failed scrape — that's a usable rate, not an error.
  Only `success: false` means there's nothing at all.
- **Vercel's cache is shorter-lived than a normal server's.** Each
  function call caches for 5 minutes *within* a "warm" instance, but
  Vercel may spin up a fresh instance between requests if traffic is
  light — occasionally a request just re-scrapes instead of hitting the
  cache. Not a bug, just slightly less caching than on a
  never-sleeping server. Functionally you won't notice a difference.
- **Keep the manual-override option in your app** (already wired into
  `fx-sync.js`). It's your safety net if scraping ever breaks entirely.
- **Don't poll too often** from your app or site — every 15–30 minutes
  is plenty; no need to hammer Telegram's servers more than that.
- **The official rate is a constant** (`OFFICIAL_RATE_IQD` in
  `lib/scraper.js`). It rarely changes, but if your app already has a
  working live source for it, use that instead of this hardcoded value.
