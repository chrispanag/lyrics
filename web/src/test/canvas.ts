import { vi } from "vitest";

/*
 * Stubs for `createImageBitmap` and canvas, which jsdom lacks. They record the
 * decode options and canvas sizes the code chose; nothing is actually drawn.
 */

export interface ImagePipelineStub {
  /** The options each `createImageBitmap` call was made with, in order. */
  decoded: ImageBitmapOptions[];
  /** The `[width, height]` of each canvas the code drew onto. */
  canvases: [number, number][];
  /** The source rectangle each `drawImage` copied, as its raw arguments. */
  draws: number[][];
  /** The blob `toBlob` hands back, which is what gets uploaded. */
  output: Blob;
}

/** Installs the stubs and returns what they record. */
export function stubImagePipeline(
  source: { width: number; height: number } = { width: 1200, height: 800 },
): ImagePipelineStub {
  const stub: ImagePipelineStub = {
    decoded: [],
    canvases: [],
    draws: [],
    // Enough of a JPEG to be a plausible upload; nothing decodes it.
    output: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }),
  };

  vi.stubGlobal(
    "createImageBitmap",
    vi.fn((_source: Blob, options?: ImageBitmapOptions) => {
      stub.decoded.push(options ?? {});
      return Promise.resolve({
        width: source.width,
        height: source.height,
        close: () => {},
      } as ImageBitmap);
    }),
  );

  const context = {
    drawImage: (_image: unknown, ...rest: number[]) => stub.draws.push(rest),
  } as unknown as CanvasRenderingContext2D;

  // Not an arrow function: the canvas being recorded is `this`.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    stub.canvases.push([this.width, this.height]);
    return context;
  });

  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
    callback(stub.output),
  );

  return stub;
}
