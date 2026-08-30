// api/latest-iqd-rate.js
// On Vercel this file automatically becomes:
// https://YOUR_PROJECT.vercel.app/api/latest-iqd-rate
//
// Returns whichever channel in lib/scraper.js is currently working first —
// this is what fx-sync.js in your app calls.
 
const { CHANNELS, getChannelRate } = require('../lib/scraper');
 
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  for (const channel of CHANNELS) {
    const result = await getChannelRate(channel);
    if (result.success) return res.status(200).json({ success: true, ...result });
  }
  res.status(502).json({ success: false, error: 'All channels failed' });
};
