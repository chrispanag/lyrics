import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AVATAR_SIZE,
  IMAGE_TOO_LARGE_ERROR,
  IMAGE_UNREADABLE_ERROR,
  MAX_SOURCE_MB,
  coverRect,
  toSquareJpeg,
} from "@/lib/image";
import { stubImagePipeline } from "@/test/canvas";

describe("coverRect", () => {
  it("takes the middle of a landscape image", () => {
    expect(coverRect(1200, 800)).toEqual({ x: 200, y: 0, size: 800 });
  });

  it("takes the middle of a portrait image", () => {
    expect(coverRect(400, 900)).toEqual({ x: 0, y: 250, size: 400 });
  });

  it("leaves a square alone", () => {
    expect(coverRect(640, 640)).toEqual({ x: 0, y: 0, size: 640 });
  });

  // Rounded rather than truncated, and pinned because an odd difference is the
  // only case where the two differ — a half pixel of offset either way.
  it("rounds an odd offset", () => {
    expect(coverRect(101, 100)).toEqual({ x: 1, y: 0, size: 100 });
  });
});

describe("toSquareJpeg", () => {
  const file = () => new File(["not really an image"], "photo.png", { type: "image/png" });

  // Each spec installs its own stubs, and the last of them leaves behind a
  // decoder that always rejects. Nothing in the vitest config restores globals,
  // so without this the next spec appended below would fail for a reason it
  // never mentions.
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("decodes with the image's own orientation", async () => {
    const stub = stubImagePipeline();

    await toSquareJpeg(file());

    // The one thing that cannot be seen in the result: EXIF is stripped by this
    // re-encode, so a portrait photo from a phone is stored on its side unless
    // the rotation is baked into the pixels here.
    expect(stub.decoded).toEqual([{ imageOrientation: "from-image" }]);
  });

  it("crops the middle of the source and fills the square", async () => {
    const stub = stubImagePipeline({ width: 1200, height: 800 });

    await toSquareJpeg(file());

    expect(stub.canvases).toEqual([[AVATAR_SIZE, AVATAR_SIZE]]);
    expect(stub.draws).toEqual([[200, 0, 800, 800, 0, 0, AVATAR_SIZE, AVATAR_SIZE]]);
  });

  // A small picture blown up to 512px is blurrier and costs more to store than
  // the one that was chosen.
  it("never upscales a picture smaller than the target", async () => {
    const stub = stubImagePipeline({ width: 64, height: 64 });

    await toSquareJpeg(file());

    expect(stub.canvases).toEqual([[64, 64]]);
  });

  it("returns what the canvas encoded", async () => {
    const stub = stubImagePipeline();

    await expect(toSquareJpeg(file())).resolves.toBe(stub.output);
  });

  // Both failures below reach a page that can only render a message it
  // recognizes, so both have to arrive under the same name.
  // Under its own name: "try a JPEG or PNG" is no help to someone who supplied
  // a 25 MB JPEG, so the two failures cannot share one message.
  it("refuses a file too large to decode, before decoding it", async () => {
    const stub = stubImagePipeline();
    const huge = file();
    Object.defineProperty(huge, "size", { value: (MAX_SOURCE_MB + 1) * 1024 * 1024 });

    await expect(toSquareJpeg(huge)).rejects.toMatchObject({ name: IMAGE_TOO_LARGE_ERROR });
    expect(stub.decoded).toEqual([]);
  });

  it("names a decode failure the same way", async () => {
    stubImagePipeline();
    // What a HEIC photo from a phone does in a browser with no decoder for it.
    vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("unsupported format")));

    await expect(toSquareJpeg(file())).rejects.toMatchObject({ name: IMAGE_UNREADABLE_ERROR });
  });
});
