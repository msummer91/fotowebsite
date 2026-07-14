// Vercel serverless function — generates a framed print mockup via sharp
// Accepts: ?imageUrl=<full URL>&frameColor=<name>&frameStyle=<classic|boxframe>
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
    const ft = Math.round(Math.min(imgW, imgH) * (isBox ? 0.11 : 0.075));

    // ─────────────────────────────────────────────────────────────────────────
    // BOX FRAME PIPELINE
    // Visually: [colored frame] → [box-wall shadow] → [cream reveal] → [photo float shadow] → [photo]
    // ─────────────────────────────────────────────────────────────────────────
    if (isBox) {
      // Step 1: add cream float-mount reveal (4.5% each side — clearly visible inner white box)
      const reveal = Math.round(Math.min(imgW, imgH) * 0.045);

      const withReveal = await sharp(srcBuffer)
        .extend({
          top: reveal, bottom: reveal, left: reveal, right: reveal,
          background: { r: 242, g: 237, b: 229, alpha: 1 },
        })
        .toBuffer();

      const workW = imgW + reveal * 2;
      const workH = imgH + reveal * 2;

      // Step 2: shadows on the reveal canvas
      //   (a) Box-wall shadow: fades across the reveal from outer edge → photo boundary
      //   (b) Photo float shadow: subtle shadow just inside photo edge (print elevation effect)
      const floatDepth = Math.round(reveal * 0.7); // how far float shadow extends into photo

      const shadowSvg = `<svg width="${workW}" height="${workH}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <!-- Box-wall shadows (cover reveal only, zero at photo edge) -->
          <linearGradient id="wt" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="black" stop-opacity="0.60"/>
            <stop offset="100%" stop-color="black" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="wb" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%"   stop-color="black" stop-opacity="0.45"/>
            <stop offset="100%" stop-color="black" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="wl" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stop-color="black" stop-opacity="0.52"/>
            <stop offset="100%" stop-color="black" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="wr" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%"   stop-color="black" stop-opacity="0.52"/>
            <stop offset="100%" stop-color="black" stop-opacity="0"/>
          </linearGradient>
          <!-- Photo float shadows (subtle inset shadow at photo edge) -->
          <linearGradient id="ft" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="black" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="black" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="fb" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%"   stop-color="black" stop-opacity="0.15"/>
            <stop offset="100%" stop-color="black" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="fl" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stop-color="black" stop-opacity="0.18"/>
            <stop offset="100%" stop-color="black" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="fr" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%"   stop-color="black" stop-opacity="0.18"/>
            <stop offset="100%" stop-color="black" stop-opacity="0"/>
          </linearGradient>
        </defs>

        <!-- Box-wall shadows: constrained to the reveal band on each side -->
        <rect x="0"                   y="0"                    width="${workW}"  height="${reveal}"  fill="url(#wt)"/>
        <rect x="0"                   y="${workH - reveal}"     width="${workW}"  height="${reveal}"  fill="url(#wb)"/>
        <rect x="0"                   y="0"                    width="${reveal}"  height="${workH}"   fill="url(#wl)"/>
        <rect x="${workW - reveal}"    y="0"                    width="${reveal}"  height="${workH}"   fill="url(#wr)"/>

        <!-- Photo float shadows: just inside the photo boundary -->
        <rect x="${reveal}"            y="${reveal}"             width="${workW - reveal * 2}"  height="${floatDepth}" fill="url(#ft)"/>
        <rect x="${reveal}"            y="${workH - reveal - floatDepth}" width="${workW - reveal * 2}" height="${floatDepth}" fill="url(#fb)"/>
        <rect x="${reveal}"            y="${reveal}"             width="${floatDepth}"           height="${workH - reveal * 2}" fill="url(#fl)"/>
        <rect x="${workW - reveal - floatDepth}" y="${reveal}"  width="${floatDepth}"           height="${workH - reveal * 2}" fill="url(#fr)"/>
      </svg>`;

      const withShadow = await sharp(withReveal)
        .composite([{ input: Buffer.from(shadowSvg), top: 0, left: 0, blend: 'over' }])
        .toBuffer();

      // Step 3: add colored frame border
      const finalW = workW + ft * 2;
      const finalH = workH + ft * 2;

      const withFrame = await sharp(withShadow)
        .extend({
          top: ft, bottom: ft, left: ft, right: ft,
          background: { r: color.r, g: color.g, b: color.b, alpha: 1 },
        })
        .toBuffer();

      // Step 4: thin dark accent line at inner frame edge (visible box depth / wall edge)
      // Draws a dark hairline right at the junction between the colored frame and the cream reveal
      const wallLine = Math.max(3, Math.round(ft * 0.07));
      const depthLineSvg = `<svg width="${finalW}" height="${finalH}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${ft}" y="${ft}" width="${workW}" height="${workH}"
              fill="none"
              stroke="rgba(0,0,0,0.55)"
              stroke-width="${wallLine}"/>
      </svg>`;

      const finalBuf = await sharp(withFrame)
        .composite([{ input: Buffer.from(depthLineSvg), top: 0, left: 0, blend: 'over' }])
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      return res.send(finalBuf);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLASSIC FRAME PIPELINE
    // ─────────────────────────────────────────────────────────────────────────

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
