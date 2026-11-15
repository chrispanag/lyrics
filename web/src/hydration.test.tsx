import { act, waitFor, within } from "@testing-library/react";
import { type DehydratedState, QueryClient, dehydrate, hydrate } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import type { ReactElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { AuthProvider } from "@/auth/AuthProvider";
import { storeUser } from "@/auth/storedUser";
import { storeFontSize } from "@/lib/fontSize";
import type { User } from "@/lib/types";
import { storeTheme } from "@/lib/theme";
import CatalogPage from "@/app/(shell)/page";
import { catalogGenres, catalogList, catalogSongs } from "@/test/catalog";
import { API, list, listById, makePerson, makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { handover } from "@/test/serverTree";
import { server } from "@/test/server";
import { TestProviders } from "@/test/TestProviders";
import { TestApp } from "@/test/app";

/*
 * The hydration check CLAUDE.md asks for under "The Next.js shell": each screen
 * is rendered to a string as a server would (no storage, no session), then the
 * browser's storage is seeded and the same tree hydrated over that HTML. React
 * recovering from a mismatch, or warning about one, fails the case.
 *
 * jsdom renders the server half, so a read of `window` would not throw here;
 * `serverRender.test.tsx` renders under Node for that. What this file adds is
 * the comparison: a stored value read while rendering is invisible to a spec
 * that renders once.
 */

// Never resolves: the restore stays in flight, which is the window the
// snapshot exists to paint, and nothing here may reach the real SDK.
vi.mock("@/auth/session", () => ({
  OTP_LOGIN_CONFIG_ID: "",
  getAccessToken: () => new Promise<string | null>(() => {}),
  sessionClient: () => {
    throw new Error("the SDK is not for specs");
  },
}));

/**
 * A client with the screen's data already in it, as a server page would hand
 * over. Not `testQueryClient`: its zero `gcTime` can collect an entry nothing
 * observes yet before hydration reads it.
 */
function clientWith(state: DehydratedState): QueryClient {
  const client = new QueryClient({
    // Fresh forever: a refetch during hydration is noise, not a mismatch.
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  hydrate(client, state);
  return client;
}

/**
 * What the screen at `route` fetches, read by mounting it once against the
 * stubbed API. The server half has nothing to fetch with, so it renders from
 * this, exactly as a server page hands its reads to `HydrationBoundary`.
 */
async function dataFor(route: string, user: User | null): Promise<DehydratedState> {
  const { queryClient, unmount } = renderWithProviders(<TestApp />, { route, user });
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  // Twice: a query enabled by another's answer starts a beat later.
  await act(async () => {});
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  // Before unmounting: the test client collects unobserved entries at once.
  const state = dehydrate(queryClient);
  unmount();
  return state;
}

/**
 * Renders `build()` as a server would, seeds storage, hydrates the same tree,
 * and returns everything React said about the two disagreeing.
 */
async function hydrationProblems(
  build: (client: QueryClient) => ReactElement,
  { state, seed }: { state: DehydratedState; seed?: () => void },
): Promise<{ problems: string[]; container: HTMLElement }> {
  // A server has no storage: every read refuses, which each wrapped read
  // answers with its default. The spy also clears whatever priming wrote.
  localStorage.clear();
  const refuse = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("A server has no storage.");
  });
  const html = renderToString(build(clientWith(state)));
  refuse.mockRestore();

  seed?.();

  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);

  const problems: string[] = [];
  // Attribute mismatches are only a development warning in React 19, never a
  // recoverable error, so the console is half of what is listened to.
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    problems.push(args.map(String).join(" "));
  });

  const root = await act(async () =>
    hydrateRoot(container, build(clientWith(state)), {
      onRecoverableError: (error) => problems.push(String(error)),
    }),
  );
  onTestFinished(() => {
    act(() => root.unmount());
    container.remove();
  });

  return { problems, container };
}

/** The route table under the test providers, auth stubbed as `user`. */
function stubbed(route: string, user: User | null) {
  return (client: QueryClient) => (
    <TestProviders queryClient={client} route={route} user={user}>
      <TestApp />
    </TestProviders>
  );
}

describe("hydrating over a server render", () => {
  const reader = makeUser({ display_name: "Νίκος" });

  // The shell around the catalog: the sidebar, the drawer and the search header.
  it("agrees about the catalog and its shell", async () => {
    const state = await dataFor("/", reader);

    const { problems, container } = await hydrationProblems(stubbed("/", reader), { state });

    expect(problems).toEqual([]);
    // The premise: the catalog rendered rows, not its loading state.
    expect(container).toHaveTextContent(catalogSongs[0]?.title ?? "");
  });

  // The route's own reads rather than the screen's: hydrating from them shows
  // the server's keys are the ones the browser's first render looks under.
  it("agrees about a person's songs, from what the catalog route read", async () => {
    server.use(
      http.get(`${API}/api/v1/songs`, () => HttpResponse.json(list(catalogSongs))),
      http.get(`${API}/api/v1/genres`, () => HttpResponse.json(list(catalogGenres))),
    );
    const person = makePerson({ id: "a5ec6a45-541c-4b8f-b3a0-c8ac8aa57e81" });
    const route = `/?person=${person.id}`;
    const tree = await CatalogPage({ searchParams: Promise.resolve({ person: person.id }) });
    const state = handover(tree)?.props.state ?? { queries: [], mutations: [] };

    const { problems, container } = await hydrationProblems(stubbed(route, null), { state });

    expect(problems).toEqual([]);
    expect(container).toHaveTextContent(catalogSongs[4]?.title ?? "");
    expect(document.title).toBe(`Songs by ${person.name} — Songfolio`);
  });

  // The font size and the swipe mark are both stored per device and both
  // decide markup; a list context is what puts the mark on the page.
  it("agrees about a song page reached from a list", async () => {
    server.use(listById(catalogList(3)));
    const route = `/songs/${catalogSongs[0]?.slug}?list=list-1`;
    const state = await dataFor(route, null);

    const { problems, container } = await hydrationProblems(stubbed(route, null), {
      state,
      // The swipe hint is left unspent: no key is what makes it showable.
      seed: () => storeFontSize(3),
    });

    // The stored size, which only the browser has, so hydration has committed:
    // 3 is the largest, so the page cannot grow it.
    await waitFor(() =>
      expect(within(container).getByRole("button", { name: "Increase text size" })).toBeDisabled(),
    );
    expect(problems).toEqual([]);
    expect(container).toHaveTextContent(catalogSongs[0]?.title ?? "");
  });

  // A shared link: the server hands over a guest's read of a public list, and
  // the browser remembers the reader. The rows render on both sides.
  it("agrees about a public list read as a guest", async () => {
    server.use(listById(catalogList(3)));
    const state = await dataFor("/lists/list-1", null);

    const { problems, container } = await hydrationProblems(
      (client) => (
        <TestProviders queryClient={client} route="/lists/list-1">
          <AuthProvider>
            <TestApp />
          </AuthProvider>
        </TestProviders>
      ),
      { state, seed: () => storeUser(reader) },
    );

    await waitFor(() => expect(container).toHaveTextContent("Νίκος"));
    expect(problems).toEqual([]);
    expect(container).toHaveTextContent(catalogSongs[2]?.title ?? "");
  });

  it("agrees about the profile's theme switch", async () => {
    const state = await dataFor("/profile", reader);

    const { problems, container } = await hydrationProblems(stubbed("/profile", reader), {
      state,
      seed: () => storeTheme("dark"),
    });

    // The stored theme, so hydration has committed before problems are read.
    await waitFor(() =>
      expect(within(container).getByRole("radio", { name: "Dark" })).toBeChecked(),
    );
    expect(problems).toEqual([]);
  });

  // The real provider: a server renders a guest, the browser remembers a user.
  it("agrees about who is signed in, then paints the remembered user", async () => {
    const state = await dataFor("/", null);

    const { problems, container } = await hydrationProblems(
      (client) => (
        <TestProviders queryClient={client} route="/">
          <AuthProvider>
            <TestApp />
          </AuthProvider>
        </TestProviders>
      ),
      { state, seed: () => storeUser(reader) },
    );

    // Before any restore has answered: the snapshot, not a guest flash. Only
    // the browser has it, so hydration has also committed.
    await waitFor(() => expect(container).toHaveTextContent("Νίκος"));
    expect(problems).toEqual([]);
  });
});
