// Vercel serverless function — generates a framed print mockup via sharp
// Accepts: ?imageUrl=<full URL>&frameColor=<name>&frameStyle=<classic|boxframe>
// Returns: JPEG of the photo composited into a real frame template image

const path  = require('path');
const fs    = require('fs');
const sharp = require('sharp');

const FRAMES_DIR = path.join(__dirname, '..', 'Images', 'frames');

// Classic frame templates — freshly measured coordinates (pixels, portrait orientation).
// S = canvas size (all templates are square).
// fL/fT/fR/fB = outer frame edge (background excluded).
// artL/artT/artR/artB = inner artwork area.
const CLASSIC_TEMPLATES = {
  'Black':          { file: 'Black classic frame_blank.png',      S: 2500, fL: 474, fT: 189, fR: 2061, fB: 2351, artL: 564, artT: 280, artR: 1937, artB: 2220 },
  'White':          { file: 'White classic frame_blank.png',      S: 2500, fL: 474, fT: 189, fR: 2061, fB: 2351, artL: 564, artT: 279, artR: 1938, artB: 2220 },
  'Natural':        { file: 'Natural classic frame_blank.png',    S: 2500, fL: 474, fT: 189, fR: 2061, fB: 2351, artL: 564, artT: 279, artR: 1938, artB: 2220 },
  'Brown':          { file: 'Brown classic frame_blank.jpg',      S: 2000, fL: 391, fT: 216, fR: 1590, fB: 1762, artL: 490, artT: 302, artR: 1507, artB: 1660 },
  'Antique Silver': { file: 'Silver Classic Frame_blank.png',     S: 2000, fL: 412, fT: 235, fR: 1583, fB: 1762, artL: 502, artT: 324, artR: 1502, artB: 1676 },
  'Antique Gold':   { file: 'Gold Classic Frame_blank.png',       S: 2000, fL: 432, fT: 269, fR: 1558, fB: 1698, artL: 504, artT: 328, artR: 1496, artB: 1625 },
  'Dark Grey':      { file: 'Dark grey classic frame_blank.jpg',  S: 2000, fL: 356, fT: 195, fR: 1619, fB: 1818, artL: 458, artT: 277, artR: 1539, artB: 1724 },
  'Light Grey':     { file: 'Light grey classic frame_blank.jpg', S: 2000, fL: 395, fT: 232, fR: 1591, fB: 1777, artL: 487, artT: 312, artR: 1515, artB: 1688 },
};

// Box frame template — "Box black framed print face on.jpg" (2000×2000 px), landscape art area.
const BOX_TMPL = {
  W: 2000, H: 2000,
  frameL: 256, frameT: 375, frameR: 1704, frameB: 1554,
  matL:   310, matT:   432, matR:   1647, matB:   1500,
  artL:   470, artT:   589, artR:   1470, artB:   1318,
};

// Box frame border tint colors for non-black variants.
// White: 'difference' blend inverts near-black frame pixels to near-white,
//        preserving the 3D texture/shading (unlike 'over' which paints a flat solid).
// Warm colors: 'hard-light' tints the dark frame texture with color.
const BOX_TINTS = {
  'White':   { r: 255, g: 255, b: 255, opacity: 1.0,  blend: 'difference' },
  'Brown':   { r: 100, g: 60,  b: 35,  opacity: 0.82, blend: 'hard-light' },
  'Natural': { r: 180, g: 145, b: 100, opacity: 0.80, blend: 'hard-light' },
};

// Rotate a bounding box 90° CW inside a square canvas of size S.
// Transform: (x, y) → (S − y, x)
// Bounding box (L, T, R, B) → (S−B, L, S−T, R)
function rotRect(L, T, R, B, S) {
  return { L: S - B, T: L, R: S - T, B: R };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { imageUrl, frameColor = 'Black', frameStyle = 'classic' } = req.query;
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });

  const isBox = frameStyle === 'boxframe';

  try {
    const safeUrl  = imageUrl.replace(/ /g, '%20');
    const response = await fetch(safeUrl);
    if (!response.ok) throw new Error(`Failed to fetch image (${response.status}): ${safeUrl}`);

    const srcBuffer = Buffer.from(await response.arrayBuffer());
    const meta      = await sharp(srcBuffer).metadata();
    const imgW = meta.width, imgH = meta.height;
    const isLandscape = imgW > imgH; // photo is wider than tall
    const isPortrait  = imgH > imgW; // photo is taller than wide

    // ── Cover-crop user photo to fill target dimensions ──────────────────
    async function fitPhoto(artW, artH) {
      const artAspect = artW / artH;
      const imgAspect = imgW / imgH;
      let resizeW, resizeH, cropL = 0, cropT = 0;
      if (imgAspect > artAspect) {
        resizeH = artH; resizeW = Math.round(artH * imgAspect);
        cropL   = Math.round((resizeW - artW) / 2);
      } else {
        resizeW = artW; resizeH = Math.round(artW / imgAspect);
        cropT   = Math.round((resizeH - artH) / 2);
      }
      return sharp(srcBuffer)
        .resize(resizeW, resizeH)
        .extract({ left: cropL, top: cropT, width: artW, height: artH })
        .toBuffer();
    }

    // ── Subtle inset shadow on photo edges (depth / float effect) ────────
    async function addInsetShadow(photoBuf, W, H) {
      const d = Math.round(Math.min(W, H) * 0.04);
      const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="st" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="black" stop-opacity="0.25"/>
            <stop offset="100%" stop-color="black" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="sb" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%"   stop-color="black" stop-opacity="0.15"/>
            <stop offset="100%" stop-color="black" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="sl" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stop-color="black" stop-opacity="0.20"/>
            <stop offset="100%" stop-color="black" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="sr" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%"   stop-color="black" stop-opacity="0.20"/>
            <stop offset="100%" stop-color="black" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <rect x="0"       y="0"       width="${W}"   height="${d*2}" fill="url(#st)"/>
        <rect x="0"       y="${H-d*2}" width="${W}"   height="${d*2}" fill="url(#sb)"/>
        <rect x="0"       y="0"       width="${d*2}"  height="${H}"  fill="url(#sl)"/>
        <rect x="${W-d*2}" y="0"      width="${d*2}"  height="${H}"  fill="url(#sr)"/>
      </svg>`;
      return sharp(photoBuf)
        .composite([{ input: Buffer.from(svg), blend: 'over' }])
        .toBuffer();
    }

    // ─────────────────────────────────────────────────────────────────────
    // BOX FRAME PIPELINE
    // ─────────────────────────────────────────────────────────────────────
    if (isBox) {
      let rawTmplBuf = fs.readFileSync(path.join(FRAMES_DIR, 'Box black framed print face on.jpg'));
      let { W, H, frameL, frameT, frameR, frameB, matL, matT, matR, matB, artL, artT, artR, artB } = BOX_TMPL;

      // Template art area is landscape (1000×729).
      // If photo is portrait, rotate the template 90° CW so art area becomes portrait (729×1000).
      if (isPortrait) {
        rawTmplBuf = await sharp(rawTmplBuf).rotate(90).toBuffer();
        const S = W; // square template
        const f = rotRect(frameL, frameT, frameR, frameB, S);
        const m = rotRect(matL,   matT,   matR,   matB,   S);
        const a = rotRect(artL,   artT,   artR,   artB,   S);
        frameL = f.L; frameT = f.T; frameR = f.R; frameB = f.B;
        matL   = m.L; matT   = m.T; matR   = m.R; matB   = m.B;
        artL   = a.L; artT   = a.T; artR   = a.R; artB   = a.B;
        // W and H stay the same (square canvas)
      }

      const artW = artR - artL;
      const artH = artB - artT;

      // 1. Erase the template artwork: fill the entire mat+art interior with cream
      const interiorW = matR - matL;
      const interiorH = matB - matT;
      const creamBuf = await sharp({
        create: { width: interiorW, height: interiorH, channels: 3, background: { r: 238, g: 235, b: 232 } },
      }).png().toBuffer();

      let result = await sharp(rawTmplBuf)
        .composite([{ input: creamBuf, left: matL, top: matT }])
        .toBuffer();

      // 2. Fit user photo into art area with inset shadow
      const photo = await addInsetShadow(await fitPhoto(artW, artH), artW, artH);
      result = await sharp(result)
        .composite([{ input: photo, left: artL, top: artT }])
        .toBuffer();

      // 3. Tint the frame border for non-black colors.
      //    evenodd path = outer frame rect minus mat rect → frame ring only.
      //    'difference' blend: |white − dark_pixel| ≈ white, preserving texture variation.
      if (frameColor !== 'Black') {
        const c = BOX_TINTS[frameColor] || BOX_TINTS['Natural'];
        const tintSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
          <path d="M${frameL},${frameT} L${frameR},${frameT} L${frameR},${frameB} L${frameL},${frameB}Z
                   M${matL},${matT}   L${matR},${matT}   L${matR},${matB}   L${matL},${matB}Z"
                fill-rule="evenodd" fill="rgba(${c.r},${c.g},${c.b},${c.opacity})"/>
        </svg>`;
        result = await sharp(result)
          .composite([{ input: Buffer.from(tintSvg), blend: c.blend }])
          .toBuffer();
      }

      // 4. Crop to just the outer frame boundary (removes wall/background), then resize.
      //    CROP_INSET trims shadow/background fringe from the template photo edges.
      const BOX_CROP_INSET = 10;
      const finalBuf = await sharp(result)
        .extract({ left: frameL + BOX_CROP_INSET, top: frameT + BOX_CROP_INSET, width: (frameR - frameL) - BOX_CROP_INSET * 2, height: (frameB - frameT) - BOX_CROP_INSET * 2 })
        .resize({ width: 1400, withoutEnlargement: true })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(finalBuf);
    }

    // ─────────────────────────────────────────────────────────────────────
    // CLASSIC FRAME PIPELINE
    // ─────────────────────────────────────────────────────────────────────
    const tmpl = CLASSIC_TEMPLATES[frameColor] || CLASSIC_TEMPLATES['Black'];
    let rawTmplBuf = fs.readFileSync(path.join(FRAMES_DIR, tmpl.file));
    let { S, fL, fT, fR, fB, artL, artT, artR, artB } = tmpl;

    // Templates are square with a portrait art area (artH > artW).
    // If photo is landscape, rotate 90° CW so art area becomes landscape.
    // Both art and frame-boundary coordinates are transformed together.
    if (isLandscape) {
      rawTmplBuf = await sharp(rawTmplBuf).rotate(90).toBuffer();
      const a = rotRect(artL, artT, artR, artB, S);
      const f = rotRect(fL,   fT,   fR,   fB,   S);
      artL = a.L; artT = a.T; artR = a.R; artB = a.B;
      fL   = f.L; fT   = f.T; fR   = f.R; fB   = f.B;
    }

    const artW = artR - artL;
    const artH = artB - artT;

    // 1. Fit user photo into the blank inner area with inset shadow
    const photo = await addInsetShadow(await fitPhoto(artW, artH), artW, artH);

    // 2. Composite into the blank template
    const composited = await sharp(rawTmplBuf)
      .composite([{ input: photo, left: artL, top: artT }])
      .toBuffer();

    // 3. Crop to the frame outer boundary, then resize so the art area's long
    //    dimension = TARGET_ART_PX in the output. This normalises all frames so
    //    the photo always appears at the same size regardless of which template
    //    was used (different templates were photographed at different scales).
    //    CROP_INSET: trim a few px from each side to remove shadow/background
    //    fringe that bleeds in from the template photo edges.
    const TARGET_ART_PX = 1200;
    const CROP_INSET = 10;
    const cropL = fL + CROP_INSET, cropT = fT + CROP_INSET;
    const cropW = (fR - fL) - CROP_INSET * 2, cropH = (fB - fT) - CROP_INSET * 2;
    const artLong = Math.max(artW, artH);
    const outW = Math.round(cropW * TARGET_ART_PX / artLong);
    const finalBuf = await sharp(composited)
      .extract({ left: cropL, top: cropT, width: cropW, height: cropH })
      .resize({ width: outW, withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(finalBuf);

  } catch (err) {
    console.error('[generate-frame-mockup]', err.message);
    return res.status(500).json({ error: err.message || 'Mockup generation failed' });
  }
};
