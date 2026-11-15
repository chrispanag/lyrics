// Renders the SVG sources here into the PNG/ICO assets in ../public. Run with
// `make icons` after changing a source; nothing in the build does.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import pngToIco from "png-to-ico";

const here = import.meta.dirname;
const out = path.resolve(here, "..", "public");

const SQUARE = path.join(here, "icon-square.svg");
const MASKABLE = path.join(here, "icon-maskable.svg");
const OG = path.join(here, "og-card.svg");
// Both a shipped asset and the ICO's source (see below).
const FAVICON = path.resolve(out, "favicon.svg");

/**
 * `--color-brand-600`/`-700` from styles/index.css, converted to sRGB by hand:
 * the ramp is `oklch()` only and a static SVG cannot read it. `assertBrand`
 * fails the run if the hardcoded copies drift apart.
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
 * The default `density` supersamples the downscaled icons. `palette: true` is
 * lossless on the flat icons; not on the og card, whose gradient would dither.
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

// The og card's text uses a system font — look at it after regenerating.
// Native density: the source is already the output size.
await writeFile(path.join(out, "og-card.png"), await render(OG, 1200, 630, { density: 72 }));
console.log("og-card.png (1200x630)");

// The ICO comes from favicon.svg, not icon-square.svg: a tab draws it as
// authored, so it must be the same rounded tile the SVG favicon shows.
// Only 16/32: png-to-ico stores uncompressed BMP, so larger entries are costly.
const ico = await pngToIco(await Promise.all([16, 32].map((s) => icon(FAVICON, s))));
await writeFile(path.join(out, "favicon.ico"), ico);
console.log("favicon.ico (16/32)");
