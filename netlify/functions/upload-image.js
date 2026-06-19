const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxvcbk90-XX0NeoIyZg150xcvh0-F2ldKFDq8xMgLaV0Q0Pn0H8XEKl7dkaSyhuyQ0/exec';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const payload = JSON.stringify({
    action: 'uploadImage',
    data: body.data,
    mimeType: body.mimeType,
    filename: body.filename,
  });

  try {
    // Step 1: hit the script URL without following redirect
    const r1 = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: payload,
      redirect: 'manual',
    });

    // Step 2: Apps Script always 302-redirects — re-POST to the real URL
    const redirectUrl = r1.headers.get('location');
    if (!redirectUrl) {
      // No redirect — response is already here
      const text = await r1.text();
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: text };
    }

    const r2 = await fetch(redirectUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: payload,
    });

    const text = await r2.text();
    console.log('Apps Script response status:', r2.status);
    console.log('Apps Script response body:', text.substring(0, 500));
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: text };

  } catch (err) {
    console.error('upload-image error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
