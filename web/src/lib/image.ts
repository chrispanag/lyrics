/**
 * The edge of the square the API is sent, in pixels: the smallest still sharp
 * at the largest size an avatar is drawn, on a 3x screen.
 *
 * Mirrors `imaging.StoredEdge` (Go); the smaller of the two wins. Change both.
 */
export const AVATAR_SIZE = 256;

/** JPEG quality for that square. */
const AVATAR_QUALITY = 0.85;

/**
 * The largest file worth decoding, in megabytes. Larger ones are refused before
 * `createImageBitmap`, which can run a phone's tab out of memory. Exported so the
 * refusal message names the same number.
 */
export const MAX_SOURCE_MB = 20;

const MAX_SOURCE_BYTES = MAX_SOURCE_MB * 1024 * 1024;

/**
 * The names the failures here carry. Pages match on them, since `errorMessage`
 * only passes through the API's own messages; two names because the advice differs.
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

/** The largest centered square of a source image, in source coordinates. */
export function coverRect(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height);
  return {
    x: Math.round((width - size) / 2),
    y: Math.round((height - size) / 2),
    size,
  };
}

/**
 * Center-crops a chosen file to a square JPEG small enough to upload. Not
 * validation (the server re-encodes); it keeps photos under the API's 1 MB cap.
 */
export async function toSquareJpeg(file: Blob): Promise<Blob> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw named(IMAGE_TOO_LARGE_ERROR, `file is ${file.size} bytes`);
  }

  let bitmap: ImageBitmap;
  try {
    // Explicit: both re-encodes strip EXIF, so without it phone portraits are
    // stored on their side.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (caught) {
    // Also a HEIC photo in a browser with no decoder for it.
    throw unreadable(caught);
  }

  try {
    const { x, y, size: source } = coverRect(bitmap.width, bitmap.height);
    // Never upscaled.
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
