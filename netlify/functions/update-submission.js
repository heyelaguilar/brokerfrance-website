const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxkV-FR10oa7bqQLDQxg1aKNh_XtydRqfN9tXOw9IetH1BAiILjKPXfql61aDACXTVcEw/exec';

async function callScript(payload) {
  const body = JSON.stringify(payload);
  const r1 = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
    redirect: 'manual',
  });
  const redirectUrl = r1.headers.get('location');
  if (!redirectUrl) return await r1.json();
  const r2 = await fetch(redirectUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
  });
  return await r2.json();
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
