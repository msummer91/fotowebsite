// Vercel serverless function — proxies order to Prodigi API + sends confirmation email via Resend
// API key lives in Vercel env var PRODIGI_API_KEY — never committed to code.
// Resend key lives in Vercel env var RESEND_API_KEY — never committed to code.
//
// Confirmed Prodigi SKUs used by this function:
//   Hahnemühle Photo Rag (unframed): GLOBAL-HPR-A5 / A4 / A3 / A2 / A1 / A0
//   Lustre Photo Paper (unframed):   GLOBAL-PAP-A5 / A4 / A3 / A2 / A1 / A0
//   Box Frame with mount (framed):   GLOBAL-BOXM-A5 / A4 / A3 / A2 / A1 / A0
//     EMA 200gsm · Acrylic glaze · 2.4mm mount · fulfilled UK/EU/US/AU
//   Frame colour attribute:  Black | Natural | White
//   Mount colour attribute:  Snow white | Black | Off-white

// ── EMAIL TEMPLATES ──────────────────────────────────────────────────────────

function formatPrice(eur) {
  return `€${Number(eur).toFixed(2)}`;
}

function itemsTableHtml(displayItems) {
  return displayItems.map(item => `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #e8e8e6;vertical-align:top;">
        <table cellpadding="0" cellspacing="0"><tr>
          ${item.imgUrl ? `<td style="padding-right:14px;vertical-align:top;">
            <img src="${item.imgUrl}" alt="${item.name}" width="64" height="64" style="display:block;width:64px;height:64px;object-fit:cover;border:1px solid #e8e8e6;">
          </td>` : ''}
          <td style="vertical-align:top;">
            <div style="font-size:14px;font-weight:600;color:#1a1a1a;">${item.name}</div>
            <div style="font-size:12px;color:#666;margin-top:3px;">${item.size} · ${item.detail}</div>
            ${item.qty > 1 ? `<div style="font-size:12px;color:#666;margin-top:2px;">Qty: ${item.qty}</div>` : ''}
          </td>
        </tr></table>
      </td>
      <td style="padding:14px 0 14px 20px;border-bottom:1px solid #e8e8e6;text-align:right;white-space:nowrap;vertical-align:top;font-size:14px;color:#1a1a1a;">
        ${formatPrice(item.price * item.qty)}
      </td>
    </tr>`).join('');
}

function buildConfirmationEmail({ name, email, displayItems, shippingCost, merchantRef, lang }) {
  const isDE = lang === 'de';
  const subtotal = displayItems.reduce((s, i) => s + (i.price * i.qty), 0);
  const total = subtotal + (shippingCost || 0);
  // Show only the human-readable prefix (ete-<timestamp>), not the base64 payload
  const displayRef = merchantRef.split('-').slice(0, 2).join('-');

  const subject = isDE
    ? `Bestellung bestätigt – été collectif (#${displayRef})`
    : `Order confirmed – été collectif (#${displayRef})`;

  const greeting = isDE
    ? `Hallo ${name.split(' ')[0]},`
    : `Hi ${name.split(' ')[0]},`;

  const intro = isDE
    ? `vielen Dank für deine Bestellung! Wir haben sie erhalten und beginnen gleich mit der Produktion deines Drucks. Du erhältst eine separate E-Mail, sobald dein Paket unterwegs ist.`
    : `thank you for your order! We've received it and will begin producing your print right away. You'll get a separate email as soon as your package ships.`;

  const orderLabel   = isDE ? 'Bestellreferenz' : 'Order reference';
  const itemsLabel   = isDE ? 'Deine Bestellung' : 'Your order';
  const shippingLabel = isDE ? 'Versand' : 'Shipping';
  const totalLabel   = isDE ? 'Gesamt' : 'Total';
  const deliveryLabel = isDE ? 'Lieferzeit' : 'Estimated delivery';
  const deliveryNote = isDE
    ? '4–10 Werktage (je nach Region)'
    : '4–10 business days (depending on region)';
  const questionLabel = isDE
    ? 'Fragen? Schreib uns jederzeit:'
    : 'Questions? Reach us anytime:';
  const thanksLabel = isDE ? 'Danke, dass du bei été collectif kaufst.' : 'Thank you for shopping with été collectif.';

  const html = `<!DOCTYPE html>
<html lang="${lang || 'en'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f9f9f8;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f8;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;">

      <!-- Header -->
      <tr>
        <td style="padding:32px 40px 28px;border-bottom:1px solid #e8e8e6;text-align:center;">
          <a href="https://etecollectif.com" style="text-decoration:none;display:inline-block;">
            <img src="https://etecollectif.com/logo-email.png" alt="été collectif" height="40" style="display:block;margin:0 auto;">
          </a>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:36px 40px 0;">
          <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:300;color:#1a1a1a;margin:0 0 16px;">${isDE ? 'Bestellung bestätigt' : 'Order confirmed'} ✓</h1>
          <p style="font-size:14px;line-height:1.75;color:#444;margin:0 0 24px;">${greeting}<br><br>${intro}</p>

          <!-- Order ref -->
          <p style="font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#888;margin:0 0 6px;">${orderLabel}</p>
          <p style="font-size:14px;color:#1a1a1a;margin:0 0 32px;font-family:monospace;">${displayRef}</p>

          <!-- Items -->
          <p style="font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#888;margin:0 0 4px;">${itemsLabel}</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${itemsTableHtml(displayItems)}
            <tr>
              <td style="padding:12px 0 4px;font-size:13px;color:#666;">${shippingLabel}</td>
              <td style="padding:12px 0 4px 20px;text-align:right;font-size:13px;color:#666;">${shippingCost > 0 ? formatPrice(shippingCost) : (isDE ? 'Kostenlos' : 'Free')}</td>
            </tr>
            <tr>
              <td style="padding:8px 0 20px;font-size:15px;font-weight:700;color:#1a1a1a;border-top:1.5px solid #1a1a1a;">${totalLabel}</td>
              <td style="padding:8px 0 20px 20px;text-align:right;font-size:15px;font-weight:700;color:#1a1a1a;border-top:1.5px solid #1a1a1a;">${formatPrice(total)}</td>
            </tr>
          </table>

          <!-- Delivery -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f8;border-left:3px solid #8b1a1a;margin:0 0 32px;">
            <tr>
              <td style="padding:14px 18px;">
                <p style="font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#8b1a1a;margin:0 0 4px;">${deliveryLabel}</p>
                <p style="font-size:13px;color:#444;margin:0;">${deliveryNote}</p>
              </td>
            </tr>
          </table>

          <!-- Contact -->
          <p style="font-size:13px;color:#666;line-height:1.7;margin:0 0 32px;">
            ${questionLabel}<br>
            <a href="mailto:hello@etecollectif.com" style="color:#8b1a1a;text-decoration:none;">hello@etecollectif.com</a>
          </p>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="padding:24px 40px 36px;border-top:1px solid #e8e8e6;">
          <p style="font-size:11px;color:#aaa;margin:0 0 10px;">${thanksLabel}</p>
          <p style="font-size:11px;color:#aaa;margin:0 0 10px;">
            été collectif – Markus Sommer · Paradeplatz 1, 8001 Zürich
          </p>
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding-right:14px;">
                <a href="https://etecollectif.com" style="color:#aaa;text-decoration:none;font-size:11px;">etecollectif.com</a>
              </td>
              <td>
                <a href="https://instagram.com/etecollectif" style="text-decoration:none;display:inline-flex;align-items:center;gap:5px;color:#aaa;font-size:11px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#aaa" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="#aaa" stroke="none"/></svg>
                  @etecollectif
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { subject, html };
}

async function sendEmail({ to, bcc, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.warn('RESEND_API_KEY not set — skipping email'); return; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'été collectif <hello@etecollectif.com>',
        to: [to],
        ...(bcc ? { bcc: [bcc] } : {}),
        subject,
        html
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Resend error:', JSON.stringify(err));
    }
  } catch (e) {
    console.error('Resend fetch error:', e.message);
  }
}

// ── GOOGLE SHEETS LOGGING ────────────────────────────────────────────────────

async function logToSheets({ merchantRef, name, email, address, items, displayItems, shippingCost, lang, newsletter }) {
  const webhookUrl = process.env.CUSTOMER_DATA_WEBHOOK_URL;
  if (!webhookUrl) { console.warn('CUSTOMER_DATA_WEBHOOK_URL not set — skipping sheet log'); return; }
  const displayRef = merchantRef.split('-').slice(0, 2).join('-');
  const itemsSummary = Array.isArray(displayItems)
    ? displayItems.map(i => `${i.name} (${i.size}, ${i.detail}) x${i.qty}`).join(' | ')
    : '';
  const total = (Array.isArray(displayItems)
    ? displayItems.reduce((s, i) => s + (i.price * i.qty), 0)
    : 0) + (shippingCost || 0);
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp:   new Date().toISOString(),
        orderRef:    displayRef,
        name:        name || '',
        email:       email || '',
        address:     [address.line1, address.line2, address.townOrCity, address.postalOrZipCode, address.countryCode].filter(Boolean).join(', '),
        items:       itemsSummary,
        total:       `€${Number(total).toFixed(2)}`,
        lang:        lang || 'en',
        newsletter:  newsletter ? 'Yes' : 'No'
      })
    });
  } catch (e) {
    console.error('Sheets log error:', e.message);
  }
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.PRODIGI_API_KEY;
  if (!apiKey) {
    console.error('PRODIGI_API_KEY env var is not set');
    return res.status(500).json({ error: 'Print service not configured' });
  }

  const { items, displayItems, recipient, shippingMethod, shippingCost, lang, newsletter } = req.body || {};

  // Basic validation
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'No items in order' });
  }
  if (!recipient?.name || !recipient?.address?.line1 ||
      !recipient?.address?.townOrCity || !recipient?.address?.postalOrZipCode ||
      !recipient?.address?.countryCode) {
    return res.status(400).json({ error: 'Incomplete shipping address' });
  }

  // Encode customer info in merchantRef so webhook can retrieve it later
  const customerPayload = JSON.stringify({
    email: recipient.email || '',
    name:  recipient.name  || '',
    lang:  lang || 'en'
  });
  const merchantRef = `ete-${Date.now()}-${Buffer.from(customerPayload).toString('base64')}`;

  const orderPayload = {
    merchantReference: merchantRef,
    shippingMethod:    shippingMethod || 'Standard',
    recipient: {
      name: recipient.name,
      // email intentionally omitted — we handle all customer emails ourselves
      ...(recipient.phone ? { mobilePhoneNumber: recipient.phone } : {}),
      address: {
        line1:           recipient.address.line1,
        ...(recipient.address.line2        ? { line2:        recipient.address.line2 }        : {}),
        townOrCity:      recipient.address.townOrCity,
        postalOrZipCode: recipient.address.postalOrZipCode,
        countryCode:     recipient.address.countryCode,
        ...(recipient.address.stateOrCounty ? { stateOrCounty: recipient.address.stateOrCounty } : {})
      }
    },
    items: items.map((item, idx) => ({
      merchantReference: `item-${idx + 1}`,
      sku:    item.sku,
      copies: item.qty || 1,
      sizing: 'fitPrintArea',
      ...(item.attributes && Object.keys(item.attributes).length
        ? { attributes: item.attributes }
        : {}),
      assets: [{ printArea: 'default', url: item.assetUrl }]
    }))
  };

  try {
    const prodigiBase = process.env.PRODIGI_SANDBOX === 'true'
      ? 'https://api.sandbox.prodigi.com/v4.0'
      : 'https://api.prodigi.com/v4.0';

    const response = await fetch(`${prodigiBase}/orders`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body:    JSON.stringify(orderPayload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Prodigi error:', JSON.stringify(data));
      const detail = data.detail || data.message
        || (data.validationIssues ? JSON.stringify(data.validationIssues) : null)
        || (data.errors ? JSON.stringify(data.errors) : null)
        || JSON.stringify(data).slice(0, 400);
      return res.status(response.status).json({ error: detail });
    }

    // Send branded order confirmation email to customer
    if (recipient.email) {
      const { subject, html } = buildConfirmationEmail({
        name:         recipient.name,
        email:        recipient.email,
        displayItems: Array.isArray(displayItems) ? displayItems : [],
        shippingCost: shippingCost || 0,
        merchantRef,
        lang:         lang || 'en'
      });
      await sendEmail({
        to:      recipient.email,
        bcc:     'hello@etecollectif.com',
        subject,
        html
      });
    }

    // Log customer data to Google Sheets
    await logToSheets({
      merchantRef,
      name:         recipient.name,
      email:        recipient.email || '',
      address:      recipient.address,
      displayItems: Array.isArray(displayItems) ? displayItems : [],
      shippingCost: shippingCost || 0,
      lang:         lang || 'en',
      newsletter:   !!newsletter
    });

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
