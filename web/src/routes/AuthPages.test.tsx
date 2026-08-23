import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ChangePasswordPage,
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  VerifyEmailPage,
} from "./AuthPages";
import { App } from "@/App";
import { ApiError } from "@/api/client";
import {
  PASSWORD_CHANGE_UNAVAILABLE_ERROR,
  RESET_UNCONFIGURED_ERROR,
  namedError,
  type AuthContextValue,
} from "@/auth/context";
import { makeUser } from "@/test/handlers";
import { ProfilePage } from "./ProfilePage";
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
    const verifyEmail = vi
      .fn()
      .mockRejectedValue(namedError("BadCheckCodeError", "Bad check code"));
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

  // The account here may be the one this browser saw last rather than the one
  // signed in now — it is seeded from storage, so the app paints its chrome
  // without waiting. Nothing may be asked of Prelude on that guess: the session
  // it names has not been restored yet, and a step-up opened on it fails as a
  // code that could not be sent.
  it("asks for nothing until the session is confirmed", async () => {
    const startEmailVerification = vi.fn();
    renderVerifyPage({ startEmailVerification, loading: true });

    await waitFor(() => expect(startEmailVerification).not.toHaveBeenCalled());
    expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();
  });
});

describe("ForgotPasswordPage", () => {
  /**
   * The step-up as configured: it emails a second code before granting the
   * scope, so a spec that says nothing about it walks the flow real visitors
   * walk. Kept here rather than in `renderWithProviders`, because which
   * configuration is deployed is this flow's business and not every spec's.
   */
  const twoCodes: Partial<AuthContextValue> = {
    confirmPasswordResetCode: async () => ({ secondCodeSent: true }),
  };

  function renderResetPage(auth: Partial<AuthContextValue> = {}) {
    return renderWithProviders(<ForgotPasswordPage />, {
      route: "/forgot-password",
      auth: { ...twoCodes, ...auth },
    });
  }

  /** Renders and asks for a code, which is where the first code form appears. */
  async function reachCodeStep(auth: Partial<AuthContextValue> = {}) {
    const view = renderResetPage(auth);

    await userEvent.type(screen.getByLabelText("Email"), "forgetful@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));

    await screen.findByLabelText("Reset code");
    return view;
  }

  /** One rung further: the code that signs the visitor in has been accepted. */
  async function reachConfirmStep(auth: Partial<AuthContextValue> = {}) {
    const view = await reachCodeStep(auth);

    await userEvent.type(screen.getByLabelText("Reset code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByLabelText("Confirmation code");
    return view;
  }

  /**
   * The last rung, where the new password is asked for — so each spec starts
   * where it tests instead of retyping the walk that got there.
   */
  async function reachPasswordStep(auth: Partial<AuthContextValue> = {}) {
    const view = await reachConfirmStep(auth);

    await userEvent.type(screen.getByLabelText("Confirmation code"), "654321");
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

  it("submits the emailed code, then the one that permits the write", async () => {
    const confirmPasswordResetCode = vi.fn().mockResolvedValue({ secondCodeSent: true });
    const confirmPasswordWriteCode = vi.fn().mockResolvedValue(undefined);
    await reachPasswordStep({ confirmPasswordResetCode, confirmPasswordWriteCode });

    expect(confirmPasswordResetCode).toHaveBeenCalledWith("123456");
    expect(confirmPasswordWriteCode).toHaveBeenCalledWith("654321");
  });

  // Which of the two routes a visitor takes is Prelude's answer rather than this
  // screen's choice, so both have to work: the configuration can be flipped
  // either way — and would be, to spare the reset its second code — with no
  // deploy behind it. Pinned from both sides, because a screen that only ever
  // showed the second form would pass every other spec in this file.
  it("goes straight to the new password when the step-up grants outright", async () => {
    const confirmPasswordResetCode = vi.fn().mockResolvedValue({ secondCodeSent: false });
    await reachCodeStep({ confirmPasswordResetCode });

    await userEvent.type(screen.getByLabelText("Reset code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByLabelText("New password")).toBeInTheDocument();
    expect(screen.queryByLabelText("Confirmation code")).not.toBeInTheDocument();
  });

  // The second code answers the same challenge the signed-in change-password
  // screen answers, and a wrong one can be named here: only an address with an
  // account reaches this form, which is the thing the step before it must not
  // give away.
  it("names a wrong confirmation code", async () => {
    const confirmPasswordWriteCode = vi
      .fn()
      .mockRejectedValue(namedError("BadCheckCodeError", "Bad check code"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await reachConfirmStep({ confirmPasswordWriteCode });

      await userEvent.type(screen.getByLabelText("Confirmation code"), "000000");
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      expect(
        await screen.findByText("That code is not correct. Check it and try again."),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    } finally {
      logged.mockRestore();
    }
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
    ["a mistyped digit", namedError("BadCheckCodeError", "Bad check code")],
    ["an address with no account", new ApiError(404, "not_found", "No such user.")],
    ["a step-up Prelude refused", new Error('Prelude refused the "prld:pwd:write" step-up.')],
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
    const changePassword = vi
      .fn()
      .mockRejectedValue(
        namedError("InvalidPasswordError", "Password does not meet compliancy requirements."),
      );
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
    const changePassword = vi.fn().mockRejectedValue(namedError("ForbiddenError", "Forbidden"));
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
    const startPasswordReset = vi
      .fn()
      .mockRejectedValue(
        namedError(RESET_UNCONFIGURED_ERROR, "NEXT_PUBLIC_PRELUDE_OTP_LOGIN_CONFIG_ID is empty."),
      );

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

describe("ChangePasswordPage", () => {
  /** The signed-in account whose password is being changed. */
  const signedIn = makeUser({ email: "singer@example.com" });

  function renderChangePage(auth: Partial<AuthContextValue> = {}) {
    return renderWithProviders(<ChangePasswordPage />, {
      user: signedIn,
      route: "/change-password",
      auth,
    });
  }

  /** Walks to the password step, past the code that permits the write. */
  async function reachPasswordStep(auth: Partial<AuthContextValue> = {}) {
    const view = renderChangePage(auth);

    await userEvent.type(await screen.findByLabelText("Confirmation code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByLabelText("New password");
    return view;
  }

  // The challenge belongs to the browser's session with Prelude, so nothing is
  // emailed until this screen opens — a visitor who lands here must not sit
  // waiting for a code nobody asked for.
  it("asks Prelude for a code when it opens", async () => {
    const startPasswordChange = vi.fn().mockResolvedValue(undefined);
    renderChangePage({ startPasswordChange });

    await waitFor(() => expect(startPasswordChange).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/singer@example\.com/)).toBeInTheDocument();
  });

  it("submits the code, then asks for a new password", async () => {
    const confirmPasswordWriteCode = vi.fn().mockResolvedValue(undefined);
    await reachPasswordStep({ confirmPasswordWriteCode });

    expect(confirmPasswordWriteCode).toHaveBeenCalledWith("123456");
  });

  it("will not submit a partial code", async () => {
    const confirmPasswordWriteCode = vi.fn();
    renderChangePage({ confirmPasswordWriteCode });

    await userEvent.type(await screen.findByLabelText("Confirmation code"), "123");

    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(confirmPasswordWriteCode).not.toHaveBeenCalled();
  });

  it("names a wrong code as a wrong code", async () => {
    const confirmPasswordWriteCode = vi
      .fn()
      .mockRejectedValue(namedError("BadCheckCodeError", "Bad check code"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      renderChangePage({ confirmPasswordWriteCode });

      await userEvent.type(await screen.findByLabelText("Confirmation code"), "000000");
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      expect(
        await screen.findByText("That code is not correct. Check it and try again."),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
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

  // The whole point of the screen. A step-up that grants the scope outright asks
  // for nothing, so nothing distinguishes the account's owner from a stolen
  // session — and a code form would then wait for a code that is never sent.
  // What it offers instead is the reset, which proves the same mailbox.
  it("refuses to change a password when Prelude asks for nothing", async () => {
    const startPasswordChange = vi
      .fn()
      .mockRejectedValue(
        namedError(PASSWORD_CHANGE_UNAVAILABLE_ERROR, "granted with no challenge"),
      );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      renderChangePage({ startPasswordChange });

      expect(
        await screen.findByText(
          "This deployment is not set up to confirm a password change by email.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Confirmation code")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Reset my password instead" })).toHaveAttribute(
        "href",
        "/forgot-password",
      );
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  // A challenge that could not be opened leaves the visitor at a form for a code
  // that is not coming, so the failure has to be said out loud — and told to ask
  // for another, that button has to be able to open one.
  it("surfaces a challenge that could not be opened", async () => {
    const startPasswordChange = vi
      .fn()
      .mockRejectedValueOnce(new Error("stepup unavailable"))
      .mockResolvedValue(undefined);
    const resendPasswordWriteCode = vi.fn(() => startPasswordChange());
    renderChangePage({ startPasswordChange, resendPasswordWriteCode });

    expect(
      await screen.findByText("We could not send a code just now. Try asking for another."),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Send another" }));
    await waitFor(() => expect(startPasswordChange).toHaveBeenCalledTimes(2));
  });

  // Nothing has a challenge to retry until the first send comes back, so a click
  // here would open a *second* step-up — retiring the challenge the first one is
  // about to report, emailing two codes and leaving neither able to work. The
  // cooldown cannot cover this: it has not started yet.
  it("holds the resend while the first code is still in flight", async () => {
    const resendPasswordWriteCode = vi.fn();
    renderChangePage({
      startPasswordChange: () => new Promise(() => {}),
      resendPasswordWriteCode,
    });

    expect(await screen.findByRole("button", { name: "Send another" })).toBeDisabled();
    expect(resendPasswordWriteCode).not.toHaveBeenCalled();
  });

  it("can ask for another code, then rests", async () => {
    const resendPasswordWriteCode = vi.fn().mockResolvedValue(undefined);
    renderChangePage({ resendPasswordWriteCode });

    await userEvent.click(await screen.findByRole("button", { name: "Send another" }));

    await waitFor(() => expect(resendPasswordWriteCode).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent(/most recent email/);
    expect(screen.getByRole("button", { name: /Send another in \d+s/ })).toBeDisabled();
  });

  // The permission the code buys lasts five minutes, so a slow choice of
  // password is refused with nothing whatsoever wrong with the password. Told to
  // try another, the visitor is sent round a loop no password escapes — and the
  // way out cannot be the back button, the steps being state rather than routes.
  // The spent challenge is why it asks for a new code rather than just stepping
  // back to a form.
  it("names an expired confirmation and asks for a new code", async () => {
    const changePassword = vi.fn().mockRejectedValue(namedError("ForbiddenError", "Forbidden"));
    const resendPasswordWriteCode = vi.fn().mockResolvedValue(undefined);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await reachPasswordStep({ changePassword, resendPasswordWriteCode });

      await userEvent.type(screen.getByLabelText("New password"), "a-better-secret");
      await userEvent.click(screen.getByRole("button", { name: "Save new password" }));

      expect(
        await screen.findByText("That confirmation has expired. Ask for a new code and try again."),
      ).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Start again with a new code" }));

      expect(await screen.findByLabelText("Confirmation code")).toBeInTheDocument();
      await waitFor(() => expect(resendPasswordWriteCode).toHaveBeenCalled());
    } finally {
      logged.mockRestore();
    }
  });

  it("keeps a rejected password on the password form and says why", async () => {
    const changePassword = vi
      .fn()
      .mockRejectedValue(
        namedError("InvalidPasswordError", "Password does not meet compliancy requirements."),
      );
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
      expect(await screen.findByText("• Use at least 8 characters.")).toBeInTheDocument();
      expect(screen.getByLabelText("New password")).toBeInTheDocument();
    } finally {
      logged.mockRestore();
    }
  });

  // The compliancy check is asked once per password and its answer remembered,
  // because clicking submit blurs the field and a refused password would be
  // asked about twice in a second. Remembering the password without its reasons
  // is the trap: the hints are cleared as soon as another password is judged, so
  // coming back to a refused one — a paste, an undo — would skip the check and
  // leave a password refused with nothing saying why.
  it("still says why after another password was judged in between", async () => {
    const validatePassword = vi.fn(async (password: string) =>
      password === "short"
        ? { valid: false, messages: ["Use at least 8 characters."] }
        : { valid: true, messages: [] },
    );
    await reachPasswordStep({ validatePassword });

    const field = screen.getByLabelText("New password");
    await userEvent.type(field, "short");
    await userEvent.tab();
    expect(await screen.findByText("• Use at least 8 characters.")).toBeInTheDocument();

    await userEvent.clear(field);
    await userEvent.type(field, "long-enough-secret");
    await userEvent.tab();
    await waitFor(() =>
      expect(screen.queryByText("• Use at least 8 characters.")).not.toBeInTheDocument(),
    );

    await userEvent.clear(field);
    await userEvent.type(field, "short");
    await userEvent.tab();

    expect(await screen.findByText("• Use at least 8 characters.")).toBeInTheDocument();
  });

  // A password change is exactly when somebody wants the sessions they no longer
  // recognize ended, and a failure here must not read as a password that did not
  // save — it did.
  it("signs out other devices when asked to", async () => {
    const signOutOtherDevices = vi.fn().mockResolvedValue(undefined);
    await reachPasswordStep({ signOutOtherDevices });

    await userEvent.type(screen.getByLabelText("New password"), "a-better-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out my other devices" }),
    );

    await waitFor(() => expect(signOutOtherDevices).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent(
      /other devices have been signed out/i,
    );
  });

  // The redirect below the effect is rendered after it has run, so a visitor
  // whose session ended must not have opened a challenge on their way out — and
  // been emailed a code for a flow they cannot be in.
  it("opens no challenge without a session", async () => {
    const startPasswordChange = vi.fn();
    renderWithProviders(<ChangePasswordPage />, {
      user: null,
      route: "/change-password",
      auth: { startPasswordChange },
    });

    await waitFor(() => expect(startPasswordChange).not.toHaveBeenCalled());
    expect(screen.queryByLabelText("Confirmation code")).not.toBeInTheDocument();
  });

  it("offers the way in from the profile", async () => {
    renderWithProviders(<ProfilePage />, { user: signedIn, route: "/profile" });

    expect(await screen.findByRole("link", { name: "Change password" })).toHaveAttribute(
      "href",
      "/change-password",
    );
  });

  // A guest reaching the route is sent to sign in rather than shown a flow that
  // cannot start — the guard is the route's, not the page's.
  it("sends a guest to sign in", async () => {
    renderWithProviders(<App />, { user: null, route: "/change-password" });

    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
  });
});

describe("sign-in and sign-up screens", () => {
  // The user these screens read may be last time's — the app seeds it from
  // storage so a refresh does not flash the guest chrome. Acting on that guess
  // here is what they cannot do: a session that has since expired would send a
  // visitor who came to sign in to the catalog, and leave them there as a guest.
  it("keeps the sign-in form up until the session is confirmed", () => {
    renderWithProviders(<LoginPage />, {
      user: makeUser(),
      route: "/login",
      auth: { loading: true },
    });

    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("sends a signed-in visitor on their way", () => {
    renderWithProviders(<App />, { user: makeUser(), route: "/login" });

    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  // The sign-up screen makes the same decision from the same guess, and being
  // wrong on it costs the same thing: somebody who came to make an account put
  // on the catalog instead.
  it("keeps the sign-up form up until the session is confirmed", () => {
    renderWithProviders(<RegisterPage />, {
      user: makeUser(),
      route: "/register",
      auth: { loading: true },
    });

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  // Pinned from both sides, like the sign-in screen above it: with only the
  // waiting half, a redirect that stopped firing altogether — the `user` half of
  // the condition lost in an edit — leaves a signed-in visitor on a form that
  // creates the account they already have, and every spec still passes.
  it("sends a signed-in visitor away from the sign-up form", () => {
    renderWithProviders(<App />, { user: makeUser(), route: "/register" });

    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  // And the third side, which is the one an edit to that condition actually
  // reaches: losing the `user` half sends *everybody* away once the restore
  // settles, so the screen has no visitor left who can sign up. The sign-in
  // screen has this pinned already, by every spec that renders it as a guest.
  it("shows the sign-up form to a guest", () => {
    renderWithProviders(<App />, { user: null, route: "/register" });

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
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

  // The gate reads a user that may be the last session this browser saw rather
  // than this one — seeded from storage so the chrome does not flash the guest
  // answer on every refresh. A snapshot taken before an address was verified
  // elsewhere would otherwise put a verified visitor on a code form, and then on
  // the catalog rather than the page they opened.
  it("holds nobody until the session is confirmed", async () => {
    renderWithProviders(<App />, { user: unverified, route: "/", auth: { loading: true } });

    expect(await screen.findByRole("searchbox")).toBeInTheDocument();
  });
});
