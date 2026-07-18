const SUBMIT_SHEET_URL = 'https://script.google.com/macros/s/AKfycbxkAcUTFs-eSJMqIh0u_RXPQCYlMrB-9j53f-bKNS9MvcB5WLHWNPSATt5t8-URmKerWA/exec';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  try {
    const res = await fetch(SUBMIT_SHEET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(data),
    });

    const text = await res.text();

    if (!res.ok) {
      console.error('Apps Script error:', res.status, text);
      return { statusCode: 502, body: JSON.stringify({ error: `Sheet write failed (${res.status})`, detail: text }) };
    }

    // Apps Script returns an HTML error page (not JSON) when doPost throws internally,
    // even with a 200 status — treat that as a failure too.
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (parsed && parsed.error) {
      console.error('Apps Script reported error:', parsed.error);
      return { statusCode: 502, body: JSON.stringify({ error: parsed.error }) };
    }
    if (!parsed && /<html/i.test(text)) {
      console.error('Apps Script returned an HTML error page:', text.slice(0, 500));
      return { statusCode: 502, body: JSON.stringify({ error: 'Apps Script returned an unexpected error page', detail: text.slice(0, 500) }) };
    }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('submit-listing function error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error. Please try again.' }) };
  }
};
