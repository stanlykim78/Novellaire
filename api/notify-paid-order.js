// Vercel serverless function: sends a notification email to the seller when a paid order completes.
// Called from /order-confirmed.html on page load (paid mode), with the Stripe session_id from the URL.
//
// Pulls the order details from Stripe metadata so we don't trust the URL query string.
//
// Required env vars:
//   STRIPE_SECRET_KEY
//   RESEND_API_KEY
//   NOTIFICATION_EMAIL  (where notifications land — currently your stanly.kim78@gmail.com)
//
// Future-ready: once novellaire.com is verified in Resend, we'll also send a customer
// confirmation to session.customer_email from support@novellaire.com.

const Stripe = require('stripe');
const { Resend } = require('resend');

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function row(label, value) {
  if (!value) return '';
  return (
    '<tr>' +
      '<td style="padding:10px 14px; border-bottom:1px solid #1e293b; font-weight:600; color:#94a3b8; vertical-align:top; width:170px;">' + escapeHtml(label) + '</td>' +
      '<td style="padding:10px 14px; border-bottom:1px solid #1e293b; color:#f8fafc; word-break:break-word;">' + escapeHtml(value) + '</td>' +
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

  const sessionId = body.session_id;
  if (!sessionId || !/^cs_/.test(sessionId)) {
    return res.status(400).json({ error: 'Missing or invalid session_id' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!stripeKey) return res.status(500).json({ error: 'Server not configured: missing STRIPE_SECRET_KEY' });
  if (!resendKey) return res.status(500).json({ error: 'Server not configured: missing RESEND_API_KEY' });

  const stripe = Stripe(stripeKey);

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.error('Stripe retrieve error:', err);
    return res.status(400).json({ error: 'Could not fetch order from Stripe', detail: err.message });
  }

  if (session.payment_status !== 'paid') {
    return res.status(400).json({ error: 'Order is not yet paid', detail: 'payment_status=' + session.payment_status });
  }

  const meta = session.metadata || {};
  const tier = meta.tier || 'unknown';
  const tierLabel = tier === 'studio' ? 'Studio' : (tier === 'indie' ? 'Indie' : tier);
  const wordCount = meta.word_count ? Number(meta.word_count).toLocaleString() : '';
  const audioHours = meta.declared_audio_hours || '';
  const authorName = meta.author_name || '';
  const bookTitle = meta.book_title || '';
  const manuscriptLink = meta.manuscript_link || '';
  const narrator = meta.narrator_choice || '';
  const productionNotes = meta.production_notes || '';
  const customerEmail = session.customer_email || '';
  const amountPaidCents = session.amount_total || 0;
  const amountPaidUsd = '$' + (amountPaidCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const deliveryDays = tier === 'studio' ? '3 business days' : '5 business days';

  const recipient = process.env.NOTIFICATION_EMAIL || 'clinejefferson@gmail.com';
  const resend = new Resend(resendKey);

  // Notification email to Jeff
  const notifyHtml =
    '<!doctype html><html><body style="margin:0; padding:0; background:#020617; font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;">' +
      '<div style="max-width:640px; margin:0 auto; padding:32px 24px; background:#0f172a; color:#cbd5e1;">' +
        '<div style="font-size:0.72rem; font-weight:700; letter-spacing:0.18em; text-transform:uppercase; color:#f59e0b; margin-bottom:12px;">Paid Order Received</div>' +
        '<h2 style="font-family:Georgia,serif; font-size:1.6rem; color:#f8fafc; margin:0 0 8px 0;">New ' + escapeHtml(tierLabel) + ' order</h2>' +
        '<div style="font-size:1.4rem; font-weight:700; color:#f59e0b; margin-bottom:24px;">' + escapeHtml(amountPaidUsd) + ' &middot; deliver in ' + escapeHtml(deliveryDays) + '</div>' +
        '<table style="width:100%; border-collapse:collapse; background:#1e293b; border-radius:10px; overflow:hidden;">' +
          row('Author Name', authorName) +
          row('Author Email', customerEmail) +
          row('Book Title', bookTitle) +
          row('Manuscript Link', manuscriptLink) +
          row('Narrator Choice', narrator) +
          row('Tier', tierLabel) +
          row('Word Count', wordCount) +
          row('Audio Length', audioHours ? '~' + audioHours + ' hrs' : '') +
          row('Amount Paid', amountPaidUsd) +
          row('Production Notes', productionNotes) +
          row('Stripe Session ID', sessionId) +
        '</table>' +
        '<p style="margin-top:24px; font-size:0.85rem; color:#94a3b8;">Submitted via novellaire.com &middot; <a href="https://dashboard.stripe.com/payments/' + escapeHtml(sessionId) + '" style="color:#f59e0b;">View in Stripe</a></p>' +
      '</div>' +
    '</body></html>';

  const replyTo = customerEmail && /\S+@\S+\.\S+/.test(customerEmail) ? customerEmail : undefined;

  try {
    // 1) Notification email to Jeff (the seller)
    const notifyResult = await resend.emails.send({
      from: 'Novellaire <support@novellaire.com>',
      to: [recipient],
      replyTo,
      subject: 'Novellaire — Paid Order: ' + (bookTitle || authorName || tierLabel),
      html: notifyHtml,
    });

    if (notifyResult.error) {
      console.error('Notify-paid-order Resend error:', notifyResult.error);
      return res.status(500).json({ error: 'Notification email send failed', detail: notifyResult.error.message || String(notifyResult.error) });
    }

    // 2) Customer confirmation email (branded, friendly, sets expectations)
    if (customerEmail && /\S+@\S+\.\S+/.test(customerEmail)) {
      const firstName = (authorName || '').trim().split(/\s+/)[0] || 'there';
      const titleLine = bookTitle ? ('"' + bookTitle + '"') : 'your book';

      const customerHtml =
        '<!doctype html><html><body style="margin:0; padding:0; background:#020617; font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;">' +
          '<div style="max-width:600px; margin:0 auto; padding:32px 24px; background:#0f172a; color:#cbd5e1;">' +
            '<div style="font-family:Georgia,serif; font-size:1.6rem; color:#f59e0b; font-style:italic; margin-bottom:24px;">Novellaire</div>' +
            '<div style="color:#cbd5e1; font-size:1rem; line-height:1.7;">' +
              '<p>Hi ' + escapeHtml(firstName) + ',</p>' +
              '<p>Your ' + escapeHtml(tierLabel) + ' audiobook order for ' + escapeHtml(titleLine) + ' is confirmed and in production.</p>' +
              '<p><strong style="color:#f8fafc;">What happens next:</strong></p>' +
              '<ul style="padding-left:20px; line-height:1.8;">' +
                '<li>Your free first chapter arrives within <strong>5 business days</strong> for your approval.</li>' +
                '<li>Once approved, the full audiobook follows in <strong>' + escapeHtml(deliveryDays) + '</strong>.</li>' +
                '<li>You\'ll receive mastered chapter MP3s, ready for ACX, Audible, Spotify, or anywhere you distribute.</li>' +
              '</ul>' +
              '<p>If anything is unclear or you have additions to make, just reply to this email.</p>' +
              '<p style="margin-top:24px;">&mdash; The Novellaire team</p>' +
            '</div>' +
            '<div style="margin-top:32px; padding-top:20px; border-top:1px solid #1e293b; font-size:0.85rem; color:#94a3b8;">' +
              '<div style="margin-bottom:6px;"><strong style="color:#cbd5e1;">Order summary</strong></div>' +
              '<div>Tier: ' + escapeHtml(tierLabel) + '</div>' +
              (wordCount ? ('<div>Word count: ' + escapeHtml(wordCount) + '</div>') : '') +
              (audioHours ? ('<div>Audio length: ~' + escapeHtml(audioHours) + ' hrs</div>') : '') +
              '<div>Amount paid: ' + escapeHtml(amountPaidUsd) + '</div>' +
            '</div>' +
            '<p style="margin-top:32px; font-size:0.8rem; color:#64748b;">novellaire.com &middot; <a href="mailto:support@novellaire.com" style="color:#f59e0b;">support@novellaire.com</a></p>' +
          '</div>' +
        '</body></html>';

      try {
        const customerResult = await resend.emails.send({
          from: 'Novellaire <support@novellaire.com>',
          to: [customerEmail],
          replyTo: 'support@novellaire.com',
          subject: 'Order confirmed — your ' + tierLabel + ' audiobook is in production',
          html: customerHtml,
        });
        if (customerResult.error) console.error('Customer confirm send error:', customerResult.error);
      } catch (e) {
        console.error('Customer confirm exception:', e);
      }
    }

    return res.status(200).json({ ok: true, id: notifyResult.data && notifyResult.data.id });
  } catch (err) {
    console.error('notify-paid-order exception:', err);
    return res.status(500).json({ error: 'Could not send notification', detail: err.message || 'Unknown error' });
  }
};
