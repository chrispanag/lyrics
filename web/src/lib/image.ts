/**
 * The edge of the square the API is sent, in pixels.
 *
 * The largest an avatar is ever drawn is 80 CSS pixels, which is 240 device
 * pixels on a 3x screen — so this is the smallest size that is still sharp
 * everywhere it is used. The admin list renders fifty of them at 40px, so the
 * difference between this and a larger square is paid fifty times over.
 */
export const AVATAR_SIZE = 256;

/** JPEG quality for that square. */
const AVATAR_QUALITY = 0.85;

/**
 * The largest file worth decoding at all, in megabytes.
 *
 * A phone photo is a few megabytes; a raw or panoramic one is tens. Decoding
 * that on the phone that took it is what runs the tab out of memory, and it
 * fails in ways no message explains — so the file is refused before
 * `createImageBitmap` is handed it. Exported so the message that reports the
 * refusal can name the same number the refusal used.
 */
export const MAX_SOURCE_MB = 20;

const MAX_SOURCE_BYTES = MAX_SOURCE_MB * 1024 * 1024;

/**
 * The names the failures here carry.
 *
 * A page cannot render a bare `Error` — `errorMessage` only passes through the
 * API's own messages — so these are matched by name, the way the auth screens
 * match Prelude's error names. They are two rather than one because the advice
 * differs: "try a JPEG or PNG" is useless to someone who supplied a 25 MB JPEG,
 * and telling them to pick a smaller photo is useless to someone whose browser
 * has no decoder for what they picked.
 */
export const IMAGE_UNREADABLE_ERROR = "ImageUnreadableError";
export const IMAGE_TOO_LARGE_ERROR = "ImageTooLargeError";

function named(name: string, cause: unknown): Error {
  const error = new Error("That image could not be prepared.", { cause });
  error.name = name;
  return error;
}

function unreadable(cause: unknown): Error {
  return named(IMAGE_UNREADABLE_ERROR, cause);
}

/**
 * The largest centered square of a source image, in source coordinates.
 *
 * Center-cropped rather than squashed: a portrait photo letterboxed into a
 * square avatar is mostly background, and stretched it is a caricature.
 */
export function coverRect(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height);
  return {
    x: Math.round((width - size) / 2),
    y: Math.round((height - size) / 2),
    size,
  };
}

/**
 * Center-crops a chosen file to a square JPEG small enough to upload.
 *
 * The server re-encodes whatever arrives, so this is not the validation step —
 * it is what keeps a 4 MB photo under the API's 1 MB cap, and what lets the
 * upload happen at all on a phone.
 */
export async function toSquareJpeg(file: Blob): Promise<Blob> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw named(IMAGE_TOO_LARGE_ERROR, `file is ${file.size} bytes`);
  }

  let bitmap: ImageBitmap;
  try {
    // `from-image` is passed explicitly. A photo from a phone stores its
    // rotation as EXIF metadata, both this re-encode and the server's strip it,
    // and the option's default has changed once already — so without saying so
    // here, every portrait taken on a phone can be stored on its side, and only
    // photos from phones.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (caught) {
    // Also the HEIC case: an iPhone photo copied to a desktop browser that has
    // no decoder for it arrives here, and "could not be prepared" is the honest
    // thing to say about it.
    throw unreadable(caught);
  }

  try {
    const { x, y, size: source } = coverRect(bitmap.width, bitmap.height);
    // Never upscaled: a 64px picture stays 64px rather than becoming a blurry
    // 256px one that costs more to store.
    const edge = Math.min(AVATAR_SIZE, source);

    const canvas = document.createElement("canvas");
    canvas.width = edge;
    canvas.height = edge;
    const context = canvas.getContext("2d");
    if (!context) throw unreadable("no 2d context");
    context.drawImage(bitmap, x, y, source, source, 0, 0, edge, edge);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(unreadable("toBlob returned nothing"))),
        "image/jpeg",
        AVATAR_QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}
