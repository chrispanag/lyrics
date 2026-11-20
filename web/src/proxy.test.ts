import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "./proxy";

function ask(path: string, accept: string, method = "GET") {
  return proxy(
    new NextRequest(`https://songfolio.live${path}`, {
      method,
      headers: { Accept: accept },
    }),
  );
}

describe("proxy", () => {
  it("serves Markdown for the homepage, with Vary and the markdown type", async () => {
    const response = await ask("/", "text/markdown");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("vary")).toMatch(/accept/i);
    const body = await response.text();
    expect(body.length).toBeGreaterThan(20);
    expect(body).toContain("# Greek and English song lyrics");
  });

  it("serves a Markdown 404 for an unknown address", async () => {
    const response = await ask("/__ora-404-probe-lt3w0wgy", "text/markdown");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("vary")).toMatch(/accept/i);
    const body = await response.text();
    expect(body.length).toBeGreaterThanOrEqual(20);
    expect(body).toContain("https://songfolio.live/llms.txt");
    expect(body).toContain("`/__ora-404-probe-lt3w0wgy`");
  });

  it("keeps HTML on the renderer", async () => {
    const response = await ask("/", "text/html");

    expect(response.headers.get("content-type") ?? "").not.toContain("text/markdown");
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("answers 406 when the client rejects both representations", async () => {
    const response = await ask("/", "application/pdf");

    expect(response.status).toBe(406);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("vary")).toMatch(/accept/i);
    expect(await response.text()).toContain("text/markdown");
  });

  it("omits the body of a HEAD request and still says Markdown", async () => {
    const response = await ask("/", "text/markdown", "HEAD");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await response.text()).toBe("");
  });

  it("does not negotiate a Next.js flight request", async () => {
    const response = await proxy(
      new NextRequest("https://songfolio.live/", {
        headers: { Accept: "text/x-component", RSC: "1" },
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
