const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz7jZRpSMqhSsuKyRrJPXfxr_C2PjC7A_HpkQGrSF6G6pBNovHSsb_5aEvqcE8s_W5SPw/exec';

async function callScript(payload) {
  const body = JSON.stringify(payload);
  const r1 = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
    redirect: 'manual',
  });
  console.log('r1 status:', r1.status, 'location:', r1.headers.get('location'));
  const redirectUrl = r1.headers.get('location');
  if (!redirectUrl) {
    const text = await r1.text();
    console.log('r1 body (no redirect):', text.substring(0, 300));
    return JSON.parse(text);
  }
  const r2 = await fetch(redirectUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
  });
  console.log('r2 status:', r2.status);
  const text = await r2.text();
  console.log('r2 body:', text.substring(0, 300));
  return JSON.parse(text);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  try {
    const result = await callScript(body);
    console.log('Apps Script result:', JSON.stringify(result));
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
  } catch (err) {
    console.error('update-submission error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
