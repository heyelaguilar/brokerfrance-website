// Shared helpers for the 201 Brookland billing dashboard (Google Sheets + Resend)
const crypto = require('crypto');

const SCHEMA = {
  Tenants:  ['id','tenant_name','trade_name','unit','floor','area_sqm','contact_person','email','cc_email','phone','tin',
             'monthly_rent','rent_vat','ewt_pct','cusa_mode','cusa_value','waste_fee','water_rate','elec_rate',
             'due_day','lease_start','lease_end','security_deposit','status','notes','updated'],
  Bills:    ['id','tenant_id','period','bill_date','due_date',
             'rent','rent_vat','cusa','water_prev','water_curr','water_rate','water_amt',
             'elec_prev','elec_curr','elec_rate','elec_amt','waste','other_label','other_amt','penalty','ewt',
             'total','status','sent_at','notes','updated'],
  Payments: ['id','tenant_id','date','amount','method','bank','reference','pdc_id','or_no','notes','by','updated'],
  PDCs:     ['id','tenant_id','check_no','bank','amount','check_date','for_period','status','deposited_date','cleared_date','payment_id','notes','updated'],
  EmailLog: ['id','date','tenant_id','type','to','cc','subject','status','by','updated'],
  Settings: ['id','value','updated'],
};
const TABS = Object.keys(SCHEMA);

const reply = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });
const newId = tab => tab.slice(0, 2).toUpperCase() + '-' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');

let cachedToken = null, tokenExp = 0;
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < tokenExp - 60) return cachedToken;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now,
  })).toString('base64url');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${sign.sign(sa.private_key, 'base64url')}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Google auth failed: ' + JSON.stringify(d).slice(0, 200));
  cachedToken = d.access_token; tokenExp = now + 3600;
  return cachedToken;
}

async function sheetsFromEnv() {
  const sheetId = process.env.BROOKLAND_SHEET_ID;
  if (!sheetId) return { error: 'BROOKLAND_SHEET_ID is not set in Netlify', setup: true };
  let sa;
  try { sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON); } catch { return { error: 'GOOGLE_SERVICE_ACCOUNT_JSON is missing' }; }
  const token = await getAccessToken(sa);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  const api = async (path, method = 'GET', body) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    if (!r.ok) throw new Error(`Sheets ${r.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };
  return { api, sa };
}

// Create missing tabs and append any missing header columns (never deletes).
async function ensureTabs(api) {
  const meta = await api('?fields=sheets.properties');
  const existing = Object.fromEntries(meta.sheets.map(s => [s.properties.title, s.properties.sheetId]));
  const missing = TABS.filter(t => !(t in existing));
  if (missing.length) {
    const res = await api(':batchUpdate', 'POST', { requests: missing.map(title => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) });
    res.replies.forEach((rep, i) => { existing[missing[i]] = rep.addSheet.properties.sheetId; });
  }
  const hdr = await api(`/values:batchGet?${TABS.map(t => `ranges=${encodeURIComponent(t + '!1:1')}`).join('&')}`);
  const data = [];
  hdr.valueRanges.forEach((vr, i) => {
    const have = (vr.values && vr.values[0]) || [];
    const want = [...have, ...SCHEMA[TABS[i]].filter(c => !have.includes(c))];
    if (want.length !== have.length) data.push({ range: `${TABS[i]}!A1`, values: [want] });
  });
  if (data.length) await api('/values:batchUpdate', 'POST', { valueInputOption: 'RAW', data });
  return existing;
}

async function loadAll(api) {
  const res = await api(`/values:batchGet?${TABS.map(t => `ranges=${encodeURIComponent(t)}`).join('&')}`);
  const out = {};
  res.valueRanges.forEach((vr, i) => {
    const rows = vr.values || [];
    const head = rows[0] || SCHEMA[TABS[i]];
    out[TABS[i]] = rows.slice(1).filter(r => r[0]).map(r => Object.fromEntries(head.map((h, j) => [h, r[j] ?? ''])));
  });
  return out;
}

const readSettings = data => Object.fromEntries((data.Settings || []).map(r => [r.id, r.value]));

// Manila calendar date, n days from now
const manilaDate = (n = 0) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const peso = v => '₱' + (parseFloat(String(v).replace(/[₱,]/g, '')) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// PDCs still on hand whose check date is within the reminder window (or already past)
function pdcDigest(data, settings) {
  const days = parseInt(settings.pdc_remind_days, 10) || 3;
  const limit = manilaDate(days), today = manilaDate(0);
  const name = id => (data.Tenants.find(t => t.id === id) || {}).tenant_name || '—';
  const due = data.PDCs.filter(p => (p.status || 'On hand') === 'On hand' && p.check_date && p.check_date <= limit)
    .sort((a, b) => a.check_date.localeCompare(b.check_date));
  const total = due.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const rows = due.map(p => `<tr>
    <td style="padding:8px;border-bottom:1px solid #eee;${p.check_date < today ? 'color:#B42318;font-weight:700' : ''}">${esc(p.check_date)}${p.check_date < today ? ' (past date)' : p.check_date === today ? ' (today)' : ''}</td>
    <td style="padding:8px;border-bottom:1px solid #eee">${esc(name(p.tenant_id))}</td>
    <td style="padding:8px;border-bottom:1px solid #eee">${esc(p.bank)} #${esc(p.check_no)}</td>
    <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${peso(p.amount)}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#111">
    <div style="background:#1C3F2F;color:#fff;padding:18px 24px;border-radius:10px 10px 0 0"><b style="font-size:17px">PDCs for deposit — 201 Brookland</b></div>
    <div style="border:1px solid #e5e5e5;border-top:none;padding:18px 24px;border-radius:0 0 10px 10px">
    <p style="margin:0 0 12px">${due.length} check(s) totaling <b>${peso(total)}</b> are dated on or before <b>${esc(limit)}</b>.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px"><tr style="background:#f4f6f8;text-align:left"><th style="padding:8px">Check date</th><th style="padding:8px">Tenant</th><th style="padding:8px">Bank / Check #</th><th style="padding:8px;text-align:right">Amount</th></tr>${rows}</table>
    <p style="margin:16px 0 0;font-size:13px;color:#444">Mark them as Deposited in the dashboard: https://francebrokerage.com/201-admin</p></div></div>`;
  return { count: due.length, total, html, subject: `PDC deposit reminder: ${due.length} check(s), ${peso(total)} — 201 Brookland` };
}

async function sendMail({ to, cc, subject, html, attachments, replyTo }) {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY is not set' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.BROOKLAND_FROM_EMAIL || '201 Brookland Building <billing@francebrokerage.com>',
      to, cc: cc && cc.length ? cc : undefined, reply_to: replyTo || undefined, subject, html, attachments,
    }),
  });
  if (r.ok) return { ok: true };
  return { ok: false, error: (await r.text()).slice(0, 300) };
}

module.exports = { SCHEMA, TABS, reply, newId, sheetsFromEnv, ensureTabs, loadAll, readSettings, pdcDigest, sendMail, manilaDate };
