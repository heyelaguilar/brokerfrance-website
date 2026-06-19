const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxvcbk90-XX0NeoIyZg150xcvh0-F2ldKFDq8xMgLaV0Q0Pn0H8XEKl7dkaSyhuyQ0/exec';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      action: 'uploadImage',
      data: body.data,
      mimeType: body.mimeType,
      filename: body.filename,
    }),
    redirect: 'follow',
  });

  const text = await res.text();
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: text,
  };
};
