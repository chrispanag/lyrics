// Renders the tracked SVG sources in this directory into the PNG/ICO assets in
// ../public. Run it with `make icons` after changing a source; nothing in the
// build does, and that target is where the install step lives.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import pngToIco from "png-to-ico";

const here = import.meta.dirname;
const out = path.resolve(here, "..", "public");

const SQUARE = path.join(here, "icon-square.svg");
const MASKABLE = path.join(here, "icon-maskable.svg");
const OG = path.join(here, "og-card.svg");
// The tab icon, drawn at a 32 viewBox with rounded corners. It is a source here
// as well as a shipped asset — see the ICO note at the bottom.
const FAVICON = path.resolve(out, "favicon.svg");

/**
 * The brand ramp, converted to sRGB by hand.
 *
 * These are the values `--color-brand-600` and `--color-brand-700` in
 * styles/index.css evaluate to. Nothing derives them: the ramp exists only as
 * `oklch()` custom properties, and neither a static SVG nor the manifest can
 * read those without build tooling this project does not have. So they are
 * copied, and `assertBrand` below is what stops the copies drifting apart —
 * that check replaced a prose inventory of which files hold them, which was
 * wrong within a release of being written.
 */
const BRAND = { "brand-600": "#c6481c", "brand-700": "#a33b14" };

/** Every source that hardcodes a brand value, and which ones it must contain. */
const BRAND_USERS = [
  [FAVICON, ["brand-600"]],
  [SQUARE, ["brand-600"]],
  [MASKABLE, ["brand-600"]],
  [OG, ["brand-600", "brand-700"]],
];

async function assertBrand() {
  const drifted = [];
  for (const [file, tokens] of BRAND_USERS) {
    const text = await readFile(file, "utf8");
    for (const token of tokens) {
      if (!text.includes(BRAND[token])) {
        drifted.push(`  ${path.relative(here, file)} no longer contains ${BRAND[token]} (${token})`);
      }
    }
  }
  if (drifted.length) {
    console.error(
      `Brand colors have drifted:\n${drifted.join("\n")}\n\n` +
        "Either the ramp in styles/index.css moved and these sources were not " +
        "all updated, or BRAND in this file is stale. Nothing else checks this.",
    );
    process.exit(1);
  }
}

/**
 * `density` scales rasterization: the sources declare 512 and 1200 CSS px at the
 * default 72, so 384 supersamples 5.3x. That is worth it for the icons, which
 * are all downscales of a 512 source — the 16px ICO entry most of all.
 *
 * `palette: true` is bit-exact on the icons and halves them: flat ground, one
 * disc, one ring, comfortably under 256 colors even counting antialiased edges.
 * It is deliberately NOT used on the og card, whose ground is a two-stop
 * gradient across the full diagonal — quantizing that means dithering a smooth
 * ramp, and social platforms re-encode whatever we send them. The card is
 * fetched by scrapers rather than by visitors, so its bytes are unfurl latency
 * and not page weight, which is the wrong side of that trade to optimize.
 */
const render = (src, width, height = width, { density = 384, ...png } = {}) =>
  sharp(src, { density })
    .resize(width, height)
    .png({ compressionLevel: 9, ...png })
    .toBuffer();

const icon = (src, size) => render(src, size, size, { palette: true });

await assertBrand();
await mkdir(out, { recursive: true });

const targets = [
  ["apple-touch-icon.png", SQUARE, 180],
  ["icon-192.png", SQUARE, 192],
  ["icon-512.png", SQUARE, 512],
  ["icon-512-maskable.png", MASKABLE, 512],
];

for (const [name, src, size] of targets) {
  await writeFile(path.join(out, name), await icon(src, size));
  console.log(`${name} (${size}x${size})`);
}

// The og card is the one non-square output, and the only one whose text is
// resolved against a system font — look at it after regenerating. Rendered at
// its native density because the source is already the output size, so the text
// rasterizes straight to its final scale rather than through a 6400px
// intermediate.
await writeFile(path.join(out, "og-card.png"), await render(OG, 1200, 630, { density: 72 }));
console.log("og-card.png (1200x630)");

// The ICO comes from favicon.svg, NOT from icon-square.svg like everything
// above. An .ico is drawn into a tab exactly as authored, so it has to be the
// same rounded tile the SVG shows — otherwise the icon's shape depends on which
// entry the browser happened to pick. The square full-bleed source exists for
// the platforms that composite their own mask over it, which a tab does not do.
// It also matters at 16px: favicon.svg is drawn at a 32 viewBox for this size,
// where the 512 source's ring is a sub-pixel smudge.
//
// 16/32 is the whole list on purpose: png-to-ico stores uncompressed 32-bit
// BMP, not PNG, so an entry costs width*height*4 bytes flat however few colors
// the art has. A 48px entry is 9,640 B of them — it was two thirds of this file.
// Adding 64 or 128 "for Windows shortcuts" costs 17 kB and 66 kB.
const ico = await pngToIco(await Promise.all([16, 32].map((s) => icon(FAVICON, s))));
await writeFile(path.join(out, "favicon.ico"), ico);
console.log("favicon.ico (16/32)");
