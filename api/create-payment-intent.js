// Vercel serverless function — creates a Stripe PaymentIntent
// STRIPE_SECRET_KEY lives in Vercel env vars — never committed to code.
// Supports multi-currency: amount is already in the target currency (converted on frontend).
// Zero-decimal currencies (JPY etc.) are passed as integers; all others as decimals.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Stripe zero-decimal currencies — amount is the whole unit, no *100 needed
const ZERO_DECIMAL = new Set([
  'bif','clp','gnf','jpy','kmf','krw','mga','pyg','rwf','ugx','vnd','vuv','xaf','xof','xpf'
]);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { amount, currency = 'eur' } = req.body || {};
  const cur = (currency || 'eur').toLowerCase();

  if (!amount || typeof amount !== 'number' || amount < 0.5) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  // Convert to Stripe's smallest unit
  const stripeAmount = ZERO_DECIMAL.has(cur) ? Math.round(amount) : Math.round(amount * 100);

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount:   stripeAmount,
      currency: cur,
      automatic_payment_methods: { enabled: true },
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret });

  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to create payment' });
  }
};
