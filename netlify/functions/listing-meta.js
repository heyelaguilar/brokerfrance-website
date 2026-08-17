// Serves index.html with per-listing Open Graph / Twitter meta tags swapped in,
// so a shared /listing/:id link shows that property's own photo instead of
// the site-wide logo image. Crawlers (WhatsApp, Facebook, iMessage, etc.)
// don't execute JS, so the client-side listing router never runs for them —
// this has to happen server-side, before the static file is served.
//
// Sheet column names vary (e.g. "amount" or "price", "key" or "key_details"),
// so field lookup mirrors buildCOL()'s alias matching in index.html.
const API_URL = 'https://script.google.com/macros/s/AKfycbw6K2kW3AOpA_PNN6G9b0MArcjVzn9_Hc-E8v8UKrBAgH0TBZSZt9956Ntf1utrBUjIUQ/exec';

const ALIASES = {
  id: ['id'],
  location: ['location'],
  type: ['property_type', 'type'],
  price: ['price', 'selling_price', 'amount'],
  key_details: ['key_details', 'details', 'key'],
  photos: ['photos', 'photo'],
};

function pick(listing, field) {
  const keys = Object.keys(listing).map(k => ({ orig: k, norm: k.toLowerCase().trim().replace(/\s+/g, '_') }));
  for (const alias of ALIASES[field]) {
    const found = keys.find(k => k.norm.includes(alias));
    if (found) return String(listing[found.orig] || '').trim();
  }
  return '';
}

function formatPrice(raw) {
  if (!raw) return '';
  const n = parseFloat(String(raw).replace(/,/g, ''));
  if (isNaN(n) || n === 0) return '';
  return '₱' + n.toLocaleString();
}

// Mirrors driveThumb(): Drive share links get resolved to a file id (for
// our own image proxy below); anything else (Cloudinary, other direct
// image URLs) is already crawler-safe and used as-is.
function driveFileId(url) {
  if (!url) return '';
  const fileMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];
  const openMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (openMatch) return openMatch[1];
  return '';
}
function isDriveLink(url) { return /drive\.google\.com/.test(url || ''); }

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function replaceMeta(html, property, attr, content) {
  const re = new RegExp(`<meta ${attr}="${property}" content=".*?">`);
  return html.replace(re, `<meta ${attr}="${property}" content="${esc(content)}">`);
}

exports.handler = async (event) => {
  const id = (event.queryStringParameters && event.queryStringParameters.id) || '';
  const host = event.headers['x-forwarded-host'] || event.headers.host;
  const origin = `https://${host}`;

  try {
    const [htmlRes, dataRes] = await Promise.all([
      fetch(`${origin}/index.html`),
      fetch(API_URL),
    ]);
    if (!htmlRes.ok) throw new Error('index.html fetch failed: ' + htmlRes.status);
    let html = await htmlRes.text();

    let listing = null;
    if (id && dataRes.ok) {
      const data = await dataRes.json();
      listing = data.find(row => pick(row, 'id') === id) || null;
    }

    if (listing) {
      const location = pick(listing, 'location');
      const type = pick(listing, 'type');
      const keyDetails = pick(listing, 'key_details');
      const price = formatPrice(pick(listing, 'price')) || 'Price on Request';
      const thumbnail = String(listing.thumbnail || '').trim();
      const photos = pick(listing, 'photos');

      const title = keyDetails.split('|')[0].trim() || `${type || 'Property'} in ${location}`;
      const desc = `${price} — ${location}. ${keyDetails.split('|').slice(0, 3).join(' · ')}`.trim();

      const candidate = thumbnail || photos.split('|')[0] || '';
      let image = `${origin}/image/og-image.png`;
      if (isDriveLink(candidate)) {
        const fileId = driveFileId(candidate);
        if (fileId) image = `${origin}/.netlify/functions/drive-image?id=${fileId}`;
      } else if (/^https?:\/\//.test(candidate)) {
        image = candidate;
      }

      const url = `${origin}/listing/${encodeURIComponent(id)}`;

      html = html.replace(/<title>.*?<\/title>/, `<title>${esc(title)} — Broker France</title>`);
      html = replaceMeta(html, 'og:title', 'property', title);
      html = replaceMeta(html, 'og:description', 'property', desc);
      html = replaceMeta(html, 'og:url', 'property', url);
      html = replaceMeta(html, 'og:image', 'property', image);
      html = replaceMeta(html, 'twitter:title', 'name', title);
      html = replaceMeta(html, 'twitter:description', 'name', desc);
      html = replaceMeta(html, 'twitter:image', 'name', image);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
      body: html,
    };
  } catch (err) {
    console.error('listing-meta error:', err);
    return { statusCode: 302, headers: { Location: origin }, body: '' };
  }
};
