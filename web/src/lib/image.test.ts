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

  // Rounded, not truncated: only an odd difference tells them apart.
  it("rounds an odd offset", () => {
    expect(coverRect(101, 100)).toEqual({ x: 1, y: 0, size: 100 });
  });
});

describe("toSquareJpeg", () => {
  const file = () => new File(["not really an image"], "photo.png", { type: "image/png" });

  // The vitest config restores spies but not globals, and a spec below leaves a
  // decoder that always rejects.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodes with the image's own orientation", async () => {
    const stub = stubImagePipeline();

    await toSquareJpeg(file());

    // EXIF is stripped by the re-encode, so the rotation must be baked in here.
    expect(stub.decoded).toEqual([{ imageOrientation: "from-image" }]);
  });

  it("crops the middle of the source and fills the square", async () => {
    const stub = stubImagePipeline({ width: 1200, height: 800 });

    await toSquareJpeg(file());

    expect(stub.canvases).toEqual([[AVATAR_SIZE, AVATAR_SIZE]]);
    expect(stub.draws).toEqual([[200, 0, 800, 800, 0, 0, AVATAR_SIZE, AVATAR_SIZE]]);
  });

  it("never upscales a picture smaller than the target", async () => {
    const stub = stubImagePipeline({ width: 64, height: 64 });

    await toSquareJpeg(file());

    expect(stub.canvases).toEqual([[64, 64]]);
  });

  it("returns what the canvas encoded", async () => {
    const stub = stubImagePipeline();

    await expect(toSquareJpeg(file())).resolves.toBe(stub.output);
  });

  // Each failure carries its own name, since the advice for each differs.
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
