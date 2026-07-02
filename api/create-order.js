// Vercel serverless function — proxies order to Prodigi API
// API key lives in Vercel env var PRODIGI_API_KEY — never committed to code.
//
// Confirmed Prodigi SKUs used by this function:
//   Print (Hahnemühle Photo Rag):  GLOBAL-HPR-12X16 / 20X28 / 28X40
//   Classic Frame:                 GLOBAL-CFP-12X16 / 20X28 / 28X40
//   Color attribute values:        Black, White, Natural, Antique Silver,
//                                  Antique Gold, Dark Grey, Light Grey, Brown

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.PRODIGI_API_KEY;
  if (!apiKey) {
    console.error('PRODIGI_API_KEY env var is not set');
    return res.status(500).json({ error: 'Print service not configured' });
  }

  const { items, recipient, shippingMethod } = req.body || {};

  // Basic validation
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'No items in order' });
  }
  if (!recipient?.name || !recipient?.address?.line1 ||
      !recipient?.address?.townOrCity || !recipient?.address?.postalOrZipCode ||
      !recipient?.address?.countryCode) {
    return res.status(400).json({ error: 'Incomplete shipping address' });
  }

  const merchantRef = `ete-${Date.now()}`;

  const orderPayload = {
    merchantReference: merchantRef,
    shippingMethod:    shippingMethod || 'Standard',
    recipient: {
      name: recipient.name,
      ...(recipient.email              ? { email:             recipient.email }              : {}),
      ...(recipient.phone              ? { mobilePhoneNumber: recipient.phone }              : {}),
      address: {
        line1:            recipient.address.line1,
        ...(recipient.address.line2        ? { line2:        recipient.address.line2 }        : {}),
        townOrCity:       recipient.address.townOrCity,
        postalOrZipCode:  recipient.address.postalOrZipCode,
        countryCode:      recipient.address.countryCode,
        ...(recipient.address.stateOrCounty ? { stateOrCounty: recipient.address.stateOrCounty } : {})
      }
    },
    items: items.map((item, idx) => ({
      merchantReference: `item-${idx + 1}`,
      sku:    item.sku,
      copies: item.qty || 1,
      sizing: 'fitPrintArea',
      // Only include attributes if there are any (frame color etc.)
      ...(item.attributes && Object.keys(item.attributes).length
        ? { attributes: item.attributes }
        : {}),
      assets: [{ printArea: 'default', url: item.assetUrl }]
    }))
  };

  try {
    const response = await fetch('https://api.prodigi.com/v4.0/orders', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key':    apiKey
      },
      body: JSON.stringify(orderPayload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Prodigi error:', JSON.stringify(data));
      return res.status(response.status).json({
        error: data.detail || data.message || 'Order creation failed'
      });
    }

    return res.status(200).json({
      orderId:           data.id || data.order?.id,
      status:            data.status?.stage,
      merchantReference: merchantRef
    });

  } catch (err) {
    console.error('Prodigi fetch error:', err.message);
    return res.status(500).json({ error: 'Failed to connect to print service' });
  }
};
