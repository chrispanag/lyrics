import { QueryClient, dehydrate } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { keys } from "@/api/hooks";
import { API, makeSong } from "@/test/handlers";
import { server } from "@/test/server";

/*
 * The handoff from the server's render to the app: a song the server read is
 * the one the page draws first. The real provider builds the Prelude SDK at
 * import time, so a settled guest stands in for it.
 */

vi.mock("@/auth/AuthProvider", async () => {
  const { AuthContext } = await import("@/auth/context");
  const { stubAuth } = await import("@/test/providers");
  return {
    AuthProvider: ({ children }: { children: ReactNode }) => (
      <AuthContext.Provider value={stubAuth(null)}>{children}</AuthContext.Provider>
    ),
  };
});

const { default: AppRoot } = await import("./AppRoot");

describe("the app, handed a song by the server", () => {
  it("draws that song before the API answers, and still asks for a fresh copy", async () => {
    const song = makeSong({ title: "From the server" });
    const asked: string[] = [];
    // Never answers: anything drawn came from the handed-over cache.
    server.use(
      http.get(`${API}/api/v1/songs/:ref`, ({ params }) => {
        asked.push(String(params.ref));
        return new Promise<never>(() => {});
      }),
    );
    // The entry as the song page builds it: under the address, stamped stale.
    const client = new QueryClient();
    client.setQueryData(keys.song(song.slug), song, { updatedAt: 0 });
    window.history.pushState({}, "", `/songs/${song.slug}`);

    render(<AppRoot dehydratedState={dehydrate(client)} />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "From the server" }),
    ).toBeInTheDocument();
    // Stale, so it is refetched at once.
    expect(asked).toEqual([song.slug]);
  });
});
