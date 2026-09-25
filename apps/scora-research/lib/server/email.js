// Resend transactional email helper. No-ops gracefully when RESEND_KEY is unset so
// the cron never fails just because email isn't configured yet.
//   Env:
//     RESEND_KEY   — Resend API key (https://resend.com, free tier 3k/mo, 100/day)
//     RESEND_FROM  — verified sender, e.g. "Scora Alerts <alerts@yourdomain.com>".
//                    Until you verify a domain, Resend only lets you send from
//                    onboarding@resend.dev to your own account email.

export async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_KEY;
  if (!key) return { ok: false, skipped: true, reason: 'RESEND_KEY unset' };
  const from = process.env.RESEND_FROM || 'Scora Research <onboarding@resend.dev>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!r.ok) return { ok: false, status: r.status, body: await r.text().catch(() => '') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Wraps alert lines in a minimal, client-safe HTML shell (inline styles only). */
export function alertEmailHtml(messages, snapshotDate) {
  const rows = messages
    .map(
      (m) =>
        `<tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;font-size:14px;line-height:1.5;color:#0f172a">${escapeHtml(m)}</td></tr>`
    )
    .join('');
  return `<!DOCTYPE html><html><body style="margin:0;background:#f8fafc;font-family:'Segoe UI',system-ui,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:4px">Scora Research — Macro Alert</div>
    <div style="font-size:12px;color:#64748b;margin-bottom:16px">Triggered ${escapeHtml(snapshotDate || new Date().toISOString().slice(0, 10))}</div>
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">${rows}</table>
    <div style="font-size:11px;color:#94a3b8;margin-top:16px;line-height:1.6">
      Educational information only, not investment advice. You are receiving this because you enabled macro alerts in Scora Research.
    </div>
  </div></body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
