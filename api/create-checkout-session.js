// Vercel serverless function: creates a Stripe Checkout Session for an audiobook order.
// Called from the Order Now buttons on the marketing site.
//
// Required env var: STRIPE_SECRET_KEY  (Stripe → Developers → API keys → Secret key)
//
// Pricing math (matches the website estimator):
//   - Standard: 9,300 finished words per hour
//   - Indie:  $40/hr equivalent (~$0.0043/word), rounded to nearest $5
//   - Studio: $80/hr equivalent (~$0.0086/word), rounded to nearest $5
//   - Minimum order: $50

const Stripe = require('stripe');

module.exports = async (req, res) => {
  // Permissive CORS — site is same-origin in production but easier for testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Vercel parses JSON bodies automatically when Content-Type is application/json
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const {
    tier,
    wordCount,
    authorName,
    authorEmail,
    bookTitle,
    manuscriptLink,
    narratorChoice,
    notes,
  } = body;

  // Validate tier
  if (tier !== 'indie' && tier !== 'studio') {
    return res.status(400).json({ error: 'Invalid tier (must be "indie" or "studio")' });
  }

  // Validate word count
  const wc = parseInt(wordCount, 10);
  if (!Number.isFinite(wc) || wc < 5000 || wc > 500000) {
    return res.status(400).json({
      error: 'Word count must be between 5,000 and 500,000. Reach out for shorter or longer projects.',
    });
  }

  // Calculate price
  const hourlyRate = tier === 'studio' ? 80 : 40;
  const hours = wc / 9300;
  const rawPrice = hours * hourlyRate;
  const priceUsd = Math.round(rawPrice / 5) * 5; // nearest $5
  const priceCents = priceUsd * 100;

  if (priceCents < 5000) {
    return res.status(400).json({ error: 'Minimum order is $50' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ error: 'Server not configured: missing STRIPE_SECRET_KEY env var.' });
  }

  const stripe = Stripe(secretKey);

  const tierLabel = tier === 'studio' ? 'Studio' : 'Indie';
  const audioHrs = (Math.round(hours * 2) / 2).toFixed(1).replace(/\.0$/, '');
  const origin = req.headers.origin || 'https://novellaire.com';

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: authorEmail || undefined,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Novellaire ${tierLabel} Audiobook Production`,
            description: `${wc.toLocaleString()} words → ~${audioHrs} hours of audio. Includes manuscript-level validation, mastered chapter MP3 files (HD 48kHz), and full ownership of master files. Final word count verified within ±10% of declared.`,
          },
          unit_amount: priceCents,
        },
        quantity: 1,
      }],
      success_url: `${origin}/order-confirmed.html?session_id={CHECKOUT_SESSION_ID}&tier=${encodeURIComponent(tier)}&amount=${priceUsd}&wc=${wc}&hours=${encodeURIComponent(audioHrs)}`,
      cancel_url: `${origin}/#pricing`,
      metadata: {
        tier,
        word_count: String(wc),
        declared_audio_hours: audioHrs,
        author_name: (authorName || '').slice(0, 480),
        book_title: (bookTitle || '').slice(0, 480),
        manuscript_link: (manuscriptLink || '').slice(0, 480),
        narrator_choice: (narratorChoice || '').slice(0, 100),
        production_notes: (notes || '').slice(0, 480),
      },
    });

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({
      error: 'Payment session creation failed.',
      detail: err.message || 'Unknown error',
    });
  }
};
