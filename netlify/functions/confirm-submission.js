exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) }; }

  const { name, email, phone, type, location, deal } = body;

  if (!email) return { statusCode: 200, body: JSON.stringify({ skipped: 'no email' }) };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Broker France <info@francebrokerage.com>',
        to: [email],
        reply_to: 'info@francebrokerage.com',
        subject: `We received your listing — Broker France`,
        html: `
          <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff">

            <!-- Header -->
            <div style="background:#1C3F2F;padding:36px 40px;border-radius:14px 14px 0 0;text-align:center">
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#7EC8A0;letter-spacing:.18em;text-transform:uppercase">Broker France</p>
              <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff;line-height:1.3">We've received your listing!</h1>
            </div>

            <!-- Body -->
            <div style="padding:36px 40px;border:1px solid #eee;border-top:none;border-radius:0 0 14px 14px">
              <p style="font-size:16px;color:#333;line-height:1.7;margin:0 0 24px">Hi <strong>${name}</strong>,</p>
              <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 24px">
                Thank you for submitting your property to <strong>Broker France</strong>. We have received your listing and our team will review it shortly.
              </p>

              <!-- Property Summary -->
              <div style="background:#f7f9f8;border-radius:10px;padding:20px 24px;margin-bottom:28px">
                <p style="margin:0 0 14px;font-size:11px;font-weight:700;color:#1C3F2F;letter-spacing:.12em;text-transform:uppercase">Your Submission Summary</p>
                <table style="width:100%;border-collapse:collapse">
                  ${type ? `<tr><td style="padding:7px 0;font-size:13px;color:#888;width:130px;border-bottom:1px solid #eee">Property Type</td><td style="padding:7px 0;font-size:14px;font-weight:600;color:#111;border-bottom:1px solid #eee">${type}</td></tr>` : ''}
                  ${location ? `<tr><td style="padding:7px 0;font-size:13px;color:#888;border-bottom:1px solid #eee">Location</td><td style="padding:7px 0;font-size:14px;font-weight:600;color:#111;border-bottom:1px solid #eee">${location}</td></tr>` : ''}
                  ${deal ? `<tr><td style="padding:7px 0;font-size:13px;color:#888;border-bottom:1px solid #eee">Deal Type</td><td style="padding:7px 0;font-size:14px;font-weight:600;color:#111;border-bottom:1px solid #eee">${deal}</td></tr>` : ''}
                  ${phone ? `<tr><td style="padding:7px 0;font-size:13px;color:#888">Contact</td><td style="padding:7px 0;font-size:14px;font-weight:600;color:#111">${phone}</td></tr>` : ''}
                </table>
              </div>

              <!-- What's Next -->
              <div style="border-left:3px solid #2D6A4F;padding-left:20px;margin-bottom:28px">
                <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#1C3F2F;text-transform:uppercase;letter-spacing:.08em">What happens next?</p>
                <p style="margin:0;font-size:14px;color:#555;line-height:1.7">Our team will review your listing and contact you within <strong>24 hours</strong> to verify details and get your property published on Broker France.</p>
              </div>

              <p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 28px">
                If you have any questions in the meantime, feel free to reply to this email or reach us at <a href="mailto:info@francebrokerage.com" style="color:#2D6A4F;font-weight:600">info@francebrokerage.com</a>.
              </p>

              <!-- CTA -->
              <div style="text-align:center;margin-bottom:28px">
                <a href="https://francebrokerage.com" style="display:inline-block;background:#1C3F2F;color:#fff;font-size:14px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:.02em">Visit Broker France</a>
              </div>

              <div style="border-top:1px solid #f0f0f0;padding-top:20px;text-align:center">
                <p style="margin:0;font-size:12px;color:#bbb">© Broker France · <a href="https://francebrokerage.com" style="color:#bbb">francebrokerage.com</a></p>
              </div>
            </div>

          </div>
        `,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Resend error:', err);
      return { statusCode: 500, body: JSON.stringify({ error: err }) };
    }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('confirm-submission error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
