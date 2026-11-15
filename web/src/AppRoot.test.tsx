import { render, screen } from "@testing-library/react";
import { http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue } from "@/auth/context";
import { API, makeSong } from "@/test/handlers";
import { server } from "@/test/server";

/*
 * The handoff from the server's render to the app: the song the server read is
 * the one the page draws first. The real provider builds the Prelude SDK at
 * import time, so a guest stands in for it.
 */

vi.mock("@/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider value={{ user: null, loading: false } as AuthContextValue}>
      {children}
    </AuthContext.Provider>
  ),
}));

const { default: AppRoot } = await import("./AppRoot");

describe("the app, handed a song by the server", () => {
  it("draws that song before the API answers, and still asks for a fresh copy", async () => {
    const song = makeSong({ title: "From the server" });
    const asked: string[] = [];
    // Never answers: anything drawn came from the seed.
    server.use(
      http.get(`${API}/api/v1/songs/:ref`, ({ params }) => {
        asked.push(String(params.ref));
        return new Promise<never>(() => {});
      }),
    );
    window.history.pushState({}, "", `/songs/${song.slug}`);

    render(<AppRoot seeded={{ ref: song.slug, song }} />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "From the server" }),
    ).toBeInTheDocument();
    // The server's copy may be minutes old, so it is refetched at once.
    expect(asked).toEqual([song.slug]);
  });
});
