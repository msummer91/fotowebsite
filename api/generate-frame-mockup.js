// Vercel serverless function — generates a framed print mockup via sharp
// Accepts: ?imageUrl=<full URL>&frameColor=<name>&frameStyle=<classic|boxframe>
// Returns: JPEG of the photo with a proportional solid frame border

const path  = require('path');
const fs    = require('fs');
const sharp = require('sharp');

// Must exactly match hex values used in frontend frameData
const FRAME_COLORS = {
  'Black':          { r: 28,  g: 28,  b: 28  },
  'White':          { r: 242, g: 240, b: 237 },
  'Brown':          { r: 122, g: 73,  b: 41  },
  'Natural':        { r: 192, g: 155, b: 110 },
  'Antique Silver': { r: 157, g: 163, b: 163 },
  'Antique Gold':   { r: 201, g: 168, b: 76  },
  'Dark Grey':      { r: 74,  g: 72,  b: 72  },
  'Light Grey':     { r: 192, g: 191, b: 189 },
};

// Pixel positions measured from boxframesample.jpg (2000×2000 px)
// Outer frame boundary, white mat boundary, inner artwork area
const BOX_TMPL = {
  W: 2000, H: 2000,
  frameL: 256, frameT: 378, frameR: 1702, frameB: 1554,
  matL:   311, matT:   433, matR:   1647, matB:   1500,
  artL:   472, artT:   583, artR:   1485, artB:   1307,
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

    // ─────────────────────────────────────────────────────────────────────────
    // BOX FRAME — composite into boxframesample.jpg template
    // ─────────────────────────────────────────────────────────────────────────
    if (isBox) {
      const templatePath = path.join(__dirname, '..', 'Images', 'boxframesample.jpg');
      const templateBuf  = fs.readFileSync(templatePath);

      const { W, H, frameL, frameT, frameR, frameB, matL, matT, matR, matB,
              artL, artT, artR, artB } = BOX_TMPL;

      // Expand the composite area by BLEED pixels beyond the measured artwork boundary.
      // This ensures the old template image is fully covered at the edges where
      // the wave painting and white mat transition gradually.
      const BLEED = 25;
      const compL = artL - BLEED;
      const compT = artT - BLEED;
      const compW = (artR - artL) + BLEED * 2; // 1063
      const compH = (artB - artT) + BLEED * 2; // 774

      // Resize user photo to fill the (expanded) composite area (cover crop, centered)
      const artAspect = compW / compH;
      const imgAspect = imgW / imgH;
      let resizeW, resizeH, cropL = 0, cropT = 0;

      if (imgAspect > artAspect) {
        // Photo wider than art area — fit by height, crop sides
        resizeH = compH;
        resizeW = Math.round(compH * imgAspect);
        cropL   = Math.round((resizeW - compW) / 2);
      } else {
        // Photo taller — fit by width, crop top/bottom
        resizeW = compW;
        resizeH = Math.round(compW / imgAspect);
        cropT   = Math.round((resizeH - compH) / 2);
      }

      const photoResized = await sharp(srcBuffer)
        .resize(resizeW, resizeH)
        .extract({ left: cropL, top: cropT, width: compW, height: compH })
        .toBuffer();

      // Composite the photo into the template (slightly overlapping mat edges)
      let result = await sharp(templateBuf)
        .composite([{ input: photoResized, left: compL, top: compT }])
        .toBuffer();

      // Tint the frame border ring for non-black colors
      // The template frame is black; we apply a hard-light colored overlay
      // confined to the frame border (outer rect minus mat rect, evenodd rule)
      if (frameColor !== 'Black') {
        const { r: cr, g: cg, b: cb } = color;
        // White needs higher opacity for an effective lightening; warm tones slightly less
        const opacity = frameColor === 'White' ? 0.93 : 0.80;

        const tintSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
          <path d="M ${frameL},${frameT} L ${frameR},${frameT} L ${frameR},${frameB} L ${frameL},${frameB} Z
                   M ${matL},${matT} L ${matR},${matT} L ${matR},${matB} L ${matL},${matB} Z"
                fill-rule="evenodd"
                fill="rgba(${cr},${cg},${cb},${opacity})"/>
        </svg>`;

        result = await sharp(result)
          .composite([{ input: Buffer.from(tintSvg), top: 0, left: 0, blend: 'hard-light' }])
          .toBuffer();
      }

      // Crop to just the outer frame boundary — removes surrounding background
      // so the artwork fills the image more naturally (less wasted space)
      const finalBuf = await sharp(result)
        .extract({
          left:   frameL,
          top:    frameT,
          width:  frameR - frameL,
          height: frameB - frameT,
        })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      return res.send(finalBuf);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLASSIC FRAME PIPELINE
    // Visually: photo with inner-edge vignette → extend with coloured border
    // ─────────────────────────────────────────────────────────────────────────

    // Frame thickness: ~5% of shorter dimension (keeps proportions close to Prodigi samples)
    const ft = Math.round(Math.min(imgW, imgH) * 0.05);

    // Step 1: subtle inner-edge shadow on the photo (vignette effect under frame)
    const shadowDepth = Math.round(Math.min(imgW, imgH) * 0.04);
    const innerShadowSvg = `<svg width="${imgW}" height="${imgH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="black" stop-opacity="0.30"/>
          <stop offset="100%" stop-color="black" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="gb" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%"   stop-color="black" stop-opacity="0.20"/>
          <stop offset="100%" stop-color="black" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="gl" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stop-color="black" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="black" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="gr" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%"   stop-color="black" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="black" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${imgW}" height="${shadowDepth * 2}" fill="url(#gt)"/>
      <rect x="0" y="${imgH - shadowDepth * 2}" width="${imgW}" height="${shadowDepth * 2}" fill="url(#gb)"/>
      <rect x="0" y="0" width="${shadowDepth * 2}" height="${imgH}" fill="url(#gl)"/>
      <rect x="${imgW - shadowDepth * 2}" y="0" width="${shadowDepth * 2}" height="${imgH}" fill="url(#gr)"/>
    </svg>`;

    const shadowed = await sharp(srcBuffer)
      .composite([{ input: Buffer.from(innerShadowSvg), top: 0, left: 0, blend: 'over' }])
      .toBuffer();

    // Step 2: extend canvas with frame colour border
    const framed = await sharp(shadowed)
      .extend({
        top: ft, bottom: ft, left: ft, right: ft,
        background: { r: color.r, g: color.g, b: color.b, alpha: 1 },
      })
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
