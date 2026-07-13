// Vercel serverless function — generates a framed print mockup via sharp
// Accepts: ?imageUrl=<full URL>&frameColor=<name>
// Returns: JPEG of the photo with a proportional solid frame border

const sharp = require('sharp');

// Must exactly match hex values used in frontend frameData
const FRAME_COLORS = {
  'Black':          { r: 28,  g: 28,  b: 28  },
  'White':          { r: 242, g: 240, b: 237 },
  'Natural':        { r: 192, g: 155, b: 110 },
  'Antique Silver': { r: 157, g: 163, b: 163 },
  'Brown':          { r: 122, g: 73,  b: 41  },
  'Antique Gold':   { r: 201, g: 168, b: 76  },
  'Dark Grey':      { r: 74,  g: 72,  b: 72  },
  'Light Grey':     { r: 192, g: 191, b: 189 },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageUrl, frameColor = 'Black', frameStyle = 'classic' } = req.query;

  if (!imageUrl) {
    return res.status(400).json({ error: 'imageUrl is required' });
  }

  const color = FRAME_COLORS[frameColor] || FRAME_COLORS['Black'];
  const isBox = frameStyle === 'boxframe';

  try {
    const safeUrl = imageUrl.replace(/ /g, '%20');
    const response = await fetch(safeUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image (${response.status}): ${safeUrl}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const srcBuffer = Buffer.from(arrayBuffer);

    const meta = await sharp(srcBuffer).metadata();
    const imgW = meta.width;
    const imgH = meta.height;

    // Frame thickness: classic ~7.5%, box frame ~11% of shorter dimension
    const ft     = Math.round(Math.min(imgW, imgH) * (isBox ? 0.11 : 0.075));
    // Box frame inner cream reveal (float-mount gap between photo and frame)
    const reveal  = isBox ? Math.round(Math.min(imgW, imgH) * 0.018) : 0;

    // ── Step 1 (box frame only): add cream float-mount reveal ──
    let workBuf = srcBuffer;
    let workW   = imgW;
    let workH   = imgH;

    if (isBox && reveal > 0) {
      workBuf = await sharp(srcBuffer)
        .extend({ top: reveal, bottom: reveal, left: reveal, right: reveal,
                  background: { r: 242, g: 237, b: 229, alpha: 1 } })
        .toBuffer();
      workW = imgW + reveal * 2;
      workH = imgH + reveal * 2;
    }

    // ── Step 2: overlay inner-edge shadow ──
    const shadowDepth = Math.round(Math.min(workW, workH) * 0.04);
    const innerShadowSvg = `<svg width="${workW}" height="${workH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="black" stop-opacity="0.30"/>
          <stop offset="100%" stop-color="black" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="gb" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stop-color="black" stop-opacity="0.20"/>
          <stop offset="100%" stop-color="black" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="gl" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="black" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="black" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="gr" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%" stop-color="black" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="black" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${workW}" height="${shadowDepth * 2}" fill="url(#gt)"/>
      <rect x="0" y="${workH - shadowDepth * 2}" width="${workW}" height="${shadowDepth * 2}" fill="url(#gb)"/>
      <rect x="0" y="0" width="${shadowDepth * 2}" height="${workH}" fill="url(#gl)"/>
      <rect x="${workW - shadowDepth * 2}" y="0" width="${shadowDepth * 2}" height="${workH}" fill="url(#gr)"/>
    </svg>`;

    const shadowed = await sharp(workBuf)
      .composite([{ input: Buffer.from(innerShadowSvg), top: 0, left: 0, blend: 'over' }])
      .toBuffer();

    // ── Step 3: extend canvas with frame colour border ──
    const framed = await sharp(shadowed)
      .extend({ top: ft, bottom: ft, left: ft, right: ft,
                background: { r: color.r, g: color.g, b: color.b, alpha: 1 } })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return res.send(framed);

  } catch (err) {
    console.error('[generate-frame-mockup]', err.message);
    return res.status(500).json({ error: err.message || 'Mockup generation failed' });
  }
};
