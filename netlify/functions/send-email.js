exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { name, email, phone, interest, message } = body;

  if (!name || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Name and message are required' }) };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Broker France <onboarding@resend.dev>', // replace with your verified domain email
        to: ['hey.elaguilar@gmail.com'],
        reply_to: email || undefined,
        subject: `New Inquiry from ${name} — Broker France`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#234130;padding:24px 32px;border-radius:12px 12px 0 0">
              <h2 style="color:#fff;margin:0;font-size:20px">📩 New Inquiry — Broker France Website</h2>
            </div>
            <div style="padding:24px 32px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;background:#fff">
              <table style="width:100%;border-collapse:collapse">
                <tr>
                  <td style="padding:10px 0;font-size:13px;color:#888;width:140px;border-bottom:1px solid #f0f0f0">Name</td>
                  <td style="padding:10px 0;font-size:14px;font-weight:600;color:#111;border-bottom:1px solid #f0f0f0">${name}</td>
                </tr>
                ${email ? `<tr>
                  <td style="padding:10px 0;font-size:13px;color:#888;border-bottom:1px solid #f0f0f0">Email</td>
                  <td style="padding:10px 0;font-size:14px;font-weight:600;color:#111;border-bottom:1px solid #f0f0f0">${email}</td>
                </tr>` : ''}
                ${phone ? `<tr>
                  <td style="padding:10px 0;font-size:13px;color:#888;border-bottom:1px solid #f0f0f0">Mobile</td>
                  <td style="padding:10px 0;font-size:14px;font-weight:600;color:#111;border-bottom:1px solid #f0f0f0">${phone}</td>
                </tr>` : ''}
                ${interest ? `<tr>
                  <td style="padding:10px 0;font-size:13px;color:#888;border-bottom:1px solid #f0f0f0">Interested In</td>
                  <td style="padding:10px 0;font-size:14px;font-weight:600;color:#111;border-bottom:1px solid #f0f0f0">${interest}</td>
                </tr>` : ''}
              </table>
              <div style="margin-top:20px">
                <p style="font-size:12px;color:#888;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;font-weight:700">Message</p>
                <p style="font-size:14px;color:#111;line-height:1.7;margin:0;background:#f7f8fa;padding:16px;border-radius:8px">${message.replace(/\n/g, '<br>')}</p>
              </div>
              <div style="margin-top:24px;font-size:11px;color:#bbb;text-align:center">
                Sent via francegonzales.netlify.app contact form
              </div>
            </div>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Resend API error:', err);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: err }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };

  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error. Please try again.' }),
    };
  }
};
