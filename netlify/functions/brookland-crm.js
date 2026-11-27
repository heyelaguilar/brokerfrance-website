// 201 Brookland — Tenant billing & collections backend for /201-admin
// Storage: a dedicated Google Sheet (tabs are created automatically on first load).
// Env vars (Netlify → Site configuration → Environment variables):
//   GOOGLE_SERVICE_ACCOUNT_JSON  already set for the main admin
//   BROOKLAND_SHEET_ID           ID of the "201 Brookland CRM" Google Sheet (share it with the service account as Editor)
//   RESEND_API_KEY               already set — used to email SOAs and PDC reminders
//   BROOKLAND_FROM_EMAIL         optional, default "201 Brookland Building <billing@francebrokerage.com>"
//   BROOKLAND_ALLOWED_EMAILS     optional, comma-separated logins allowed to use the dashboard
const { SCHEMA, TABS, reply, sheetsFromEnv, ensureTabs, loadAll, readSettings, pdcDigest, sendMail, newId } = require('../lib/brookland-sheet');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method Not Allowed' });

  const user = context.clientContext && context.clientContext.user;
  if (!user) return reply(401, { error: 'Not signed in' });
  const allowed = (process.env.BROOKLAND_ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes((user.email || '').toLowerCase())) return reply(403, { error: 'This account is not allowed to use the 201 Brookland dashboard' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }

  try {
    const { api, sa, error, setup } = await sheetsFromEnv();
    if (error) return reply(500, { error, setup });
    const by = user.email || '';

    if (body.action === 'load') {
      await ensureTabs(api);
      return reply(200, { ok: true, data: await loadAll(api), serviceAccount: sa.client_email, user: by });
    }

    if (body.action === 'sendSOA' || body.action === 'sendPdcReminder') {
      const data = await loadAll(api);
      const settings = readSettings(data);
      let to, cc = [], subject, html, attachments, tenantId = '', type;
      if (body.action === 'sendSOA') {
        const t = data.Tenants.find(x => x.id === body.tenant_id);
        if (!t) return reply(404, { error: 'Tenant not found' });
        to = split(t.email);
        cc = split(t.cc_email).concat(split(settings.soa_cc));
        if (!to.length) return reply(400, { error: `${t.tenant_name} has no email address on file` });
        subject = String(body.subject || '').slice(0, 200);
        html = String(body.html || '');
        if (body.pdf_base64) attachments = [{ filename: String(body.filename || 'SOA.pdf').replace(/[^\w.\- ]/g, ''), content: body.pdf_base64 }];
        tenantId = t.id; type = 'SOA ' + (body.period || '');
      } else {
        const d = pdcDigest(data, settings);
        to = split(settings.notify_emails || by);
        if (!to.length) return reply(400, { error: 'Set "PDC reminder recipients" in Settings' });
        if (!d.count) return reply(200, { ok: true, skipped: true, message: 'No PDCs due for deposit' });
        subject = d.subject; html = d.html; type = 'PDC reminder';
      }
      const res = await sendMail({ to, cc, subject, html, attachments, replyTo: settings.reply_to });
      const log = { id: newId('EmailLog'), date: new Date().toISOString(), tenant_id: tenantId, type, to: to.join(', '), cc: cc.join(', '), subject, status: res.ok ? 'Sent' : 'Failed: ' + res.error, by };
      await saveRows(api, 'EmailLog', [log]);
      if (!res.ok) return reply(502, { error: 'Email failed: ' + res.error, log });
      if (body.bill_id) {
        const bill = data.Bills.find(b => b.id === body.bill_id);
        if (bill) await saveRows(api, 'Bills', [{ ...bill, status: 'Sent', sent_at: log.date }]);
      }
      return reply(200, { ok: true, log });
    }

    const tab = body.tab;
    if (!TABS.includes(tab)) return reply(400, { error: 'Unknown tab' });

    if (body.action === 'save' || body.action === 'saveMany') {
      const rows = body.action === 'save' ? [body.row || {}] : (body.rows || []);
      if (!rows.length) return reply(400, { error: 'Nothing to save' });
      if (rows.length > 300) return reply(400, { error: 'Too many rows at once' });
      const saved = await saveRows(api, tab, rows);
      console.log(`brookland ${tab} x${saved.length} saved by ${by}`);
      return reply(200, { ok: true, row: saved[0], rows: saved });
    }

    if (body.action === 'remove') {
      const ids = await ensureTabs(api);
      const col = (await api(`/values/${encodeURIComponent(tab + '!A:A')}`)).values || [];
      const idx = col.findIndex(r => r[0] === String(body.id));
      if (idx < 1) return reply(404, { error: 'Row not found' });
      await api(':batchUpdate', 'POST', { requests: [{ deleteDimension: { range: { sheetId: ids[tab], dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 } } }] });
      console.log(`brookland ${tab} ${body.id} deleted by ${by}`);
      return reply(200, { ok: true });
    }

    return reply(400, { error: 'Unknown action' });
  } catch (err) {
    console.error('brookland-crm error:', err.message);
    return reply(500, { error: err.message });
  }
};

const split = s => String(s || '').split(/[,;\s]+/).map(x => x.trim()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));

const colLetter = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

// Upsert by id: existing ids are overwritten in place, new rows appended in one call.
async function saveRows(api, tab, rows) {
  const head = (await api(`/values/${encodeURIComponent(tab + '!1:1')}`)).values?.[0] || SCHEMA[tab];
  const ids = ((await api(`/values/${encodeURIComponent(tab + '!A:A')}`)).values || []).map(r => r[0]);
  const now = new Date().toISOString();
  const updates = [], appends = [], out = [];
  for (const r of rows) {
    const row = { ...r, updated: now };
    if (!row.id) row.id = newId(tab);
    const values = head.map(h => row[h] == null ? '' : String(row[h]));
    const idx = ids.indexOf(String(row.id));
    if (idx > 0) updates.push({ range: `${tab}!A${idx + 1}:${colLetter(head.length - 1)}${idx + 1}`, values: [values] });
    else { appends.push(values); ids.push(String(row.id)); }
    out.push(row);
  }
  if (updates.length) await api('/values:batchUpdate', 'POST', { valueInputOption: 'RAW', data: updates });
  if (appends.length) await api(`/values/${encodeURIComponent(tab + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, 'POST', { values: appends });
  return out;
}
