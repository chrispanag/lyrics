import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "./AuthProvider";
import { apiFetch } from "@/api/client";
import {
  PASSWORD_CHANGE_UNAVAILABLE_ERROR,
  RESET_UNCONFIGURED_ERROR,
  type AuthContextValue,
} from "./context";
import { storeUser, storedUser } from "./storedUser";
import { useAuth } from "./useAuth";
import { API, makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

// Replaced wholesale: the real client contacts a live session domain, and
// `getAccessToken` is what each test times the restore against.
type StepUpStatus = "continue" | "review" | "block";

const session = vi.hoisted(() => ({
  // Mutable so one spec can build without an OTP login configuration.
  otpConfigId: "otp-config",
  getAccessToken: vi.fn(async (_force?: boolean): Promise<string | null> => null),
  logout: vi.fn(async () => {}),
  invalidateCache: vi.fn(async () => {}),
  loginWithPassword: vi.fn(async (_input: { identifier: string; password: string }) => {}),
  // No default: `answerStepUp` gives it one before every test.
  requestStepUp:
    vi.fn<
      (input: {
        scope: string;
        onChallenge: (info: { challengeId: string }) => void;
      }) => Promise<{ status: StepUpStatus }>
    >(),
  startOTP: vi.fn(async (_input: unknown) => {}),
  retryOTP: vi.fn(async () => {}),
  checkOTP: vi.fn(async (_input: { code: string; challengeId?: string }) => {}),
  canChangePassword: vi.fn(async () => true),
  changePassword: vi.fn(async (_password: string) => {}),
  revokeSessions: vi.fn(async (_which: string) => {}),
  validatePassword: vi.fn(
    async (
      _password: string,
    ): Promise<{
      valid: boolean;
      results: { criteria: string; expected: number; valid: boolean }[];
    } | null> => null,
  ),
}));

vi.mock("./session", () => ({
  get OTP_LOGIN_CONFIG_ID() {
    return session.otpConfigId;
  },
  getAccessToken: session.getAccessToken,
  sessionClient: () => ({
    logout: session.logout,
    invalidateCache: session.invalidateCache,
    loginWithPassword: session.loginWithPassword,
    requestStepUp: session.requestStepUp,
    startOTP: session.startOTP,
    retryOTP: session.retryOTP,
    checkOTP: session.checkOTP,
    canChangePassword: session.canChangePassword,
    changePassword: session.changePassword,
    revokeSessions: session.revokeSessions,
    validatePassword: session.validatePassword,
  }),
}));

/** The ids Prelude hands out, one per opened challenge, in order. */
let challengeIds: string[] = [];

// Back to no session, and every SDK call to its quiet success: `mockReset`
// restores the implementation each `vi.fn` above was built with. The braces
// matter: returning a mock from `beforeEach` would hand Vitest a teardown
// callback.
beforeEach(() => {
  for (const mock of Object.values(session)) {
    if (typeof mock === "function") mock.mockReset();
  }
  session.otpConfigId = "otp-config";
  challengeIds = ["challenge-1", "challenge-2", "challenge-3"];
  answerStepUp("review");
});

/**
 * Makes `requestStepUp` answer with `status`, opening a challenge (and naming
 * it to the caller) unless the grant needs none or `opens` says otherwise.
 */
function answerStepUp(status: StepUpStatus, { opens = status === "review" } = {}) {
  session.requestStepUp.mockImplementation(async ({ onChallenge }) => {
    if (opens) onChallenge({ challengeId: challengeIds.shift() ?? "challenge-n" });
    return { status };
  });
}

/** The scopes step-ups were requested for, in order. */
function stepUpScopes(): string[] {
  return session.requestStepUp.mock.calls.map(([input]) => input.scope);
}

/** Everything these specs need to see: who the app thinks is here, and whether it knows. */
function Probe() {
  const { user, loading, logout } = useAuth();

  return (
    <div>
      <p>{user ? (user.display_name ?? user.email) : "guest"}</p>
      <p>{loading ? "restoring" : "settled"}</p>
      <button type="button" onClick={() => void logout()}>
        Sign out
      </button>
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

  // A session found dead mid-restore must not stay remembered: the write keys
  // on `user` alone, never waiting for the restore to settle.
  it("forgets a session that answers 401 while the restore is in flight", async () => {
    storeUser(makeUser({ display_name: "Νίκος" }));
    session.getAccessToken.mockImplementation(() => new Promise<string | null>(() => {}));
    server.use(http.get(`${API}/api/v1/lists`, () => new HttpResponse(null, { status: 401 })));

    renderProvider();
    expect(screen.getByText("Νίκος")).toBeInTheDocument();

    await act(() => apiFetch("/api/v1/lists").catch(() => {}));

    expect(screen.getByText("guest")).toBeInTheDocument();
    expect(screen.getByText("restoring")).toBeInTheDocument();
    expect(storedUser()).toBeNull();
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

/** The context value as of the last render, for specs that drive it directly. */
let auth: AuthContextValue;

function Capture() {
  const value = useAuth();
  // After commit, not during render: every call goes through `act`, which
  // flushes this before the next one reads it.
  useEffect(() => {
    auth = value;
  }, [value]);
  return <Probe />;
}

/** Mounts the real provider and waits for the restore to settle. */
async function renderSettled() {
  const rendered = renderWithProviders(
    <AuthProvider>
      <Capture />
    </AuthProvider>,
  );
  expect(await screen.findByText("settled")).toBeInTheDocument();
  return rendered;
}

/** Signs in through the provider, so the session is one its own calls opened. */
async function renderSignedIn() {
  const rendered = await renderSettled();
  await act(() => auth.login("singer@example.com", "hunter22"));
  expect(screen.getByText("singer@example.com")).toBeInTheDocument();
  return rendered;
}

/** Runs a call expected to fail and hands back what it threw. */
async function failure(call: () => Promise<unknown>): Promise<Error> {
  let caught: unknown = null;
  await act(async () => {
    try {
      await call();
    } catch (error) {
      caught = error;
    }
  });
  if (!(caught instanceof Error)) throw new Error("expected the call to fail");
  return caught;
}

describe("AuthProvider sessions", () => {
  it("treats a profile that cannot be read as a guest", async () => {
    session.getAccessToken.mockResolvedValue("token");
    server.use(http.get(`${API}/api/v1/me`, () => new HttpResponse(null, { status: 500 })));

    await renderSettled();

    expect(screen.getByText("guest")).toBeInTheDocument();
  });

  // Skip a step and the session is half open: the SDK still serves the
  // signed-out token, or guest-era responses linger in the cache.
  it("drops the SDK's cache and every guest-era query when a sign-in lands", async () => {
    const { queryClient } = await renderSettled();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(() => auth.login("singer@example.com", "hunter22"));

    expect(session.loginWithPassword).toHaveBeenCalledWith({
      identifier: "singer@example.com",
      password: "hunter22",
    });
    expect(session.invalidateCache).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
    expect(screen.getByText("singer@example.com")).toBeInTheDocument();
  });

  // The SDK cannot create an account; a blank name must not be stored as "".
  it("creates the account through our API and then signs in with it", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/api/v1/auth/register`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(makeUser(), { status: 201 });
      }),
    );
    await renderSettled();

    await act(() =>
      auth.register({ email: "singer@example.com", password: "hunter22", displayName: "   " }),
    );
    await act(() =>
      auth.register({ email: "singer@example.com", password: "hunter22", displayName: " Νίκος " }),
    );

    expect(bodies).toEqual([
      { email: "singer@example.com", password: "hunter22", display_name: null },
      { email: "singer@example.com", password: "hunter22", display_name: "Νίκος" },
    ]);
    expect(session.loginWithPassword).toHaveBeenCalledTimes(2);
    expect(screen.getByText("singer@example.com")).toBeInTheDocument();
  });

  it("takes an updated profile in hand without asking the API again", async () => {
    await renderSignedIn();

    await act(() => auth.reload(makeUser({ display_name: "Ελένη" })));

    expect(screen.getByText("Ελένη")).toBeInTheDocument();
  });

  // The next person at this machine must not see the last one's lists, nor a
  // code form for a code nobody sent them.
  it("signs out completely when a session dies under a request", async () => {
    const { queryClient } = await renderSignedIn();
    queryClient.setQueryData(["lists"], ["cached"]);
    await act(() => auth.startEmailVerification());

    server.use(http.get(`${API}/api/v1/me`, () => new HttpResponse(null, { status: 401 })));
    await act(() => auth.reload());

    expect(screen.getByText("guest")).toBeInTheDocument();
    expect(queryClient.getQueryData(["lists"])).toBeUndefined();
    expect((await failure(() => auth.verifyEmail("123456"))).message).toBe(
      "No verification is in progress.",
    );
  });

  it("clears everything local even when Prelude cannot revoke the session", async () => {
    const { queryClient } = await renderSignedIn();
    queryClient.setQueryData(["lists"], ["cached"]);
    await act(() => auth.startPasswordChange());
    session.logout.mockRejectedValue(new Error("network down"));

    expect((await failure(() => auth.logout())).message).toBe("network down");

    expect(screen.getByText("guest")).toBeInTheDocument();
    expect(queryClient.getQueryData(["lists"])).toBeUndefined();
    expect((await failure(() => auth.confirmPasswordWriteCode("123456"))).message).toBe(
      "No password change is in progress.",
    );
  });
});

describe("AuthProvider email verification", () => {
  // The grant is read off the token, so a cached one predating it gets a 403.
  it("records a grant made outright on a freshly refreshed token", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/verify-email`, () =>
        HttpResponse.json(makeUser({ display_name: "Επαληθευμένος" })),
      ),
    );
    answerStepUp("continue");
    await renderSignedIn();

    await act(() => auth.startEmailVerification());

    expect(session.getAccessToken).toHaveBeenLastCalledWith(true);
    expect(session.startOTP).not.toHaveBeenCalled();
    expect(screen.getByText("Επαληθευμένος")).toBeInTheDocument();
  });

  it("reports a step-up Prelude refused", async () => {
    answerStepUp("block");
    await renderSignedIn();

    expect((await failure(() => auth.startEmailVerification())).message).toMatch(/refused/);
    expect(session.startOTP).not.toHaveBeenCalled();
  });

  // Without a challenge there is nothing for a code to be checked against.
  it("reports a review that opened no challenge rather than sending nothing", async () => {
    answerStepUp("review", { opens: false });
    await renderSignedIn();

    expect((await failure(() => auth.startEmailVerification())).message).toMatch(
      /no "email:verify" challenge/,
    );
    expect(session.startOTP).not.toHaveBeenCalled();
  });

  it("takes in the profile the API answers a checked code with", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/verify-email`, () =>
        HttpResponse.json(makeUser({ display_name: "Επαληθευμένος" })),
      ),
    );
    await renderSignedIn();
    await act(() => auth.startEmailVerification());

    await act(() => auth.verifyEmail("123456"));

    expect(screen.getByText("Επαληθευμένος")).toBeInTheDocument();
  });

  it("resends the code for the challenge already open", async () => {
    await renderSignedIn();
    await act(() => auth.startEmailVerification());

    await act(() => auth.resendVerificationCode());

    expect(session.retryOTP).toHaveBeenCalledOnce();
    expect(stepUpScopes()).toEqual(["email:verify"]);
  });
});

describe("AuthProvider password reset", () => {
  it("names a missing OTP login configuration instead of reading as an outage", async () => {
    session.otpConfigId = "";
    await renderSettled();

    expect((await failure(() => auth.startPasswordReset("singer@example.com"))).name).toBe(
      RESET_UNCONFIGURED_ERROR,
    );
    expect(session.startOTP).not.toHaveBeenCalled();
  });

  it("emails a login code through the OTP login configuration", async () => {
    await renderSettled();

    await act(() => auth.startPasswordReset("singer@example.com"));
    await act(() => auth.resendPasswordResetCode());

    expect(session.startOTP).toHaveBeenCalledExactlyOnceWith({
      identifier: { type: "email_address", value: "singer@example.com" },
      loginConfigId: "otp-config",
    });
    expect(session.retryOTP).toHaveBeenCalledOnce();
  });

  // "Start over" must not leave a reused challenge claiming a code was sent.
  it("drops a password challenge an earlier attempt left open", async () => {
    await renderSignedIn();
    await act(() => auth.startPasswordChange());

    await act(() => auth.startPasswordReset("singer@example.com"));
    await act(() => auth.startPasswordChange());

    expect(stepUpScopes()).toEqual(["prld:pwd:write", "prld:pwd:write"]);
  });

  it("signs the visitor in and reports the second code the write asks for", async () => {
    await renderSettled();

    const answer = await act(() => auth.confirmPasswordResetCode("123456"));

    expect(answer).toEqual({ secondCodeSent: true });
    expect(session.checkOTP).toHaveBeenCalledWith({ code: "123456" });
    expect(stepUpScopes()).toEqual(["prld:pwd:write"]);
    expect(screen.getByText("singer@example.com")).toBeInTheDocument();
  });

  // Granted outright refreshes nothing; without the forced check the write
  // 403s with nothing wrong with the password.
  it("confirms a grant made outright on a refreshed token", async () => {
    answerStepUp("continue");
    await renderSettled();

    const answer = await act(() => auth.confirmPasswordResetCode("123456"));

    expect(answer).toEqual({ secondCodeSent: false });
    expect(session.canChangePassword).toHaveBeenCalledOnce();
    expect(session.logout).not.toHaveBeenCalled();
  });

  // The code is spent and the visitor signed in: left open, a session opened
  // by that code sits behind a screen saying the code was wrong.
  it("ends the session when the code bought no permission", async () => {
    answerStepUp("continue");
    session.canChangePassword.mockResolvedValue(false);
    await renderSettled();

    expect((await failure(() => auth.confirmPasswordResetCode("123456"))).message).toMatch(
      /did not receive permission/,
    );
    expect(session.logout).toHaveBeenCalledOnce();
    expect(screen.getByText("guest")).toBeInTheDocument();
  });

  it("keeps the real cause when the revocation fails as well", async () => {
    answerStepUp("block");
    session.logout.mockRejectedValue(new Error("network down"));
    await renderSettled();

    expect((await failure(() => auth.confirmPasswordResetCode("123456"))).message).toMatch(
      /refused the "prld:pwd:write" step-up/,
    );
    expect(session.logout).toHaveBeenCalledOnce();
    expect(screen.getByText("guest")).toBeInTheDocument();
  });

  // No session was opened, so there is nothing to end and the code can be retyped.
  it("leaves a wrong code to be retyped without signing anyone out", async () => {
    session.checkOTP.mockRejectedValue(new Error("BadCheckCodeError"));
    await renderSettled();

    expect((await failure(() => auth.confirmPasswordResetCode("000000"))).message).toBe(
      "BadCheckCodeError",
    );
    expect(session.logout).not.toHaveBeenCalled();
    expect(session.requestStepUp).not.toHaveBeenCalled();
  });
});

describe("AuthProvider password change", () => {
  // Proceeding would change a password on the strength of the session alone.
  it("refuses a password scope granted with no challenge", async () => {
    answerStepUp("continue");
    await renderSignedIn();

    expect((await failure(() => auth.startPasswordChange())).name).toBe(
      PASSWORD_CHANGE_UNAVAILABLE_ERROR,
    );
  });

  // Shared, each flow would reuse the other's challenge and check its code
  // against a scope it never asked about.
  it("keeps the verification and password challenges apart", async () => {
    server.use(http.post(`${API}/api/v1/auth/verify-email`, () => HttpResponse.json(makeUser())));
    await renderSignedIn();

    await act(() => auth.startEmailVerification());
    await act(() => auth.startPasswordChange());
    await act(() => auth.confirmPasswordWriteCode("222222"));
    await act(() => auth.verifyEmail("111111"));

    expect(stepUpScopes()).toEqual(["email:verify", "prld:pwd:write"]);
    expect(session.checkOTP.mock.calls.map(([input]) => input)).toEqual([
      { code: "222222", challengeId: "challenge-2" },
      { code: "111111", challengeId: "challenge-1" },
    ]);
  });

  // Here, nameably, rather than as a rejected password a step later.
  it("reports a code that bought no permission before the password is typed", async () => {
    session.canChangePassword.mockResolvedValue(false);
    await renderSignedIn();
    await act(() => auth.startPasswordChange());

    expect((await failure(() => auth.confirmPasswordWriteCode("123456"))).message).toMatch(
      /did not receive permission/,
    );
  });

  it("opens a challenge when a resend comes before any was opened", async () => {
    await renderSignedIn();

    await act(() => auth.resendPasswordWriteCode());

    expect(session.retryOTP).not.toHaveBeenCalled();
    expect(stepUpScopes()).toEqual(["prld:pwd:write"]);
  });

  it("hands the new password and the other sessions to Prelude", async () => {
    await renderSignedIn();

    await act(() => auth.changePassword("n3w-Password"));
    await act(() => auth.signOutOtherDevices());

    expect(session.changePassword).toHaveBeenCalledWith("n3w-Password");
    expect(session.revokeSessions).toHaveBeenCalledWith("others");
  });
});

// The two step-up flows a signed-in account runs keep their challenges the same
// way; only the calls, the scope and the idle message differ.
describe.each([
  {
    flow: "email verification",
    scope: "email:verify",
    start: () => auth.startEmailVerification(),
    confirm: (code: string) => auth.verifyEmail(code),
    resend: () => auth.resendVerificationCode(),
    idle: "No verification is in progress.",
  },
  {
    flow: "password change",
    scope: "prld:pwd:write",
    start: () => auth.startPasswordChange(),
    confirm: (code: string) => auth.confirmPasswordWriteCode(code),
    resend: () => auth.resendPasswordWriteCode(),
    idle: "No password change is in progress.",
  },
])("AuthProvider $flow challenge", ({ scope, start, confirm, resend, idle }) => {
  beforeEach(() => {
    server.use(http.post(`${API}/api/v1/auth/verify-email`, () => HttpResponse.json(makeUser())));
  });

  // A second challenge would retire the code already in the inbox.
  it("opens one challenge however often the screen asks", async () => {
    await renderSignedIn();

    await act(start);
    await act(start);

    expect(stepUpScopes()).toEqual([scope]);
    expect(session.startOTP).toHaveBeenCalledExactlyOnceWith({ challengeId: "challenge-1" });
  });

  it("refuses a code when none was asked for", async () => {
    await renderSignedIn();

    expect((await failure(() => confirm("123456"))).message).toBe(idle);
    expect(session.checkOTP).not.toHaveBeenCalled();
  });

  // A wrong code must leave the challenge open for the corrected one.
  it("lets a wrong code be retyped against the same challenge", async () => {
    await renderSignedIn();
    await act(start);
    session.checkOTP.mockRejectedValueOnce(new Error("BadCheckCodeError"));

    expect((await failure(() => confirm("000000"))).message).toBe("BadCheckCodeError");
    await act(() => confirm("123456"));

    expect(session.checkOTP).toHaveBeenLastCalledWith({
      code: "123456",
      challengeId: "challenge-1",
    });
  });

  // A challenge expires in ten minutes and retryOTP on a dead one fails for
  // good, so every later resend would fail identically with no way out.
  it("opens a fresh challenge when the old one cannot be retried", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderSignedIn();
    await act(start);
    session.retryOTP.mockRejectedValueOnce(new Error("expired"));

    await act(resend);
    await act(() => confirm("123456"));

    expect(stepUpScopes()).toEqual([scope, scope]);
    expect(session.startOTP).toHaveBeenLastCalledWith({ challengeId: "challenge-2" });
    expect(session.checkOTP).toHaveBeenLastCalledWith({
      code: "123456",
      challengeId: "challenge-2",
    });
    expect(logged).toHaveBeenCalled();
  });
});

describe("AuthProvider password rules", () => {
  it("describes each rule a password breaks and none it keeps", async () => {
    session.validatePassword.mockResolvedValue({
      valid: false,
      results: [
        { criteria: "min_length", expected: 12, valid: false },
        { criteria: "max_length", expected: 64, valid: true },
        { criteria: "max_length", expected: 64, valid: false },
        { criteria: "min_uppercase", expected: 1, valid: false },
        { criteria: "min_lowercase", expected: 2, valid: false },
        { criteria: "min_digits", expected: 1, valid: false },
        { criteria: "min_symbols", expected: 3, valid: false },
        { criteria: "no_common_words", expected: 0, valid: false },
      ],
    });
    await renderSettled();

    expect(await auth.validatePassword("short")).toEqual({
      valid: false,
      messages: [
        "Use at least 12 characters.",
        "Use at most 64 characters.",
        "Include at least 1 uppercase letter.",
        "Include at least 2 lowercase letters.",
        "Include at least 1 number.",
        "Include at least 3 symbols.",
        "Does not meet the no common words requirement.",
      ],
    });
  });

  // Rules unavailable: the server judges, rather than the form refusing everything.
  it("lets the server judge when the rules cannot be read", async () => {
    session.validatePassword.mockRejectedValue(new Error("network down"));
    await renderSettled();

    expect(await auth.validatePassword("anything")).toEqual({ valid: true, messages: [] });
  });

  it("treats an empty answer as no rules to break", async () => {
    await renderSettled();

    expect(await auth.validatePassword("anything")).toEqual({ valid: true, messages: [] });
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
