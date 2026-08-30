# IQD Rates API — multiple sources and multiple cities, side by side

Reads the latest USD/IQD rates from **two** public Telegram channels
separately, plus the official Central Bank rate, and returns all of them
together — so your site can show A / B / C.

As of the multi-city update it also extracts a **separate rate per city**
where the channels publish one, instead of only reading Baghdad.

Sources used right now:
- `@dollariraqi` — https://t.me/s/dollariraqi (40K+ subscribers)
- `@dollar_price` — https://t.me/s/dollar_price (46K+ subscribers)
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

## 3. Adding or fixing a city

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

## 4. Show A / B / C on your site

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

## 5. For your app's own currency conversion (fx-sync.js)

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
