const crypto = require('crypto');

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim  = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${claim}`);
  const sig = sign.sign(sa.private_key, 'base64url');
  const jwt = `${header}.${claim}.${sig}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const d = await r.json();
  return d.access_token;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  let sa;
  try { sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON); }
  catch { return { statusCode: 500, body: 'Missing credentials' }; }

  const token = await getAccessToken(sa);
  const sheetId = '1f3WpMSjifaJvc6eEtDBxXHrkX2W--n8iQ2fKsQlHDUs';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Submissions!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: [[
        new Date().toLocaleString('en-PH'),
        body['sp-name']      || '',
        body['sp-phone']     || '',
        body['sp-email']     || '',
        body['sp-role']      || '',
        body['sp-deal']      || '',
        body['sp-type']      || '',
        body['sp-location']  || '',
        body['sp-lot']       || '',
        body['sp-floor']     || '',
        body['sp-amount']    || '',
        body['sp-key']       || '',
        body['sp-thumbnail'] || '',
        body['sp-photos']    || '',
        body['sp-tct']       || 'No',
      ]],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Sheets API error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err }) };
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
};
