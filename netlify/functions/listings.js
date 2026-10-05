// Fast, cached copy of the Listings sheet for the public site.
// The Apps Script takes 2–4s per call, so Netlify's CDN keeps this response for a
// minute and serves the stale copy instantly while refreshing in the background.
// Drive-folder photo lists are resolved here once, instead of one request per
// listing in every visitor's browser.
const { listFolderImages } = require('./drive-folder');

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw6K2kW3AOpA_PNN6G9b0MArcjVzn9_Hc-E8v8UKrBAgH0TBZSZt9956Ntf1utrBUjIUQ/exec';

const folderIdOf = url => (String(url || '').match(/\/folders\/([a-zA-Z0-9_-]+)/) || [])[1] || '';

exports.handler = async () => {
  try {
    const res = await fetch(APPS_SCRIPT_URL, { redirect: 'follow' });
    if (!res.ok) throw new Error('Sheet HTTP ' + res.status);
    const listings = await res.json();
    if (!Array.isArray(listings)) throw new Error((listings && listings.error) || 'Unexpected sheet response');

    await Promise.all(listings.map(async l => {
      const folderId = folderIdOf(l.photos);
      if (!folderId) return;
      try {
        l.folder_images = (await listFolderImages(folderId)).map(img => img.id);
      } catch (err) {
        console.warn('folder', folderId, err.message); // the browser falls back to drive-folder
      }
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'Netlify-CDN-Cache-Control': 'public, durable, max-age=60, stale-while-revalidate=604800',
      },
      body: JSON.stringify(listings),
    };
  } catch (err) {
    console.error('listings error:', err.message);
    return { statusCode: 502, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
  }
};
