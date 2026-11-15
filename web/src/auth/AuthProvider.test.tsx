import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "./AuthProvider";
import { storeUser, storedUser } from "./storedUser";
import { useAuth } from "./useAuth";
import { makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";

// Replaced wholesale: the real client contacts a live session domain, and
// `getAccessToken` is what each test times the restore against.
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

// Back to no session. The braces matter: returning the mock from `beforeEach`
// would hand Vitest a teardown callback.
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

// The real provider shadows `renderWithProviders`' stubbed auth context.
function renderProvider() {
  return renderWithProviders(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe("AuthProvider", () => {
  // No guest flash while restoring: asserted before the held token resolves.
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

    // The confirmed profile (no seeded name) replaces the guess.
    expect(await screen.findByText("singer@example.com")).toBeInTheDocument();
    expect(screen.getByText("settled")).toBeInTheDocument();
  });

  // A plain restore has no call site of its own to write the snapshot.
  it("remembers a restored session for the next load", async () => {
    session.getAccessToken.mockResolvedValue("token");

    renderProvider();

    expect(await screen.findByText("singer@example.com")).toBeInTheDocument();
    expect(storedUser()?.email).toBe("singer@example.com");
  });

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
  // A profile without `email_verified_at`; see `asUser`.
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
