import { describe, expect, it, vi } from "vitest";

import { decide } from "./negotiate";

vi.mock("./agentDocument", () => ({
  markdownFor: vi.fn(async (pathname: string) => ({
    status: pathname === "/" ? 200 : 404,
    body: pathname,
  })),
}));

const get = (
  pathname: string,
  accept: string | null,
  extra: Partial<{ method: string; nextFlight: boolean }> = {},
) =>
  decide({
    method: extra.method ?? "GET",
    pathname,
    accept,
    nextFlight: extra.nextFlight ?? false,
  });

describe("decide", () => {
  it("lets HTML, flights, files, and other methods through", async () => {
    expect(await get("/", "text/html")).toEqual({ kind: "pass" });
    expect(await get("/", null)).toEqual({ kind: "pass" });
    expect(await get("/", "text/markdown", { nextFlight: true })).toEqual({ kind: "pass" });
    expect(await get("/llms.txt", "text/markdown")).toEqual({ kind: "pass" });
    expect(await get("/openapi.json", "text/markdown")).toEqual({ kind: "pass" });
    expect(await get("/.well-known/oauth-protected-resource", "text/markdown")).toEqual({
      kind: "pass",
    });
    expect(await get("/_next/static/chunk.js", "text/markdown")).toEqual({ kind: "pass" });
    expect(await get("/", "text/markdown", { method: "POST" })).toEqual({ kind: "pass" });
  });

  it("answers the homepage in Markdown and normalizes a trailing slash", async () => {
    expect(await get("/", "text/markdown")).toEqual({
      kind: "markdown",
      status: 200,
      body: "/",
    });
    expect(await get("/login/", "text/markdown")).toEqual({
      kind: "markdown",
      status: 404,
      body: "/login",
    });
    expect(await get("/__ora-404-probe", "text/markdown")).toEqual({
      kind: "markdown",
      status: 404,
      body: "/__ora-404-probe",
    });
  });

  it("refuses a type the site does not produce", async () => {
    expect(await get("/", "application/pdf")).toEqual({ kind: "unacceptable" });
    expect(await get("/", "text/html;q=0, text/markdown;q=0")).toEqual({ kind: "unacceptable" });
  });

  it("prefers Markdown when the client ranks it above HTML", async () => {
    expect(await get("/", "text/markdown, text/html;q=0.8")).toMatchObject({
      kind: "markdown",
      status: 200,
    });
  });
});
