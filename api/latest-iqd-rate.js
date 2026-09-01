// api/latest-iqd-rate.js
// On Vercel this file automatically becomes:
// https://YOUR_PROJECT.vercel.app/api/latest-iqd-rate
//
// Returns a single working rate. Defaults to Baghdad for backwards
// compatibility; pass ?city=erbil for another city.

const { ACTIVE_CHANNELS, getChannelRate } = require('../lib/scraper');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const city = (url.searchParams.get('city') || 'baghdad').toLowerCase();

  for (const channel of ACTIVE_CHANNELS) {
    const result = await getChannelRate(channel);
    if (!result.success) continue;
    const rate = result.cityRates && result.cityRates[city];
    if (rate) {
      return res.status(200).json({
        success: true,
        ...result,
        city,
        ratePerUsd: rate,
        ratePer100Usd: Math.round(rate * 100)
      });
    }
  }
  res.status(502).json({
    success: false,
    city,
    error: `No working rate for ${city}`
  });
};
