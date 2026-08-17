// Vercel serverless function — generates a framed print mockup via sharp
// Accepts: ?imageUrl=<full URL>&frameColor=<name>&frameStyle=<classic|boxframe>[&mountColor=<name>]
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
  // Black template is stored in LANDSCAPE orientation (artW > artH).
  // All other templates are portrait-oriented.
  // The rotation logic below handles orientation matching automatically.
  'Black':          { file: 'Black classic frame_blank.png',      S: 2500, fL: 188, fT: 432, fR: 2358, fB: 2026, artL: 279, artT: 563, artR: 2219, artB: 1935 },
  'White':          { file: 'White classic frame_blank.png',      S: 2500, fL: 474, fT: 189, fR: 2061, fB: 2351, artL: 564, artT: 279, artR: 1938, artB: 2220 },
  'Natural':        { file: 'Natural classic frame_blank.png',    S: 2500, fL: 474, fT: 189, fR: 2061, fB: 2351, artL: 564, artT: 279, artR: 1938, artB: 2220 },
  'Brown':          { file: 'Brown classic frame_blank.jpg',      S: 2000, fL: 391, fT: 216, fR: 1590, fB: 1762, artL: 490, artT: 302, artR: 1507, artB: 1660 },
  'Antique Silver': { file: 'Silver Classic Frame_blank.png',     S: 2000, fL: 412, fT: 235, fR: 1583, fB: 1762, artL: 502, artT: 324, artR: 1502, artB: 1676 },
  'Antique Gold':   { file: 'Gold Classic Frame_blank.png',       S: 2000, fL: 432, fT: 269, fR: 1558, fB: 1698, artL: 504, artT: 328, artR: 1496, artB: 1625 },
  'Dark Grey':      { file: 'Dark grey classic frame_blank.jpg',  S: 2000, fL: 356, fT: 195, fR: 1619, fB: 1818, artL: 458, artT: 277, artR: 1539, artB: 1724 },
  'Light Grey':     { file: 'Light grey classic frame_blank.jpg', S: 2000, fL: 395, fT: 232, fR: 1591, fB: 1777, artL: 487, artT: 312, artR: 1515, artB: 1688 },
};

// Box frame template — "Box black framed print face on.jpg" (1376×768 px), landscape art area.
// Coordinates measured from the updated template (Aug 2026).
const BOX_TMPL = {
  W: 1376, H: 768,
  frameL: 219, frameT:  28, frameR: 1156, frameB: 738,
  matL:   254, matT:   62, matR:  1121, matB:  703,
  artL:   338, artT:  130, artR:  1050, artB:  640,
};

// Box frame border tint colors for non-black variants (fallback when no dedicated template exists).
// White: hard-light near-white preserves 3D texture/shading.
// Natural: warm sandy oak sampled from actual Prodigi natural frame (avg #ccb28f).
const BOX_TINTS = {
  'White':   { r: 245, g: 245, b: 243, opacity: 1.0,  blend: 'hard-light' },
  'Natural': { r: 215, g: 185, b: 145, opacity: 0.85, blend: 'hard-light' },
};

// Optional dedicated face-on template for Natural box frame.
// Drop "Box natural framed print face on.jpg" into Images/frames/ to use it
// instead of tinting the black template. Coordinates to be filled in once measured.
const BOX_NATURAL_TMPL_FILE = 'Box natural framed print face on.jpg';
// Coordinates (portrait, 2500×2500 canvas — update after measuring the actual image):
const BOX_NATURAL_TMPL = null; // set to { W, H, frameL, frameT, frameR, frameB, matL, matT, matR, matB, artL, artT, artR, artB } once measured

// Box frame mount (mat) fill colors — Prodigi options.
const MOUNT_COLORS = {
  'Snow White': { r: 252, g: 252, b: 252 },
  'Black':      { r: 20,  g: 20,  b: 18  },
  'Off-white':  { r: 237, g: 232, b: 219 }, // warm off-white, matches Prodigi's "Off-white" mount
};

// Rotate a bounding box 90° CW inside a square canvas of size S.
// Transform: (x, y) → (S − y, x)
// Bounding box (L, T, R, B) → (S−B, L, S−T, R)
function rotRect(L, T, R, B, S) {
  return { L: S - B, T: L, R: S - T, B: R };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { imageUrl, frameColor = 'Black', frameStyle = 'classic', mountColor = 'Snow White' } = req.query;
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
      // Use dedicated natural template if it exists and coordinates are set; otherwise fall back to black + tint.
      const naturalPath = path.join(FRAMES_DIR, BOX_NATURAL_TMPL_FILE);
      const useNaturalTmpl = frameColor === 'Natural' && BOX_NATURAL_TMPL !== null && fs.existsSync(naturalPath);
      let rawTmplBuf = fs.readFileSync(useNaturalTmpl ? naturalPath : path.join(FRAMES_DIR, 'Box black framed print face on.jpg'));
      let tmplCoords = useNaturalTmpl ? BOX_NATURAL_TMPL : BOX_TMPL;
      let { W, H, frameL, frameT, frameR, frameB, matL, matT, matR, matB, artL, artT, artR, artB } = tmplCoords;

      // Template art area is landscape. If photo is portrait, rotate template 90° CW
      // so art area becomes portrait. Template is non-square (W×H), so after 90° CW
      // rotation the canvas becomes H×W — use old H as the rotRect dimension (S).
      if (isPortrait) {
        rawTmplBuf = await sharp(rawTmplBuf).rotate(90).toBuffer();
        const S = H; // 90° CW of W×H → new width = H, use H for coordinate transform
        const f = rotRect(frameL, frameT, frameR, frameB, S);
        const m = rotRect(matL,   matT,   matR,   matB,   S);
        const a = rotRect(artL,   artT,   artR,   artB,   S);
        frameL = f.L; frameT = f.T; frameR = f.R; frameB = f.B;
        matL   = m.L; matT   = m.T; matR   = m.R; matB   = m.B;
        artL   = a.L; artT   = a.T; artR   = a.R; artB   = a.B;
        [W, H] = [H, W]; // canvas is now H×W after rotation
      }

      const artW = artR - artL;
      const artH = artB - artT;

      // 1. Erase the template artwork: fill the entire mat+art interior.
      //    Mat color set by mountColor param (Snow White / Black / Hayseed).
      const interiorW = matR - matL;
      const interiorH = matB - matT;
      const matColor = MOUNT_COLORS[mountColor] || MOUNT_COLORS['Snow White'];
      const creamBuf = await sharp({
        create: { width: interiorW, height: interiorH, channels: 3, background: matColor },
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
      //    Skip if using a dedicated natural template (already the right color).
      //    evenodd path = outer frame rect minus mat rect → frame ring only.
      if (frameColor !== 'Black' && !useNaturalTmpl) {
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

    // Rotate template 90° CW if photo orientation doesn't match template orientation.
    // Black template is stored landscape; all others are portrait — handled automatically.
    const tmplIsPortrait = (artB - artT) > (artR - artL);
    if ((isLandscape && tmplIsPortrait) || (isPortrait && !tmplIsPortrait)) {
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
