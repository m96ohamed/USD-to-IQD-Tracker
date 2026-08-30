# IQD Rates API — multiple sources, side by side

Reads the latest Baghdad rate from **two** public Telegram channels
separately, plus the official Central Bank rate, and returns all of them
together — so your site can show A / B / C like you wanted.

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
    { "id": "dollariraqi", "label": "بورصة الكفاح والحارثية (@dollariraqi)", "ratePerUsd": 1541 },
    { "id": "dollar_price", "label": "سعر الدولار اليوم (@dollar_price)", "ratePerUsd": 1543.5 }
  ],
  "averageMarketRate": 1542.25
}
```

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

## 3. Show A / B / C on your site

```html
<div id="rates"></div>
<script>
  fetch('https://your-project.vercel.app/api/rates')
    .then(r => r.json())
    .then(data => {
      const rows = data.marketRates.map(r => `${r.label}: ${r.ratePerUsd} IQD`);
      rows.push(`${data.officialRate.label}: ${data.officialRate.ratePerUsd} IQD`);
      document.getElementById('rates').innerHTML = rows.join('<br>');
    });
</script>
```

## 4. For your app's own currency conversion (fx-sync.js)

Update the URL in `fx-sync.js`:

```js
const RATE_API_URL = 'https://your-project.vercel.app/api/latest-iqd-rate';
```

That endpoint returns whichever of the two channels is currently working
(so one channel going down doesn't break your app's conversions). If you
want your app's math to use the average of both instead, point it at
`/api/rates` and read `averageMarketRate`.

## Important caveats — read before relying on this

- **Both channels are unofficial.** They're the same kind of public
  Telegram channels most Iraqi rate sites and apps already read from —
  free, but with no guarantee they stay online or keep the same format.
- **If a channel changes its message format**, that one channel will
  start failing (`"success": false` for it) while the other keeps
  working. Fixing it means tweaking `BAGHDAD_REGEX` in `lib/scraper.js`
  after checking a fresh post on that channel's `t.me/s/...` page.
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
