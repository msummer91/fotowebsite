// Vercel serverless function — receives Prodigi dispatch webhooks and sends
// branded shipping notification emails to customers via Resend.
//
// Setup required:
//  1. Add RESEND_API_KEY to Vercel environment variables.
//  2. Register this endpoint in your Prodigi merchant settings:
//     https://dashboard.prodigi.com/ → Settings → Webhooks
//     URL: https://<your-vercel-domain>/api/prodigi-webhook
//     Events: order.dispatched
//
// How it works without a database:
//  - When create-order.js submits the order it stores customer info
//    (email, name, lang) as base64 JSON in Prodigi's merchantReference field.
//  - Prodigi echoes that field back in every webhook payload, so we
//    decode it here to get the customer's email without any DB.

async function sendEmail({ to, bcc, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.warn('RESEND_API_KEY not set — skipping email'); return; }
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
}

function buildShippingEmail({ name, trackingUrl, trackingNumber, courier, lang, merchantRef }) {
  const isDE = lang === 'de';

  const subject = isDE
    ? `Dein Paket ist unterwegs – été collectif`
    : `Your package is on its way – été collectif`;

  const greeting = isDE
    ? `Hallo ${name.split(' ')[0]},`
    : `Hi ${name.split(' ')[0]},`;

  const intro = isDE
    ? `gute Nachrichten: dein Druck wurde soeben verschickt und ist auf dem Weg zu dir.`
    : `Good news: your print has just been dispatched and is on its way to you.`;

  const trackingLabel   = isDE ? 'Sendungsverfolgung' : 'Track your shipment';
  const courierLabel    = isDE ? 'Versanddienstleister' : 'Courier';
  const trackingNumLabel = isDE ? 'Sendungsnummer' : 'Tracking number';
  const trackingCta     = isDE ? 'Sendung verfolgen →' : 'Track shipment →';
  const orderLabel      = isDE ? 'Bestellreferenz' : 'Order reference';
  const deliveryNote    = isDE
    ? 'Bitte beachte, dass die Sendungsverfolgung erst nach einigen Stunden aktiv sein kann.'
    : 'Please note that tracking information may take a few hours to become active.';
  const questionLabel   = isDE ? 'Fragen?' : 'Questions?';
  const thanksLabel     = isDE ? 'Danke, dass du bei été collectif kaufst.' : 'Thank you for shopping with été collectif.';

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
        <td style="padding:36px 40px 28px;border-bottom:1px solid #e8e8e6;">
          <a href="https://etecollectif.com" style="text-decoration:none;">
            <img src="https://etecollectif.com/logo-email.png" alt="été collectif" height="36" style="display:block;margin:0 auto;">
          </a>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:36px 40px 0;">
          <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:300;color:#1a1a1a;margin:0 0 16px;">${isDE ? 'Auf dem Weg zu dir' : 'On its way to you'} 📦</h1>
          <p style="font-size:14px;line-height:1.75;color:#444;margin:0 0 32px;">${greeting}<br><br>${intro}</p>

          <!-- Tracking info box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f8;border-left:3px solid #8b1a1a;margin:0 0 32px;">
            <tr>
              <td style="padding:20px 20px 16px;">
                <p style="font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#8b1a1a;margin:0 0 12px;">${trackingLabel}</p>
                ${courier ? `<p style="font-size:12px;color:#888;margin:0 0 4px;">${courierLabel}: <strong style="color:#1a1a1a;">${courier}</strong></p>` : ''}
                ${trackingNumber ? `<p style="font-size:12px;color:#888;margin:0 0 16px;">${trackingNumLabel}: <strong style="color:#1a1a1a;font-family:monospace;">${trackingNumber}</strong></p>` : ''}
                ${trackingUrl ? `<a href="${trackingUrl}" style="display:inline-block;background:#8b1a1a;color:#fff;text-decoration:none;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:10px 20px;">${trackingCta}</a>` : `<p style="font-size:13px;color:#666;margin:0;">${deliveryNote}</p>`}
              </td>
            </tr>
          </table>

          ${trackingUrl ? `<p style="font-size:12px;color:#aaa;margin:0 0 32px;">${deliveryNote}</p>` : ''}

          <!-- Order ref -->
          <p style="font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#888;margin:0 0 6px;">${orderLabel}</p>
          <p style="font-size:13px;color:#1a1a1a;margin:0 0 32px;font-family:monospace;">${merchantRef}</p>

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

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Prodigi webhook payload structure:
  // { type: "order.dispatched", order: { merchantReference, shipments: [...] } }
  const type  = body?.type;
  const order = body?.order;

  if (!type || !order) {
    // Acknowledge unknown payloads gracefully
    return res.status(200).json({ received: true });
  }

  // We only care about dispatch events
  if (type !== 'order.dispatched') {
    return res.status(200).json({ received: true, skipped: `event type: ${type}` });
  }

  const merchantRef = order.merchantReference || '';

  // Decode customer info from merchantRef
  // Format: ete-<timestamp>-<base64(JSON)>
  let email = '', name = 'Customer', lang = 'en';
  try {
    const parts = merchantRef.split('-');
    // parts: ['ete', timestamp, base64payload]
    // The base64 part is everything after "ete-<timestamp>-"
    const base64Part = parts.slice(2).join('-');
    if (base64Part) {
      const decoded = JSON.parse(Buffer.from(base64Part, 'base64').toString('utf8'));
      email = decoded.email || '';
      name  = decoded.name  || 'Customer';
      lang  = decoded.lang  || 'en';
    }
  } catch (e) {
    console.warn('Could not decode merchantRef:', merchantRef, e.message);
  }

  if (!email) {
    console.log('No customer email found in merchantRef — skipping notification');
    return res.status(200).json({ received: true, skipped: 'no customer email' });
  }

  // Extract tracking info from first shipment
  const shipment = Array.isArray(order.shipments) ? order.shipments[0] : null;
  const trackingNumber = shipment?.tracking?.number || null;
  const trackingUrl    = shipment?.tracking?.url    || null;
  const courier        = shipment?.carrier?.name    || shipment?.carrier?.code || null;

  try {
    const { subject, html } = buildShippingEmail({
      name,
      trackingUrl,
      trackingNumber,
      courier,
      lang,
      merchantRef
    });

    await sendEmail({
      to:      email,
      bcc:     'hello@etecollectif.com',
      subject,
      html
    });

    return res.status(200).json({ received: true, emailSent: true, to: email });
  } catch (err) {
    console.error('Failed to send shipping email:', err.message);
    // Still return 200 — we don't want Prodigi to retry endlessly
    return res.status(200).json({ received: true, emailSent: false, error: err.message });
  }
};
