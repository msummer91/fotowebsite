// Vercel serverless function — fetches a shipping cost quote from Prodigi
// Accepts POST: { items: [{sku, qty, attributes}], countryCode, shippingMethod }
// Returns: { shippingCost } in EUR
//
// Prodigi quote endpoint: POST /v4.0/quotes
// Response shape: { outcome: "Created", quotes: [{ shipmentMethod, costSummary: { shipping: { amount, currency } } }] }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.PRODIGI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Print service not configured' });

  const { items, countryCode, shippingMethod = 'Standard' } = req.body || {};
  if (!Array.isArray(items) || !items.length || !countryCode) {
    return res.status(400).json({ error: 'Missing items or countryCode' });
  }

  const quotePayload = {
    shippingMethod,
    destinationCountryCode: countryCode,
    items: items.map(item => ({
      sku:    item.sku,
      copies: item.qty || 1,
      assets: [{ printArea: 'default' }],
      ...(item.attributes && Object.keys(item.attributes).length
        ? { attributes: item.attributes }
        : {}),
    }))
  };

  // Log full request for debugging
  console.log('[get-shipping-quote] request:', JSON.stringify(quotePayload));

  try {
    const prodigiBase = process.env.PRODIGI_SANDBOX === 'true'
      ? 'https://api.sandbox.prodigi.com/v4.0'
      : 'https://api.prodigi.com/v4.0';
    const response = await fetch(`${prodigiBase}/quotes`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body:    JSON.stringify(quotePayload)
    });

    const data = await response.json();
    // Log full response for debugging
    console.log('[get-shipping-quote] status:', response.status, 'body:', JSON.stringify(data));

    if (!response.ok) {
      // Extract the real Prodigi error — avoid traceParent (that's just a trace ID, not the error)
      const errDetail = data?.detail || data?.title
        || (data?.errors ? JSON.stringify(data.errors) : null)
        || (data?.validationIssues ? JSON.stringify(data.validationIssues) : null)
        || JSON.stringify(data).slice(0, 300);
      return res.status(response.status).json({ error: `Prodigi ${response.status}: ${errDetail}` });
    }

    // Prodigi v4.0: { outcome, quotes: [{ shipmentMethod, costSummary: { shipping: { amount } } }] }
    if (!Array.isArray(data.quotes) || data.quotes.length === 0) {
      // Express may not be available for this destination — return null so frontend can handle
      console.warn('[get-shipping-quote] Empty quotes array for', shippingMethod, countryCode);
      return res.status(200).json({ shippingCost: null, unavailable: true });
    }

    const quote    = data.quotes[0];
    const shipping = quote?.costSummary?.shipping?.amount ?? null;

    if (shipping === null) {
      console.error('[get-shipping-quote] No shipping amount in quote:', JSON.stringify(quote));
      return res.status(502).json({ error: 'No shipping cost in quote response' });
    }

    return res.status(200).json({ shippingCost: parseFloat(shipping) });

  } catch (err) {
    console.error('[get-shipping-quote] fetch error:', err.message);
    return res.status(500).json({ error: 'Failed to connect to print service' });
  }
};
