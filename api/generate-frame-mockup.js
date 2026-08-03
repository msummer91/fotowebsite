// Vercel serverless function — generates a framed print mockup via sharp
// Accepts: ?imageUrl=<full URL>&frameColor=<name>&frameStyle=<classic|boxframe>
// Returns: JPEG of the photo composited into a real frame template image

const path  = require('path');
const fs    = require('fs');
const sharp = require('sharp');

const FRAMES_DIR = path.join(__dirname, '..', 'Images', 'Frames');

// Classic frame blank templates with measured inner artwork areas (pixels).
// Each template has a light-grey outer background and a blank white inner rectangle.
const CLASSIC_TEMPLATES = {
  'Black':          { file: 'Black classic frame_blank.png',      artL: 568, artT: 284, artR: 1932, artB: 2215 },
  'White':          { file: 'White classic frame_blank.png',      artL: 568, artT: 283, artR: 1933, artB: 2215 },
  'Brown':          { file: 'Brown classic frame_blank.jpg',      artL: 494, artT: 306, artR: 1509, artB: 1655 },
  'Natural':        { file: 'Natural classic frame_blank.png',    artL: 568, artT: 283, artR: 1933, artB: 2215 },
  'Antique Silver': { file: 'Silver Classic Frame_blank.png',     artL: 506, artT: 328, artR: 1494, artB: 1671 },
  'Antique Gold':   { file: 'Gold Classic Frame_blank.png',       artL: 508, artT: 332, artR: 1491, artB: 1620 },
  'Dark Grey':      { file: 'Dark grey classic frame_blank.jpg',  artL: 462, artT: 281, artR: 1534, artB: 1719 },
  'Light Grey':     { file: 'Light grey classic frame_blank.jpg', artL: 491, artT: 316, artR: 1510, artB: 1683 },
};

// Box frame template — "Box black framed print face on.jpg" (2000×2000 px)
// Pixel positions measured from the image: frame outer edge, white mat, inner artwork area.
const BOX_TMPL = {
  W: 2000, H: 2000,
  frameL: 256, frameT: 375, frameR: 1704, frameB: 1554,
  matL:   310, matT:   432, matR:   1647, matB:   1500,
  artL:   470, artT:   589, artR:   1470, artB:   1318,
};

// Box frame border tint colors for non-black variants.
// Applied as a hard-light overlay over the black frame border ring.
const BOX_TINTS = {
  'White':   { r: 242, g: 240, b: 237, opacity: 0.93 },
  'Brown':   { r: 100, g: 60,  b: 35,  opacity: 0.80 },
  'Natural': { r: 180, g: 145, b: 100, opacity: 0.78 },
};

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
      const tmplBuf = fs.readFileSync(path.join(FRAMES_DIR, 'Box black framed print face on.jpg'));
      const { W, H, frameL, frameT, frameR, frameB, matL, matT, matR, matB, artL, artT, artR, artB } = BOX_TMPL;
      const artW = artR - artL; // 1000
      const artH = artB - artT; // 729

      // 1. Erase the wave painting: fill the entire mat+art interior cream
      //    so no template artwork bleeds into the mat zone
      const interiorW = matR - matL; // 1337
      const interiorH = matB - matT; // 1068
      const creamBuf = await sharp({
        create: { width: interiorW, height: interiorH, channels: 3, background: { r: 238, g: 235, b: 232 } },
      }).png().toBuffer();

      let result = await sharp(tmplBuf)
        .composite([{ input: creamBuf, left: matL, top: matT }])
        .toBuffer();

      // 2. Fit user photo into art area with inset shadow
      const photo = await addInsetShadow(await fitPhoto(artW, artH), artW, artH);
      result = await sharp(result)
        .composite([{ input: photo, left: artL, top: artT }])
        .toBuffer();

      // 3. Tint the frame border for non-black colors
      //    (evenodd path: outer rect minus mat rect = frame ring only)
      if (frameColor !== 'Black') {
        const c = BOX_TINTS[frameColor] || BOX_TINTS['Natural'];
        const tintSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
          <path d="M${frameL},${frameT} L${frameR},${frameT} L${frameR},${frameB} L${frameL},${frameB}Z
                   M${matL},${matT}   L${matR},${matT}   L${matR},${matB}   L${matL},${matB}Z"
                fill-rule="evenodd" fill="rgba(${c.r},${c.g},${c.b},${c.opacity})"/>
        </svg>`;
        result = await sharp(result)
          .composite([{ input: Buffer.from(tintSvg), blend: 'hard-light' }])
          .toBuffer();
      }

      // 4. Crop to just the outer frame boundary (removes wall/background)
      const finalBuf = await sharp(result)
        .extract({ left: frameL, top: frameT, width: frameR - frameL, height: frameB - frameT })
        .resize({ width: 1400, withoutEnlargement: true })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      return res.send(finalBuf);
    }

    // ─────────────────────────────────────────────────────────────────────
    // CLASSIC FRAME PIPELINE
    // ─────────────────────────────────────────────────────────────────────
    const tmpl   = CLASSIC_TEMPLATES[frameColor] || CLASSIC_TEMPLATES['Black'];
    const tmplBuf = fs.readFileSync(path.join(FRAMES_DIR, tmpl.file));
    const { artL, artT, artR, artB } = tmpl;
    const artW = artR - artL;
    const artH = artB - artT;

    // 1. Fit user photo into the blank inner area with inset shadow
    const photo = await addInsetShadow(await fitPhoto(artW, artH), artW, artH);

    // 2. Composite into the blank template
    const result = await sharp(tmplBuf)
      .composite([{ input: photo, left: artL, top: artT }])
      .toBuffer();

    // 3. Resize for fast delivery (templates are 2000–2500px)
    const finalBuf = await sharp(result)
      .resize({ width: 1400, withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return res.send(finalBuf);

  } catch (err) {
    console.error('[generate-frame-mockup]', err.message);
    return res.status(500).json({ error: err.message || 'Mockup generation failed' });
  }
};
