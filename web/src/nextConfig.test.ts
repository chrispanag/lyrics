// @vitest-environment node
import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";
import { ADMIN_TABS } from "@/routes/adminTabs";

/*
 * What `next.config.ts` decides before any route renders. `next start` is what
 * shows it working (a document load of /admin answering 307); this pins that the
 * entry is there and still reads its destination from the tab list.
 */

describe("next.config redirects", () => {
  it("sends /admin to the first tab as a real redirect, not a permanent one", async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    expect(redirects).toContainEqual({
      source: "/admin",
      destination: ADMIN_TABS[0].to,
      permanent: false,
    });
  });
});

describe("next.config headers", () => {
  it("serves llms.txt with the same day-long cache as the other public files", async () => {
    const headers = (await nextConfig.headers?.()) ?? [];
    const cached = headers.find(({ headers: list }) =>
      list.some(({ key, value }) => key === "Cache-Control" && value.includes("max-age=86400")),
    );
    expect(cached?.source).toContain("llms.txt");
  });
});
