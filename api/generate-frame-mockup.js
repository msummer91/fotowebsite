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

  const { imageUrl, frameColor = 'Black' } = req.query;

  if (!imageUrl) {
    return res.status(400).json({ error: 'imageUrl is required' });
  }

  const color = FRAME_COLORS[frameColor] || FRAME_COLORS['Black'];

  try {
    // Encode spaces in the URL for safe fetching
    const safeUrl = imageUrl.replace(/ /g, '%20');
    const response = await fetch(safeUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image (${response.status}): ${safeUrl}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const srcBuffer = Buffer.from(arrayBuffer);

    // Measure the source image
    const meta = await sharp(srcBuffer).metadata();
    const imgW = meta.width;
    const imgH = meta.height;

    // Frame thickness: ~7.5% of the shorter dimension
    // (mirrors Prodigi's 28mm molding on a 30cm print ≈ 9%, scaled conservatively)
    const ft = Math.round(Math.min(imgW, imgH) * 0.075);

    // Subtle inner-edge shadow: 4 gradient rectangles overlaid on the photo
    // so the print looks slightly recessed inside the frame
    const shadowW = imgW;
    const shadowH = imgH;
    const shadowDepth = Math.round(Math.min(imgW, imgH) * 0.04); // 4% bleed
    const innerShadowSvg = `<svg width="${shadowW}" height="${shadowH}" xmlns="http://www.w3.org/2000/svg">
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
      <rect x="0" y="0" width="${shadowW}" height="${shadowDepth * 2}" fill="url(#gt)"/>
      <rect x="0" y="${shadowH - shadowDepth * 2}" width="${shadowW}" height="${shadowDepth * 2}" fill="url(#gb)"/>
      <rect x="0" y="0" width="${shadowDepth * 2}" height="${shadowH}" fill="url(#gl)"/>
      <rect x="${shadowW - shadowDepth * 2}" y="0" width="${shadowDepth * 2}" height="${shadowH}" fill="url(#gr)"/>
    </svg>`;

    // Step 1: overlay inner shadow on the photo
    const shadowed = await sharp(srcBuffer)
      .composite([{
        input: Buffer.from(innerShadowSvg),
        top: 0, left: 0,
        blend: 'over',
      }])
      .toBuffer();

    // Step 2: extend canvas with the frame border color
    const framed = await sharp(shadowed)
      .extend({
        top:    ft,
        bottom: ft,
        left:   ft,
        right:  ft,
        background: { r: color.r, g: color.g, b: color.b, alpha: 1 },
      })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    res.setHeader('Content-Type', 'image/jpeg');
    // Cache for 7 days — same image + color always produces the same result
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return res.send(framed);

  } catch (err) {
    console.error('[generate-frame-mockup]', err.message);
    return res.status(500).json({ error: err.message || 'Mockup generation failed' });
  }
};
