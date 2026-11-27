// 201 Brookland CRM — Google Sheets backend for /201-admin
// Env vars (Netlify → Site settings → Environment variables):
//   GOOGLE_SERVICE_ACCOUNT_JSON  (already set for the main admin)
//   BROOKLAND_SHEET_ID           ID of the "201 Brookland CRM" Google Sheet (share it with the service account as Editor)
//   BROOKLAND_ALLOWED_EMAILS     optional, comma-separated emails allowed to use the CRM
const crypto = require('crypto');

const SCHEMA = {
  Spaces:     ['id','floor','unit','space_type','area_sqm','asking_rent','status','tenant_id','notes','updated'],
  Tenants:    ['id','tenant_name','business','contact_person','phone','email','space_id','monthly_rent','deposit','advance','lease_start','lease_end','escalation_pct','due_day','status','notes','updated'],
  Payments:   ['id','tenant_id','period','amount_due','amount_paid','date_paid','method','reference','status','notes','updated'],
  Leads:      ['id','lead_type','name','company','phone','email','interest','space_id','offer','stage','source','next_followup','owner','notes','created','updated'],
  Activities: ['id','date','related_type','related_id','activity','notes','next_action','next_date','by','updated'],
};
const TABS = Object.keys(SCHEMA);

const reply = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });

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

function sheetsApi(token, sheetId) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  return async (path, method = 'GET', body) => {
    const r = await fetch(base + path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Sheets ${r.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };
}

const colLetter = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

// Make sure every tab exists with the right header row. Adds missing columns at the end, never deletes.
async function ensureTabs(api) {
  const meta = await api('?fields=sheets.properties');
  const existing = Object.fromEntries(meta.sheets.map(s => [s.properties.title, s.properties.sheetId]));
  const missing = TABS.filter(t => !(t in existing));
  if (missing.length) {
    const res = await api(':batchUpdate', 'POST', { requests: missing.map(title => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) });
    res.replies.forEach((rep, i) => { existing[missing[i]] = rep.addSheet.properties.sheetId; });
  }
  const ranges = TABS.map(t => `ranges=${encodeURIComponent(t + '!1:1')}`).join('&');
  const hdr = await api(`/values:batchGet?${ranges}`);
  const data = [];
  hdr.valueRanges.forEach((vr, i) => {
    const tab = TABS[i];
    const have = (vr.values && vr.values[0]) || [];
    const want = [...have, ...SCHEMA[tab].filter(c => !have.includes(c))];
    if (want.length !== have.length) data.push({ range: `${tab}!A1`, values: [want] });
  });
  if (data.length) await api('/values:batchUpdate', 'POST', { valueInputOption: 'RAW', data });
  return existing;
}

async function loadAll(api) {
  const ranges = TABS.map(t => `ranges=${encodeURIComponent(t)}`).join('&');
  const res = await api(`/values:batchGet?${ranges}`);
  const out = {};
  res.valueRanges.forEach((vr, i) => {
    const rows = vr.values || [];
    const head = rows[0] || SCHEMA[TABS[i]];
    out[TABS[i]] = rows.slice(1).filter(r => r[0]).map(r => Object.fromEntries(head.map((h, j) => [h, r[j] ?? ''])));
  });
  return out;
}

async function findRow(api, tab, id) {
  const res = await api(`/values/${encodeURIComponent(tab + '!A:A')}`);
  const col = (res.values || []).map(r => r[0]);
  const idx = col.indexOf(String(id));
  return idx < 1 ? -1 : idx; // 0-based row index in sheet (0 = header)
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method Not Allowed' });

  const user = context.clientContext && context.clientContext.user;
  if (!user) return reply(401, { error: 'Not signed in' });
  const allowed = (process.env.BROOKLAND_ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes((user.email || '').toLowerCase())) return reply(403, { error: 'This account is not allowed to use the 201 Brookland CRM' });

  const sheetId = process.env.BROOKLAND_SHEET_ID;
  if (!sheetId) return reply(500, { error: 'BROOKLAND_SHEET_ID is not set in Netlify', setup: true });
  let sa;
  try { sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON); } catch { return reply(500, { error: 'GOOGLE_SERVICE_ACCOUNT_JSON is missing' }); }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }

  try {
    const api = sheetsApi(await getAccessToken(sa), sheetId);

    if (body.action === 'load') {
      await ensureTabs(api);
      return reply(200, { ok: true, schema: SCHEMA, data: await loadAll(api), serviceAccount: sa.client_email });
    }

    const tab = body.tab;
    if (!TABS.includes(tab)) return reply(400, { error: 'Unknown tab' });

    if (body.action === 'save') {
      const row = { ...(body.row || {}) };
      row.updated = new Date().toISOString();
      if (tab === 'Leads' && !row.created) row.created = row.updated.slice(0, 10);
      const head = (await api(`/values/${encodeURIComponent(tab + '!1:1')}`)).values?.[0] || SCHEMA[tab];
      let rowIdx = row.id ? await findRow(api, tab, row.id) : -1;
      if (!row.id) row.id = tab.slice(0, 2).toUpperCase() + '-' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
      const values = [head.map(h => row[h] == null ? '' : String(row[h]))];
      if (rowIdx > 0) {
        await api(`/values/${encodeURIComponent(`${tab}!A${rowIdx + 1}:${colLetter(head.length - 1)}${rowIdx + 1}`)}?valueInputOption=RAW`, 'PUT', { values });
      } else {
        await api(`/values/${encodeURIComponent(tab + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, 'POST', { values });
      }
      console.log(`brookland ${tab} ${row.id} saved by ${user.email}`);
      return reply(200, { ok: true, row });
    }

    if (body.action === 'remove') {
      const ids = await ensureTabs(api);
      const rowIdx = await findRow(api, tab, body.id);
      if (rowIdx < 1) return reply(404, { error: 'Row not found' });
      await api(':batchUpdate', 'POST', { requests: [{ deleteDimension: { range: { sheetId: ids[tab], dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 } } }] });
      console.log(`brookland ${tab} ${body.id} deleted by ${user.email}`);
      return reply(200, { ok: true });
    }

    return reply(400, { error: 'Unknown action' });
  } catch (err) {
    console.error('brookland-crm error:', err.message);
    return reply(500, { error: err.message });
  }
};
