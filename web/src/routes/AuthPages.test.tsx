import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ForgotPasswordPage, LoginPage, VerifyEmailPage } from "./AuthPages";
import { App } from "@/App";
import { ApiError } from "@/api/client";
import { RESET_UNCONFIGURED_ERROR, type AuthContextValue } from "@/auth/context";
import { makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";

/** An account that has signed in but not yet confirmed its address. */
const unverified = makeUser({ email: "new@example.com", email_verified_at: null });

function renderVerifyPage(auth: Partial<AuthContextValue> = {}) {
  return renderWithProviders(<VerifyEmailPage />, {
    user: unverified,
    route: "/verify-email",
    auth,
  });
}

describe("VerifyEmailPage", () => {
  // The challenge belongs to the browser's session with Prelude, so nothing is
  // sent until this screen opens — a user who lands here must not sit waiting
  // for a code that was never requested.
  it("asks Prelude for a code when it opens", async () => {
    const startEmailVerification = vi.fn().mockResolvedValue(undefined);
    renderVerifyPage({ startEmailVerification });

    await waitFor(() => expect(startEmailVerification).toHaveBeenCalledTimes(1));
  });

  it("submits the code the user was emailed", async () => {
    const verifyEmail = vi.fn().mockResolvedValue(undefined);
    renderVerifyPage({ verifyEmail });

    await userEvent.type(screen.getByLabelText("Verification code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify email" }));

    await waitFor(() => expect(verifyEmail).toHaveBeenCalledWith("123456"));
  });

  // The address is the whole point of the screen, and a user who mistyped it
  // needs to see which one the code went to before they sit waiting for it.
  it("names the address the code was sent to", async () => {
    renderVerifyPage();
    expect(await screen.findByText(/new@example\.com/)).toBeInTheDocument();
  });

  it("will not submit a partial code", async () => {
    const verifyEmail = vi.fn();
    renderVerifyPage({ verifyEmail });

    await userEvent.type(screen.getByLabelText("Verification code"), "123");

    expect(screen.getByRole("button", { name: "Verify email" })).toBeDisabled();
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  // Codes arrive in text that has more than digits in it — "Your code is
  // 123456" — and pasting the lot must not leave an unsubmittable field.
  it("keeps only the digits of what is typed", async () => {
    renderVerifyPage();

    const field = screen.getByLabelText("Verification code");
    await userEvent.type(field, "12-34 56");

    expect(field).toHaveValue("123456");
  });

  // Prelude checks the code, so a wrong one comes back as its typed SDK error
  // rather than as a response from our API. Left unnamed it would surface as a
  // generic failure, which reads as "something is broken" for what is almost
  // always a mistyped digit.
  it("names a wrong code as a wrong code", async () => {
    const badCode = new Error("Bad check code");
    badCode.name = "BadCheckCodeError";
    const verifyEmail = vi.fn().mockRejectedValue(badCode);
    renderVerifyPage({ verifyEmail });

    await userEvent.type(screen.getByLabelText("Verification code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify email" }));

    expect(
      await screen.findByText("That code is not correct. Check it and try again."),
    ).toBeInTheDocument();
  });

  it("reports a failure our API returned", async () => {
    const verifyEmail = vi
      .fn()
      .mockRejectedValue(new ApiError(403, "forbidden", "Confirm your email address."));
    renderVerifyPage({ verifyEmail });

    await userEvent.type(screen.getByLabelText("Verification code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify email" }));

    expect(await screen.findByText("Confirm your email address.")).toBeInTheDocument();
  });

  // A challenge that could not be opened leaves the user staring at a form for
  // a code that is not coming.
  it("surfaces a challenge that could not be opened", async () => {
    const startEmailVerification = vi.fn().mockRejectedValue(new Error("stepup unavailable"));
    renderVerifyPage({ startEmailVerification });

    expect(
      await screen.findByText("We could not send a code just now. Try asking for another."),
    ).toBeInTheDocument();
  });

  // The first attempt can fail before a challenge exists, and the error tells
  // the user to ask for another — so that button has to be able to open one.
  it("can still ask for a code after the first attempt failed", async () => {
    const startEmailVerification = vi
      .fn()
      .mockRejectedValueOnce(new Error("stepup unavailable"))
      .mockResolvedValue(undefined);
    const resendVerificationCode = vi.fn(() => startEmailVerification());
    renderVerifyPage({ startEmailVerification, resendVerificationCode });

    await screen.findByText("We could not send a code just now. Try asking for another.");
    await userEvent.click(screen.getByRole("button", { name: "Send another" }));

    await waitFor(() => expect(startEmailVerification).toHaveBeenCalledTimes(2));
  });

  it("can ask for another code, then rests", async () => {
    const resendVerificationCode = vi.fn().mockResolvedValue(undefined);
    renderVerifyPage({ resendVerificationCode });

    await userEvent.click(screen.getByRole("button", { name: "Send another" }));

    await waitFor(() => expect(resendVerificationCode).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent(/most recent email/);
    // And it rests, so the button a stuck user clicks repeatedly cannot fill
    // their inbox — or spend a message per click.
    expect(screen.getByRole("button", { name: /Send another in \d+s/ })).toBeDisabled();
  });

  // The one failure that is neither the user's fault nor recoverable by
  // retrying: Prelude would not send the mail. Silence here reads as "the code
  // is coming", and it never is.
  it("surfaces a code that could not be sent", async () => {
    const resendVerificationCode = vi
      .fn()
      .mockRejectedValue(
        new ApiError(502, "upstream_error", "Verification emails cannot be sent right now."),
      );
    renderVerifyPage({ resendVerificationCode });

    await userEvent.click(screen.getByRole("button", { name: "Send another" }));

    expect(
      await screen.findByText("Verification emails cannot be sent right now."),
    ).toBeInTheDocument();
  });

  // The redirect is rendered after the effects have run, so a verified visitor
  // passing through must not have opened a challenge — and been emailed a code
  // for an address that needed nothing.
  it("sends a verified account on its way without asking for a code", async () => {
    const startEmailVerification = vi.fn();
    renderWithProviders(<VerifyEmailPage />, {
      user: makeUser(),
      route: "/verify-email",
      auth: { startEmailVerification },
    });

    await waitFor(() => expect(startEmailVerification).not.toHaveBeenCalled());
    expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();
  });
});

describe("ForgotPasswordPage", () => {
  /** Walks the flow as far as the given step, so each test starts where it tests. */
  async function reachPasswordStep(auth: Partial<AuthContextValue> = {}) {
    const view = renderWithProviders(<ForgotPasswordPage />, {
      route: "/forgot-password",
      auth,
    });

    await userEvent.type(screen.getByLabelText("Email"), "forgetful@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));

    await userEvent.type(await screen.findByLabelText("Reset code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByLabelText("New password");
    return view;
  }

  it("emails a code to the address given", async () => {
    const startPasswordReset = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ForgotPasswordPage />, {
      route: "/forgot-password",
      auth: { startPasswordReset },
    });

    await userEvent.type(screen.getByLabelText("Email"), "  forgetful@example.com  ");
    await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));

    await waitFor(() =>
      expect(startPasswordReset).toHaveBeenCalledWith("forgetful@example.com"),
    );
    expect(await screen.findByLabelText("Reset code")).toBeInTheDocument();
  });

  it("submits the emailed code, then asks for a new password", async () => {
    const confirmPasswordResetCode = vi.fn().mockResolvedValue(undefined);
    await reachPasswordStep({ confirmPasswordResetCode });

    expect(confirmPasswordResetCode).toHaveBeenCalledWith("123456");
  });

  it("will not submit a partial code", async () => {
    const confirmPasswordResetCode = vi.fn();
    renderWithProviders(<ForgotPasswordPage />, {
      route: "/forgot-password",
      auth: { confirmPasswordResetCode },
    });

    await userEvent.type(screen.getByLabelText("Email"), "forgetful@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    await userEvent.type(await screen.findByLabelText("Reset code"), "123");

    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(confirmPasswordResetCode).not.toHaveBeenCalled();
  });

  // An address with no account is given a code form and no code, so its attempt
  // fails at this step — which is why every failure here has to say the same
  // thing. A message that distinguished a wrong code from anything else would
  // answer whether the address is registered, after the step before it took care
  // not to. Both cases are checked against one string on purpose: that is the
  // property, and matching Prelude's error names instead would leak the moment
  // one of them differed for an unknown account.
  const SAME_CODE_FAILURE =
    "That code is not correct, or it has expired. Ask for another and try again.";

  it.each([
    ["a mistyped digit", (() => {
      const badCode = new Error("Bad check code");
      badCode.name = "BadCheckCodeError";
      return badCode;
    })()],
    ["an address with no account", new ApiError(404, "not_found", "No such user.")],
    ["a step-up that stopped granting outright", new Error('Prelude answered with "review".')],
  ])("reports %s the same way", async (_case, failure) => {
    const confirmPasswordResetCode = vi.fn().mockRejectedValue(failure);
    // The page logs the real cause for whoever has to find it; the assertion is
    // that the *visitor* cannot tell these three apart. Restored from a finally
    // rather than the last line: nothing here restores mocks between tests, so a
    // failing assertion would otherwise silence console.error for every test
    // after this one — which is exactly what several of them assert about.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      renderWithProviders(<ForgotPasswordPage />, {
        route: "/forgot-password",
        auth: { confirmPasswordResetCode },
      });

      await userEvent.type(screen.getByLabelText("Email"), "nobody@example.com");
      await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));
      await userEvent.type(await screen.findByLabelText("Reset code"), "000000");
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      expect(await screen.findByText(SAME_CODE_FAILURE)).toBeInTheDocument();
      expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it("saves the new password", async () => {
    const changePassword = vi.fn().mockResolvedValue(undefined);
    await reachPasswordStep({ changePassword });

    await userEvent.type(screen.getByLabelText("New password"), "a-better-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith("a-better-secret"));
    expect(await screen.findByText("Password changed")).toBeInTheDocument();
  });

  // changePassword goes browser→Prelude, so a rejection is one of the SDK's
  // typed errors and never an ApiError — errorMessage would render its fallback
  // for every one of them, which is why these two are matched by name. Asserting
  // against an ApiError here would pass while the real path said nothing.
  it("keeps a rejected password on the password form and says why", async () => {
    const invalid = new Error("Password does not meet compliancy requirements.");
    invalid.name = "InvalidPasswordError";
    const changePassword = vi.fn().mockRejectedValue(invalid);
    const validatePassword = vi
      .fn()
      .mockResolvedValue({ valid: false, messages: ["Use at least 8 characters."] });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await reachPasswordStep({ changePassword, validatePassword });

      await userEvent.type(screen.getByLabelText("New password"), "short");
      await userEvent.click(screen.getByRole("button", { name: "Save new password" }));

      expect(
        await screen.findByText("That password does not meet the requirements."),
      ).toBeInTheDocument();
      // The reasons come from the compliancy check rather than being paraphrased.
      expect(await screen.findByText("• Use at least 8 characters.")).toBeInTheDocument();
      expect(screen.getByLabelText("New password")).toBeInTheDocument();
    } finally {
      logged.mockRestore();
    }
  });

  // The step-up that permits the write is granted for five minutes, so a slow
  // choice of password is refused with nothing wrong with the password. Told to
  // try another, the visitor is sent round a loop that no password escapes — so
  // this one failure has to be named, and there has to be a way out of the step.
  it("names an expired reset rather than blaming the password", async () => {
    const expired = new Error("Forbidden");
    expired.name = "ForbiddenError";
    const changePassword = vi.fn().mockRejectedValue(expired);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await reachPasswordStep({ changePassword });

      await userEvent.type(screen.getByLabelText("New password"), "a-better-secret");
      await userEvent.click(screen.getByRole("button", { name: "Save new password" }));

      expect(
        await screen.findByText("This reset has expired. Ask for a new code and start again."),
      ).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Start again with a new code" }));
      expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    } finally {
      logged.mockRestore();
    }
  });

  // The reset ends by asking, rather than deciding for them, what should happen
  // to sessions opened before the password changed.
  it("signs out other devices when asked to", async () => {
    const signOutOtherDevices = vi.fn().mockResolvedValue(undefined);
    await reachPasswordStep({ signOutOtherDevices });

    await userEvent.type(screen.getByLabelText("New password"), "a-better-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out my other devices" }),
    );

    await waitFor(() => expect(signOutOtherDevices).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent(/other devices have been signed out/i);
  });

  // The password is already saved by the time this button exists, so a failure
  // here must not read as a reset that did not happen.
  it("does not report a failed sign-out as a failed reset", async () => {
    const signOutOtherDevices = vi.fn().mockRejectedValue(new Error("revoke failed"));
    await reachPasswordStep({ signOutOtherDevices });

    await userEvent.type(screen.getByLabelText("New password"), "a-better-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out my other devices" }),
    );

    expect(
      await screen.findByText(
        "Your password was changed, but other devices could not be signed out.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Password changed")).toBeInTheDocument();
  });

  it("can ask for another code, then rests", async () => {
    const resendPasswordResetCode = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ForgotPasswordPage />, {
      route: "/forgot-password",
      auth: { resendPasswordResetCode },
    });

    await userEvent.type(screen.getByLabelText("Email"), "forgetful@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    await userEvent.click(await screen.findByRole("button", { name: "Send another" }));

    await waitFor(() => expect(resendPasswordResetCode).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Send another in \d+s/ })).toBeDisabled();
  });

  // Only an address with an account has a dispatch to retry, so this button is
  // the second place the flow could answer which addresses are registered — and
  // every observable has to match, not just the message: an error, a cooldown
  // that never started or a code field left filled would each be an oracle on
  // its own. Checked against the successful case above, deliberately.
  it("reports a failed resend exactly like a sent one", async () => {
    const resendPasswordResetCode = vi.fn().mockRejectedValue(new Error("no such verification"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      renderWithProviders(<ForgotPasswordPage />, {
        route: "/forgot-password",
        auth: { resendPasswordResetCode },
      });

      await userEvent.type(screen.getByLabelText("Email"), "nobody@example.com");
      await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));
      await userEvent.type(await screen.findByLabelText("Reset code"), "123456");
      await userEvent.click(screen.getByRole("button", { name: "Send another" }));

      expect(await screen.findByRole("status")).toHaveTextContent(/a new code is on its way/i);
      expect(screen.getByRole("button", { name: /Send another in \d+s/ })).toBeDisabled();
      expect(screen.getByLabelText("Reset code")).toHaveValue("");
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  // The one failure an operator can fix, and the only one that would otherwise
  // read as Prelude being down: a build that shipped without the login
  // configuration to send a code through.
  it("names an unconfigured deployment", async () => {
    const unconfigured = new Error("VITE_PRELUDE_OTP_LOGIN_CONFIG_ID is empty.");
    unconfigured.name = RESET_UNCONFIGURED_ERROR;
    const startPasswordReset = vi.fn().mockRejectedValue(unconfigured);

    renderWithProviders(<ForgotPasswordPage />, {
      route: "/forgot-password",
      auth: { startPasswordReset },
    });

    await userEvent.type(screen.getByLabelText("Email"), "forgetful@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));

    expect(
      await screen.findByText("Password reset is not configured for this deployment."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Reset code")).not.toBeInTheDocument();
  });

  it("offers the way in from the sign-in screen", () => {
    renderWithProviders(<LoginPage />, { route: "/login" });

    expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });
});

describe("verification gate", () => {
  // Every page an unverified account can reach answers 403, so without the gate
  // the app renders a catalog of empty shelves and blames the network.
  it("holds an unverified account on the verification screen", async () => {
    renderWithProviders(<App />, { user: unverified, route: "/lists" });

    expect(await screen.findByText("Check your email")).toBeInTheDocument();
  });

  it("lets a verified account through", async () => {
    renderWithProviders(<App />, { user: makeUser(), route: "/" });

    expect(await screen.findByRole("searchbox")).toBeInTheDocument();
  });

  // Password reset signs the visitor in on its way to the password form, so the
  // gate sees an unverified account sitting on a page that is not the
  // verification screen. Bounced from there, the reset ends one step short of
  // the new password — on a code form for a different challenge, which reads as
  // the reset code having silently stopped working.
  it("leaves an unverified account on the reset screen", async () => {
    renderWithProviders(<App />, { user: unverified, route: "/forgot-password" });

    expect(await screen.findByText("Reset your password")).toBeInTheDocument();
  });

  // The same flow seen from the other side: this page is reached by a signed-out
  // visitor and finished by a signed-in one, so it must not send a signed-in
  // visitor home the way the sign-in and sign-up screens do.
  it("does not send a signed-in visitor away from the reset screen", async () => {
    renderWithProviders(<App />, { user: makeUser(), route: "/forgot-password" });

    expect(await screen.findByText("Reset your password")).toBeInTheDocument();
  });
});
