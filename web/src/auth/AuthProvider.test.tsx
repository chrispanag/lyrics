import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "./AuthProvider";
import { storeUser, storedUser } from "./storedUser";
import { useAuth } from "./useAuth";
import { makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";

// The real client reaches for a live session domain on construction, so the
// module that owns it is replaced wholesale — which is also what puts the
// restore under this spec's control: `getAccessToken` is the call every one of
// these tests is timed against.
const session = vi.hoisted(() => ({
  getAccessToken: vi.fn(async (): Promise<string | null> => null),
  logout: vi.fn(async () => {}),
}));

vi.mock("./session", () => ({
  OTP_LOGIN_CONFIG_ID: "otp-config",
  getAccessToken: session.getAccessToken,
  sessionClient: {
    logout: session.logout,
    invalidateCache: async () => {},
  },
}));

// Back to the factory's answer — no session — so a test that wants another one
// has to say so. `mockReset` restores the implementation `vi.fn` was given. The
// braces are load-bearing: `mockReset` answers with the mock, and a `beforeEach`
// returning a function has handed Vitest a teardown callback — which it then
// calls, awaiting whatever the mock answers.
beforeEach(() => {
  session.getAccessToken.mockReset();
});

/** Everything these specs need to see: who the app thinks is here, and whether it knows. */
function Probe() {
  const { user, loading, logout } = useAuth();

  return (
    <div>
      <p>{user ? (user.display_name ?? user.email) : "guest"}</p>
      <p>{loading ? "restoring" : "settled"}</p>
      <button onClick={() => void logout()}>Sign out</button>
    </div>
  );
}

// The real provider, nested inside the shared harness. `renderWithProviders`
// stubs the auth context, and the provider under test shadows that stub for
// everything below it — the same nesting `ProfilePage`'s spec uses where the
// fixed stub cannot express what is being tested.
function renderProvider() {
  return renderWithProviders(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe("AuthProvider", () => {
  /*
   * The bug this pins: restoring a session is two round trips, and until they
   * landed the provider said "nobody is here" — so every refresh of a signed-in
   * page painted the guest chrome first and replaced it a moment later. The
   * assertion has to be made *before* the restore resolves, which is why the
   * token is held here rather than resolved.
   */
  it("paints the last session's profile while the real one is on its way", async () => {
    storeUser(makeUser({ display_name: "Νίκος" }));

    let landed: (token: string | null) => void = () => {};
    session.getAccessToken.mockImplementation(
      () => new Promise<string | null>((resolve) => (landed = resolve)),
    );

    renderProvider();

    expect(screen.getByText("Νίκος")).toBeInTheDocument();
    expect(screen.getByText("restoring")).toBeInTheDocument();

    landed("token");

    // And the confirmed profile replaces the guess: the seeded name is not on
    // the account `GET /me` answers with.
    expect(await screen.findByText("singer@example.com")).toBeInTheDocument();
    expect(screen.getByText("settled")).toBeInTheDocument();
  });

  // The snapshot is written by the provider rather than by whoever set a user,
  // so it has to survive a plain restore — the only path with no call site of
  // its own to have remembered.
  it("remembers a restored session for the next load", async () => {
    session.getAccessToken.mockResolvedValue("token");

    renderProvider();

    expect(await screen.findByText("singer@example.com")).toBeInTheDocument();
    expect(storedUser()?.email).toBe("singer@example.com");
  });

  // A snapshot outliving the session it describes is the one way this can show
  // the wrong thing twice, so a restore that finds nothing has to forget.
  it("forgets a session that is gone", async () => {
    storeUser(makeUser({ display_name: "Νίκος" }));
    session.getAccessToken.mockResolvedValue(null);

    renderProvider();

    expect(await screen.findByText("guest")).toBeInTheDocument();
    expect(storedUser()).toBeNull();
  });

  it("forgets a signed-out session", async () => {
    session.getAccessToken.mockResolvedValue("token");

    renderProvider();
    expect(await screen.findByText("singer@example.com")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByText("guest")).toBeInTheDocument();
    expect(storedUser()).toBeNull();
  });
});

describe("auth/storedUser", () => {
  // A profile from before `email_verified_at` existed: why that field is one of
  // the four checked is on `asUser`.
  it("refuses a profile from an older shape", () => {
    localStorage.setItem(
      "lyrics:last-user",
      JSON.stringify({ id: "user-1", email: "singer@example.com", role: "user" }),
    );

    expect(storedUser()).toBeNull();
  });

  it("refuses anything that is not a profile", () => {
    localStorage.setItem("lyrics:last-user", "not json at all");

    expect(storedUser()).toBeNull();
  });
});
