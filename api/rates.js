// api/rates.js
// On Vercel this file automatically becomes: https://YOUR_PROJECT.vercel.app/api/rates
// No routing config needed — Vercel maps /api/<filename>.js to that path.

const { CHANNELS, CITIES, OFFICIAL_RATE_IQD, getChannelRate } = require('../lib/scraper');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // lets your site call this from a browser
  if (req.method === 'OPTIONS') return res.status(200).end();

  const channels = await Promise.all(CHANNELS.map(getChannelRate));

  // One entry PER CHANNEL PER CITY, each tagged with `city`. The app matches
  // on that field, so simply publishing more cities here makes them appear in
  // the app with no client-side change.
  const marketRates = [];
  channels.forEach(ch => {
    if (!ch.success) {
      marketRates.push(ch); // keep the failed slot so clients can report it
      return;
    }
    const cityRates = ch.cityRates || {};
    const cities = Object.keys(cityRates);

    if (!cities.length) {
      marketRates.push({ ...ch, city: null });
      return;
    }
    cities.forEach(city => {
      marketRates.push({
        id: `${ch.id}:${city}`,
        channelId: ch.id,
        label: ch.label,
        city,                                   // ← what the app matches on
        ratePerUsd: cityRates[city],
        ratePer100Usd: Math.round(cityRates[city] * 100),
        success: true,
        stale: !!ch.stale,
        warning: ch.warning,
        fetchedAt: ch.fetchedAt
      });
    });
  });

  // Per-city averages across whichever channels reported that city.
  const byCity = {};
  marketRates.forEach(r => {
    if (!r.success || !r.city || !r.ratePerUsd) return;
    (byCity[r.city] = byCity[r.city] || []).push(r.ratePerUsd);
  });
  const cityAverages = {};
  Object.keys(byCity).forEach(city => {
    const list = byCity[city];
    cityAverages[city] = +(list.reduce((a, b) => a + b, 0) / list.length).toFixed(2);
  });

  // Cities we know about but nobody published — returned explicitly as null so
  // a client can say "none available" without having to guess why.
  const unavailableCities = CITIES
    .map(c => c.id)
    .filter(id => cityAverages[id] === undefined);

  res.status(200).json({
    success: true,
    fetchedAt: new Date().toISOString(),
    officialRate: { label: 'البنك المركزي العراقي (Central Bank)', ratePerUsd: OFFICIAL_RATE_IQD },
    marketRates,                    // [{ id, city, ratePerUsd, ... }, ...]
    cityAverages,                   // { baghdad: 1542.25, erbil: 1545, ... }
    unavailableCities,              // ['mosul', 'basra', ...]
    cities: CITIES,                 // ids + Arabic labels, so clients can build a picker
    // Baghdad remains the single blended number for older consumers.
    averageMarketRate: cityAverages.baghdad !== undefined ? cityAverages.baghdad : null
  });
};
