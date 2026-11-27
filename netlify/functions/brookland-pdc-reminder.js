// Daily PDC deposit reminder for 201 Brookland.
// Schedule is set in netlify.toml (8:00 AM Manila). Emails the "PDC reminder recipients"
// from the dashboard Settings when on-hand checks are due within the reminder window.
const { reply, sheetsFromEnv, ensureTabs, loadAll, readSettings, pdcDigest, sendMail, newId } = require('../lib/brookland-sheet');

exports.handler = async () => {
  try {
    const { api, error } = await sheetsFromEnv();
    if (error) { console.log('pdc-reminder skipped:', error); return reply(200, { skipped: error }); }
    await ensureTabs(api);
    const data = await loadAll(api);
    const settings = readSettings(data);
    if (String(settings.pdc_daily_email).toLowerCase() === 'off') return reply(200, { skipped: 'daily email off' });
    const to = String(settings.notify_emails || '').split(/[,;\s]+/).filter(x => x.includes('@'));
    if (!to.length) return reply(200, { skipped: 'no recipients set' });
    const d = pdcDigest(data, settings);
    if (!d.count) return reply(200, { skipped: 'nothing due' });
    const res = await sendMail({ to, subject: d.subject, html: d.html, replyTo: settings.reply_to });
    const log = [newId('EmailLog'), new Date().toISOString(), '', 'PDC reminder (auto)', to.join(', '), '', d.subject, res.ok ? 'Sent' : 'Failed: ' + res.error, 'scheduler', new Date().toISOString()];
    await api(`/values/${encodeURIComponent('EmailLog!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, 'POST', { values: [log] });
    console.log('pdc-reminder', res.ok ? 'sent' : res.error, d.count);
    return reply(200, { ok: res.ok, count: d.count });
  } catch (err) {
    console.error('pdc-reminder error:', err.message);
    return reply(500, { error: err.message });
  }
};
