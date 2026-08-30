// api/rates.js
// On Vercel this file automatically becomes: https://YOUR_PROJECT.vercel.app/api/rates
// No routing config needed — Vercel maps /api/<filename>.js to that path.

const { CHANNELS, OFFICIAL_RATE_IQD, getChannelRate } = require('../lib/scraper');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // lets your site call this from a browser
  if (req.method === 'OPTIONS') return res.status(200).end();

  const marketRates = await Promise.all(CHANNELS.map(getChannelRate));

  const goodRates = marketRates.filter(r => r.success).map(r => r.ratePerUsd);
  const averageMarketRate = goodRates.length
    ? +(goodRates.reduce((a, b) => a + b, 0) / goodRates.length).toFixed(2)
    : null;

  res.status(200).json({
    success: true,
    fetchedAt: new Date().toISOString(),
    officialRate: { label: 'البنك المركزي العراقي (Central Bank)', ratePerUsd: OFFICIAL_RATE_IQD },
    marketRates,          // [{ id, label, ratePerUsd, ratePer100Usd, ... }, ...]
    averageMarketRate     // handy single number if your budgeting math wants one
  });
};
