// Vercel serverless function: sends a Novellaire inquiry email via Resend.
//
// Required env vars:
//   RESEND_API_KEY      — from https://resend.com (Settings → API Keys)
//   NOTIFICATION_EMAIL  — where inquiries land (default: clinejefferson@gmail.com)
//                         Swap to support@novellaire.com once forwarding is live.
//
// Called by /order.html for free-chapter and custom-inquiry submissions.

const { Resend } = require('resend');

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fieldRow(label, value) {
  if (!value) return '';
  return (
    '<tr>' +
      '<td style="padding:10px 14px; border-bottom:1px solid #1e293b; font-weight:600; color:#94a3b8; vertical-align:top; width:170px;">' +
        escapeHtml(label) +
      '</td>' +
      '<td style="padding:10px 14px; border-bottom:1px solid #1e293b; color:#f8fafc; word-break:break-word;">' +
        escapeHtml(value) +
      '</td>' +
    '</tr>'
  );
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const { type } = body;
  if (type !== 'free' && type !== 'custom') {
    return res.status(400).json({ error: 'Invalid inquiry type (must be "free" or "custom")' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server not configured: missing RESEND_API_KEY env var.' });
  }

  const recipient = process.env.NOTIFICATION_EMAIL || 'clinejefferson@gmail.com';
  const resend = new Resend(apiKey);

  // Build the email
  const isFree = type === 'free';
  const subject = isFree
    ? 'Novellaire — Free First Chapter Request'
    : 'Novellaire — Custom Inquiry';

  let rows;
  if (isFree) {
    rows =
      fieldRow('Author Name', body.authorName) +
      fieldRow('Email', body.authorEmail) +
      fieldRow('Book Title', body.bookTitle) +
      fieldRow('Manuscript Link', body.manuscriptLink) +
      fieldRow('Narrator Choice', body.narratorChoice) +
      fieldRow('Word Count (declared)', body.wordCount ? Number(body.wordCount).toLocaleString() : '') +
      fieldRow('Production Notes', body.notes);
  } else {
    rows =
      fieldRow('Author Name', body.authorName) +
      fieldRow('Email', body.authorEmail) +
      fieldRow('Message', body.customMessage);
  }

  const headerLabel = isFree ? 'Free First Chapter Request' : 'Custom Inquiry';
  const html =
    '<!doctype html><html><body style="margin:0; padding:0; background:#020617; font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;">' +
      '<div style="max-width:640px; margin:0 auto; padding:32px 24px; background:#0f172a; color:#cbd5e1;">' +
        '<div style="font-size:0.72rem; font-weight:700; letter-spacing:0.18em; text-transform:uppercase; color:#f59e0b; margin-bottom:12px;">' +
          escapeHtml(headerLabel) +
        '</div>' +
        '<h2 style="font-family:Georgia,serif; font-size:1.6rem; color:#f8fafc; margin:0 0 24px 0;">New ' + (isFree ? 'free first chapter request' : 'inquiry') + '</h2>' +
        '<table style="width:100%; border-collapse:collapse; background:#1e293b; border-radius:10px; overflow:hidden;">' +
          rows +
        '</table>' +
        '<p style="margin-top:24px; font-size:0.85rem; color:#94a3b8;">Submitted via novellaire.com</p>' +
      '</div>' +
    '</body></html>';

  const replyTo = body.authorEmail && /\S+@\S+\.\S+/.test(body.authorEmail) ? body.authorEmail : undefined;

  try {
    const result = await resend.emails.send({
      from: 'Novellaire <onboarding@resend.dev>',
      to: [recipient],
      replyTo,
      subject,
      html,
    });

    if (result.error) {
      console.error('Resend error:', result.error);
      return res.status(500).json({ error: 'Email send failed', detail: result.error.message || String(result.error) });
    }

    return res.status(200).json({ ok: true, id: result.data && result.data.id });
  } catch (err) {
    console.error('send-inquiry exception:', err);
    return res.status(500).json({ error: 'Could not send email', detail: err.message || 'Unknown error' });
  }
};
