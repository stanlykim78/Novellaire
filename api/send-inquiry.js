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
    // 1) Notification email to Jeff (the seller)
    const result = await resend.emails.send({
      from: 'Novellaire <support@novellaire.com>',
      to: [recipient],
      replyTo,
      subject,
      html,
    });

    if (result.error) {
      console.error('Resend error:', result.error);
      return res.status(500).json({ error: 'Email send failed', detail: result.error.message || String(result.error) });
    }

    // 2) Customer confirmation email (only if author provided a valid email)
    if (replyTo) {
      const firstName = (body.authorName || '').trim().split(/\s+/)[0] || 'there';
      const customerSubject = isFree
        ? 'Your free first chapter is on the way — Novellaire'
        : 'We got your message — Novellaire';

      const customerBodyHtml = isFree
        ? (
          '<p>Hi ' + escapeHtml(firstName) + ',</p>' +
          '<p>Thanks for sending your manuscript. Your free first chapter is now in our production queue, and you\'ll have it within <strong>5 business days</strong>.</p>' +
          '<p>If you decide to move forward with the full audiobook after listening, just reply to this email and we\'ll get you set up &mdash; or place your order any time at <a href="https://novellaire.com/order.html" style="color:#f59e0b;">novellaire.com/order</a>.</p>' +
          '<p style="margin-top:24px;">&mdash; The Novellaire team</p>'
        )
        : (
          '<p>Hi ' + escapeHtml(firstName) + ',</p>' +
          '<p>Thanks for reaching out. Your message has landed and we\'ll get back to you within 1 business day.</p>' +
          '<p style="margin-top:24px;">&mdash; The Novellaire team</p>'
        );

      const customerHtml =
        '<!doctype html><html><body style="margin:0; padding:0; background:#020617; font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;">' +
          '<div style="max-width:600px; margin:0 auto; padding:32px 24px; background:#0f172a; color:#cbd5e1;">' +
            '<div style="font-family:Georgia,serif; font-size:1.6rem; color:#f59e0b; font-style:italic; margin-bottom:24px;">Novellaire</div>' +
            '<div style="color:#cbd5e1; font-size:1rem; line-height:1.7;">' + customerBodyHtml + '</div>' +
            '<p style="margin-top:32px; font-size:0.8rem; color:#64748b;">novellaire.com &middot; <a href="mailto:support@novellaire.com" style="color:#f59e0b;">support@novellaire.com</a></p>' +
          '</div>' +
        '</body></html>';

      // Don't fail the whole request if customer confirm fails — log and continue.
      try {
        const customerResult = await resend.emails.send({
          from: 'Novellaire <support@novellaire.com>',
          to: [body.authorEmail],
          replyTo: 'support@novellaire.com',
          subject: customerSubject,
          html: customerHtml,
        });
        if (customerResult.error) console.error('Customer confirm send error:', customerResult.error);
      } catch (e) {
        console.error('Customer confirm exception:', e);
      }
    }

    return res.status(200).json({ ok: true, id: result.data && result.data.id });
  } catch (err) {
    console.error('send-inquiry exception:', err);
    return res.status(500).json({ error: 'Could not send email', detail: err.message || 'Unknown error' });
  }
};
