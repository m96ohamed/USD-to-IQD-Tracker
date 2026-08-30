# IQD Rates API — multiple sources, side by side

Reads the latest Baghdad rate from **two** public Telegram channels
separately, plus the official Central Bank rate, and returns all of them
together — so your site can show A / B / C like you wanted.

Sources used right now:
- `@dollariraqi` — https://t.me/s/dollariraqi (40K+ subscribers)
- `@dollar_price` — https://t.me/s/dollar_price (46K+ subscribers)
- Central Bank official rate (constant, since it's policy-set and rarely moves)

Both channels' current message formats were checked against live posts on
2026-08-29 and both extracted correctly (1,541 and 1,543.50 IQD/$1 that
day) — including the trickier case where one channel puts the number on
the line *after* "Baghdad" instead of next to it.

## 1. Run it locally

```bash
npm install
npm start
```

Then open `http://localhost:3000/api/rates`:

```json
{
  "success": true,
  "fetchedAt": "2026-08-29T11:20:00.000Z",
  "officialRate": { "label": "البنك المركزي العراقي (Central Bank)", "ratePerUsd": 1310 },
  "marketRates": [
    { "id": "dollariraqi", "label": "بورصة الكفاح والحارثية (@dollariraqi)", "ratePerUsd": 1541, "ratePer100Usd": 154100, "success": true, "stale": false, "fetchedAt": "..." },
    { "id": "dollar_price", "label": "سعر الدولار اليوم (@dollar_price)", "ratePerUsd": 1543.5, "ratePer100Usd": 154350, "success": true, "stale": false, "fetchedAt": "..." }
  ],
  "averageMarketRate": 1542.25
}
```

## 2. Adding or removing a channel

Everything lives in one array near the top of `server.js`:

```js
const CHANNELS = [
  { id: 'dollariraqi', label: 'بورصة الكفاح والحارثية (@dollariraqi)', url: 'https://t.me/s/dollariraqi' },
  { id: 'dollar_price', label: 'سعر الدولار اليوم (@dollar_price)', url: 'https://t.me/s/dollar_price' }
];
```

To add a third channel, add one line with its `t.me/s/<channel>` URL — as
long as it posts a "بغداد: 123,456" style line somewhere, no other code
changes are needed. To remove one, delete its line.

## 3. Deploy it (Render.com free tier)

1. Push this folder to a GitHub repo.
2. render.com → New → Web Service → connect that repo.
3. Build command: `npm install` · Start command: `npm start`
4. Deploy — you'll get a URL like `https://iqd-rates-abc1.onrender.com`.

## 4. Show A / B / C on your site

```html
<div id="rates"></div>
<script>
  fetch('https://YOUR_BACKEND_URL/api/rates')
    .then(r => r.json())
    .then(data => {
      const rows = data.marketRates.map(r => `${r.label}: ${r.ratePerUsd} IQD`);
      rows.push(`${data.officialRate.label}: ${data.officialRate.ratePerUsd} IQD`);
      document.getElementById('rates').innerHTML = rows.join('<br>');
    });
</script>
```

That gives you exactly the A / B / C stack — each channel's rate, then
the official rate underneath.

## 5. For your app's own currency conversion (fx-sync.js)

`fx-sync.js` still works as before and calls `/api/latest-iqd-rate`,
which now returns whichever of the two channels is currently working
(so one channel going down doesn't break your app's conversions). If you
want your app's math to use the average of both instead, point it at
`/api/rates` and read `averageMarketRate`.

## Important caveats — read before relying on this

- **Both channels are unofficial.** They're the same kind of public
  Telegram channels most Iraqi rate sites and apps already read from —
  free, but with no guarantee they stay online or keep the same format.
- **If a channel changes its message format**, that one channel will
  start failing (you'll see `"success": false` for it) while the other
  keeps working — the combined endpoint won't go down entirely just
  because one source breaks. Fixing it means tweaking `BAGHDAD_REGEX` or
  that channel's parsing after checking a fresh post on its `t.me/s/...`
  page.
- **Keep the manual-override option in your app** (already wired into
  `fx-sync.js`). It's your safety net if scraping ever breaks entirely.
- **Don't poll too often** — each channel is cached for 5 minutes so you
  don't hammer Telegram's servers; there's no need to call this more than
  every 15–30 minutes from your app or site.
- **The official rate is a constant** (`OFFICIAL_RATE_IQD` near the top
  of `server.js`). It rarely changes, but if your app already has a
  working live source for it, use that instead of this hardcoded value.
