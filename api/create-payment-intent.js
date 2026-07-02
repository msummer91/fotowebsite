// Vercel serverless function — creates a Stripe PaymentIntent
// STRIPE_SECRET_KEY lives in Vercel env vars — never committed to code.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { amount, currency = 'eur' } = req.body || {};

  if (!amount || typeof amount !== 'number' || amount < 1) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(amount * 100), // euros → cents
      currency,
      automatic_payment_methods: { enabled: true },
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret });

  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to create payment' });
  }
};
