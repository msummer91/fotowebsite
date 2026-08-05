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
    items: items.map((item, idx) => ({
      merchantReference: `item-${idx + 1}`,
      sku:    item.sku,
      copies: item.qty || 1,
      // assets required by Prodigi even for quotes (no URL needed)
      assets: [{ printArea: 'default' }],
      ...(item.attributes && Object.keys(item.attributes).length
        ? { attributes: item.attributes }
        : {}),
    }))
  };

  try {
    const response = await fetch('https://api.prodigi.com/v4.0/quotes', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body:    JSON.stringify(quotePayload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[get-shipping-quote] Prodigi error:', JSON.stringify(data));
      return res.status(response.status).json({ error: data.detail || data.message || 'Quote failed' });
    }

    // Prodigi v4.0: response.quotes is an array; quotes[0] is the requested shippingMethod
    const quote    = Array.isArray(data.quotes) ? data.quotes[0] : null;
    const shipping = quote?.costSummary?.shipping?.amount ?? null;

    if (shipping === null) {
      console.error('[get-shipping-quote] Unexpected response shape:', JSON.stringify(data).slice(0, 500));
      return res.status(502).json({ error: 'Unexpected response from print service' });
    }

    return res.status(200).json({ shippingCost: parseFloat(shipping) });

  } catch (err) {
    console.error('[get-shipping-quote] fetch error:', err.message);
    return res.status(500).json({ error: 'Failed to connect to print service' });
  }
};
