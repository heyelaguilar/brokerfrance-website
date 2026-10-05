// Saves an admin edit to the Listings sheet via the Apps Script.
// Only signed-in admin dashboard users (Netlify Identity) may call it, and the
// Apps Script additionally checks UPDATE_LISTING_SECRET so it can't be called directly.
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw6K2kW3AOpA_PNN6G9b0MArcjVzn9_Hc-E8v8UKrBAgH0TBZSZt9956Ntf1utrBUjIUQ/exec';

const EDITABLE = ['deal', 'type', 'location', 'lot_area', 'floor_area', 'price', 'key_details', 'video', 'thumbnail', 'photos', 'exclusive'];

async function callScript(payload) {
  const body = JSON.stringify(payload);
  const r1 = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
    redirect: 'manual',
  });
  const redirectUrl = r1.headers.get('location');
  if (!redirectUrl) {
    const text = await r1.text();
    return JSON.parse(text);
  }
  // The script already ran on the POST above; its result is served at the redirect URL via GET.
  // (POSTing again to that URL returns an HTML error page, not JSON.)
  const r2 = await fetch(redirectUrl);
  const text = await r2.text();
  return JSON.parse(text);
}

const reply = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method Not Allowed' });

  const user = context.clientContext && context.clientContext.user;
  if (!user) return reply(401, { error: 'Not signed in' });

  const secret = process.env.UPDATE_LISTING_SECRET;
  if (!secret) return reply(500, { error: 'UPDATE_LISTING_SECRET is not set in Netlify' });

  let body;
  try { body = JSON.parse(event.body); } catch { return reply(400, { error: 'Invalid JSON' }); }
  if (!body.id) return reply(400, { error: 'Missing listing id' });

  const fields = {};
  EDITABLE.forEach(k => { if (body[k] !== undefined) fields[k] = body[k]; });
  if (!Object.keys(fields).length) return reply(400, { error: 'Nothing to update' });

  try {
    const result = await callScript({ ...fields, id: body.id, action: 'updateListing', secret });
    if (!result || result.error) return reply(502, { error: (result && result.error) || 'No response from sheet' });
    if (!result.ok) return reply(502, { error: 'The Google Apps Script has not been updated with updateListing yet' });
    console.log(`listing ${body.id} updated by ${user.email}: ${Object.keys(fields).join(', ')}`);
    return reply(200, result);
  } catch (err) {
    console.error('update-listing error:', err.message);
    return reply(500, { error: err.message });
  }
};
