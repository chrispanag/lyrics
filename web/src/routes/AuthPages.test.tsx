import { act, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/** Prelude refusing to send any email, as our API reports it. */
const emailsUnavailable = new ApiError(
  502,
  "upstream_error",
  "Verification emails cannot be sent right now.",
);

function renderVerifyPage(auth: Partial<AuthContextValue> = {}) {
  return renderWithProviders(<VerifyEmailPage />, {
    user: unverified,
    route: "/verify-email",
    auth,
  });
}

describe("VerifyEmailPage", () => {
  // The code is requested when this screen opens.
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

  // Shows the address, so a typo is visible.
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

  // A pasted "Your code is 123456" is reduced to digits.
  it("keeps only the digits of what is typed", async () => {
    renderVerifyPage();

    const field = screen.getByLabelText("Verification code");
    await userEvent.type(field, "12-34 56");

    expect(field).toHaveValue("123456");
  });

  // A wrong code is Prelude's typed SDK error, and is named as such.
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

  // A challenge that could not be opened must say so.
  it("surfaces a challenge that could not be opened", async () => {
    const startEmailVerification = vi.fn().mockRejectedValue(new Error("stepup unavailable"));
    renderVerifyPage({ startEmailVerification });

    expect(
      await screen.findByText("We could not send a code just now. Try asking for another."),
    ).toBeInTheDocument();
  });

  // After a failed first attempt, resend must be able to open a challenge.
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
    // And it rests, so repeated clicks cannot fill the inbox.
    expect(screen.getByRole("button", { name: /Send another in \d+s/ })).toBeDisabled();
  });

  // Prelude refusing to send must be said, not left as a wait.
  it("surfaces a code that could not be sent", async () => {
    const resendVerificationCode = vi.fn().mockRejectedValue(emailsUnavailable);
    renderVerifyPage({ resendVerificationCode });

    await userEvent.click(screen.getByRole("button", { name: "Send another" }));

    expect(
      await screen.findByText("Verification emails cannot be sent right now."),
    ).toBeInTheDocument();
  });

  // A refusal our API pinned on the code goes beneath the field it is about.
  it("puts the server's reason for a code under the field", async () => {
    const verifyEmail = vi.fn().mockRejectedValue(
      new ApiError(422, "validation_error", "Check the highlighted fields.", {
        code: "The code must be six digits.",
      }),
    );
    renderVerifyPage({ verifyEmail });

    await userEvent.type(screen.getByLabelText("Verification code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify email" }));

    expect(await screen.findByText("Check the highlighted fields.")).toBeInTheDocument();
    expect(screen.getByLabelText("Verification code")).toHaveAccessibleDescription(
      "The code must be six digits.",
    );
  });

  // Sign-out is the only exit for an address typed wrong at sign-up.
  it("lets a mistyped address sign out", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    renderVerifyPage({ logout });

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(logout).toHaveBeenCalled();
  });

  // The session can end with the screen open; there is nothing here to verify.
  it("sends a signed-out visitor to sign in", () => {
    renderWithProviders(
      <Routes>
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/login" element={<p>Sign-in screen</p>} />
      </Routes>,
      { user: null, route: "/verify-email" },
    );

    expect(screen.getByText("Sign-in screen")).toBeInTheDocument();
  });

  // Effects run before the redirect; a verified visitor must open no challenge.
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

  // `user` may be the stored snapshot; nothing is asked of Prelude until the
  // session restores.
  it("asks for nothing until the session is confirmed", async () => {
    const startEmailVerification = vi.fn();
    renderVerifyPage({ startEmailVerification, loading: true });

    await waitFor(() => expect(startEmailVerification).not.toHaveBeenCalled());
    expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();
  });
});

describe("ForgotPasswordPage", () => {
  /** The step-up as configured: a second code before the scope is granted. */
  const twoCodes: Partial<AuthContextValue> = {
    confirmPasswordResetCode: async () => ({ secondCodeSent: true }),
  };

  function renderResetPage(auth: Partial<AuthContextValue> = {}) {
    return renderWithProviders(<ForgotPasswordPage />, {
      route: "/forgot-password",
      auth: { ...twoCodes, ...auth },
    });
  }

  /**
   * Renders and asks for a code, which is where the first code form appears.
   * `user` is for a spec on fake timers, which needs its own instance.
   */
  async function reachCodeStep(
    auth: Partial<AuthContextValue> = {},
    user: UserEvent = userEvent.setup(),
  ) {
    const view = renderResetPage(auth);

    await user.type(screen.getByLabelText("Email"), "forgetful@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));

    await screen.findByLabelText("Reset code");
    return view;
  }

  /** One rung further: the code that signs the visitor in has been accepted. */
  async function reachConfirmStep(
    auth: Partial<AuthContextValue> = {},
    user: UserEvent = userEvent.setup(),
  ) {
    const view = await reachCodeStep(auth, user);

    await user.type(screen.getByLabelText("Reset code"), "123456");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByLabelText("Confirmation code");
    return view;
  }

  /** The last rung, where the new password is asked for. */
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

    await waitFor(() => expect(startPasswordReset).toHaveBeenCalledWith("forgetful@example.com"));
    expect(await screen.findByLabelText("Reset code")).toBeInTheDocument();
  });

  it("submits the emailed code, then the one that permits the write", async () => {
    const confirmPasswordResetCode = vi.fn().mockResolvedValue({ secondCodeSent: true });
    const confirmPasswordWriteCode = vi.fn().mockResolvedValue(undefined);
    await reachPasswordStep({ confirmPasswordResetCode, confirmPasswordWriteCode });

    expect(confirmPasswordResetCode).toHaveBeenCalledWith("123456");
    expect(confirmPasswordWriteCode).toHaveBeenCalledWith("654321");
  });

  // Prelude's configuration decides the route, and can flip without a deploy,
  // so both are pinned.
  it("goes straight to the new password when the step-up grants outright", async () => {
    const confirmPasswordResetCode = vi.fn().mockResolvedValue({ secondCodeSent: false });
    await reachCodeStep({ confirmPasswordResetCode });

    await userEvent.type(screen.getByLabelText("Reset code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByLabelText("New password")).toBeInTheDocument();
    expect(screen.queryByLabelText("Confirmation code")).not.toBeInTheDocument();
  });

  // Only a real account reaches the second code, so a wrong one can be named.
  it("names a wrong confirmation code", async () => {
    const confirmPasswordWriteCode = vi
      .fn()
      .mockRejectedValue(namedError("BadCheckCodeError", "Bad check code"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await reachConfirmStep({ confirmPasswordWriteCode });

    await userEvent.type(screen.getByLabelText("Confirmation code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("That code is not correct. Check it and try again."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  // The second code restarts the rest, then a resend is a real one: the visitor
  // is signed in by now, so a failure can be named rather than hidden.
  describe("the confirmation code's resend", () => {
    // Fake from the start, since the rest begins inside reachConfirmStep, and
    // with nothing ticking in real time: the user-event instance advances fake
    // time for its own waits. Testing Library's async utilities end with a
    // setTimeout(0) of their own, which they advance only when they can see a
    // `jest` global, so one is lent for the duration.
    let user: UserEvent;
    beforeEach(() => {
      vi.useFakeTimers();
      Object.assign(globalThis, { jest: { advanceTimersByTime: vi.advanceTimersByTime } });
      user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    });
    afterEach(() => {
      Reflect.deleteProperty(globalThis, "jest");
      vi.useRealTimers();
    });

    /** Lets the resend's rest run out, one tick per render. */
    function waitOutCooldown() {
      for (let second = 0; second < 30; second++) {
        act(() => vi.advanceTimersByTime(1000));
      }
    }

    it("rests after the second code goes out, then sends another", async () => {
      const resendPasswordWriteCode = vi.fn().mockResolvedValue(undefined);
      await reachConfirmStep({ resendPasswordWriteCode }, user);

      // A code just went out, so the button rests rather than offering a second.
      expect(screen.getByRole("button", { name: /Send another in \d+s/ })).toBeDisabled();

      await user.type(screen.getByLabelText("Confirmation code"), "123");
      waitOutCooldown();
      await user.click(screen.getByRole("button", { name: "Send another" }));

      await waitFor(() => expect(resendPasswordWriteCode).toHaveBeenCalled());
      expect(await screen.findByRole("status")).toHaveTextContent(/most recent email/);
      expect(screen.getByLabelText("Confirmation code")).toHaveValue("");
    });

    it("says a confirmation code could not be sent", async () => {
      const resendPasswordWriteCode = vi.fn().mockRejectedValue(emailsUnavailable);
      await reachConfirmStep({ resendPasswordWriteCode }, user);

      waitOutCooldown();
      await user.click(screen.getByRole("button", { name: "Send another" }));

      expect(
        await screen.findByText("Verification emails cannot be sent right now."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
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

  // Every failure at the first code says one string, or the step reveals which
  // addresses are registered.
  const SAME_CODE_FAILURE =
    "That code is not correct, or it has expired. Ask for another and try again.";

  it.each([
    ["a mistyped digit", namedError("BadCheckCodeError", "Bad check code")],
    ["an address with no account", new ApiError(404, "not_found", "No such user.")],
    ["a step-up Prelude refused", new Error('Prelude refused the "prld:pwd:write" step-up.')],
  ])("reports %s the same way", async (_case, failure) => {
    const confirmPasswordResetCode = vi.fn().mockRejectedValue(failure);
    // The cause is logged.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

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
  });

  it("saves the new password", async () => {
    const changePassword = vi.fn().mockResolvedValue(undefined);
    await reachPasswordStep({ changePassword });

    await userEvent.type(screen.getByLabelText("New password"), "a-better-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith("a-better-secret"));
    expect(await screen.findByText("Password changed")).toBeInTheDocument();
  });

  // changePassword rejects with SDK errors, never an ApiError, so stub those.
  it("keeps a rejected password on the password form and says why", async () => {
    const changePassword = vi
      .fn()
      .mockRejectedValue(
        namedError("InvalidPasswordError", "Password does not meet compliancy requirements."),
      );
    const validatePassword = vi
      .fn()
      .mockResolvedValue({ valid: false, messages: ["Use at least 8 characters."] });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await reachPasswordStep({ changePassword, validatePassword });

    await userEvent.type(screen.getByLabelText("New password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));

    expect(
      await screen.findByText("That password does not meet the requirements."),
    ).toBeInTheDocument();
    // The reasons come from the compliancy check rather than being paraphrased.
    expect(await screen.findByText("• Use at least 8 characters.")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
  });

  // An expired grant is named, with a way out, not "try another password".
  it("names an expired reset rather than blaming the password", async () => {
    const changePassword = vi.fn().mockRejectedValue(namedError("ForbiddenError", "Forbidden"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await reachPasswordStep({ changePassword });

    await userEvent.type(screen.getByLabelText("New password"), "a-better-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));

    expect(
      await screen.findByText("This reset has expired. Ask for a new code and start again."),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Start again with a new code" }));
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
  });

  // The reset ends by offering to end other sessions.
  it("signs out other devices when asked to", async () => {
    const signOutOtherDevices = vi.fn().mockResolvedValue(undefined);
    await reachPasswordStep({ signOutOtherDevices });

    await userEvent.type(screen.getByLabelText("New password"), "a-better-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));
    await userEvent.click(await screen.findByRole("button", { name: "Sign out my other devices" }));

    await waitFor(() => expect(signOutOtherDevices).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent(
      /other devices have been signed out/i,
    );
  });

  // The password is already saved; this failure must not read otherwise.
  it("does not report a failed sign-out as a failed reset", async () => {
    const signOutOtherDevices = vi.fn().mockRejectedValue(new Error("revoke failed"));
    await reachPasswordStep({ signOutOtherDevices });

    await userEvent.type(screen.getByLabelText("New password"), "a-better-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));
    await userEvent.click(await screen.findByRole("button", { name: "Sign out my other devices" }));

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

  // A failed resend must look identical to the successful one above in every
  // observable, or it reveals which addresses are registered.
  it("reports a failed resend exactly like a sent one", async () => {
    const resendPasswordResetCode = vi.fn().mockRejectedValue(new Error("no such verification"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

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
  });

  // A build without the OTP login configuration says so, not "Prelude is down".
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

  // The code is requested when this screen opens.
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
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderChangePage({ confirmPasswordWriteCode });

    await userEvent.type(await screen.findByLabelText("Confirmation code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("That code is not correct. Check it and try again."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  // Anything but a wrong digit is not the visitor's typo, and must not read as one.
  it("does not call a code that could not be checked wrong", async () => {
    const confirmPasswordWriteCode = vi.fn().mockRejectedValue(new Error("network down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderChangePage({ confirmPasswordWriteCode });

    await userEvent.type(await screen.findByLabelText("Confirmation code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("That code could not be checked. Ask for another and try again."),
    ).toBeInTheDocument();
  });

  it("saves the new password", async () => {
    const changePassword = vi.fn().mockResolvedValue(undefined);
    await reachPasswordStep({ changePassword });

    await userEvent.type(screen.getByLabelText("New password"), "a-better-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith("a-better-secret"));
    expect(await screen.findByText("Password changed")).toBeInTheDocument();
  });

  // Neither expired nor rejected: no hints are worth fetching, and the form stays.
  it("reports an unexplained save failure on the password form", async () => {
    const changePassword = vi.fn().mockRejectedValue(new Error("network down"));
    const validatePassword = vi.fn().mockResolvedValue({ valid: true, messages: [] });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await reachPasswordStep({ changePassword, validatePassword });

    await userEvent.type(screen.getByLabelText("New password"), "a-better-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));

    expect(
      await screen.findByText("That password could not be saved. Please try another."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
  });

  // A no-code grant is refused, pointing at the reset instead.
  it("refuses to change a password when Prelude asks for nothing", async () => {
    const startPasswordChange = vi
      .fn()
      .mockRejectedValue(
        namedError(PASSWORD_CHANGE_UNAVAILABLE_ERROR, "granted with no challenge"),
      );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

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
  });

  // A failed open is said, and resend must be able to open a challenge.
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

  // Resend is held while the first send is in flight: a second step-up would
  // retire it, and no cooldown has started.
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

  it("says a code could not be sent", async () => {
    const resendPasswordWriteCode = vi.fn().mockRejectedValue(emailsUnavailable);
    renderChangePage({ resendPasswordWriteCode });

    await userEvent.click(await screen.findByRole("button", { name: "Send another" }));

    expect(
      await screen.findByText("Verification emails cannot be sent right now."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Confirmation code")).toBeInTheDocument();
  });

  // A fresh challenge rereads Prelude's configuration, so a grant that stopped
  // asking for a code can first show up on a resend, and is refused there too.
  it("refuses on a resend that Prelude answers with no code", async () => {
    const resendPasswordWriteCode = vi
      .fn()
      .mockRejectedValue(
        namedError(PASSWORD_CHANGE_UNAVAILABLE_ERROR, "granted with no challenge"),
      );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    renderChangePage({ resendPasswordWriteCode });

    await userEvent.click(await screen.findByRole("button", { name: "Send another" }));

    expect(
      await screen.findByText(
        "This deployment is not set up to confirm a password change by email.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Confirmation code")).not.toBeInTheDocument();
    expect(logged).toHaveBeenCalled();
  });

  // An expired grant is named, and the way out asks for a new code.
  it("names an expired confirmation and asks for a new code", async () => {
    const changePassword = vi.fn().mockRejectedValue(namedError("ForbiddenError", "Forbidden"));
    const resendPasswordWriteCode = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await reachPasswordStep({ changePassword, resendPasswordWriteCode });

    await userEvent.type(screen.getByLabelText("New password"), "a-better-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));

    expect(
      await screen.findByText("That confirmation has expired. Ask for a new code and try again."),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Start again with a new code" }));

    expect(await screen.findByLabelText("Confirmation code")).toBeInTheDocument();
    await waitFor(() => expect(resendPasswordWriteCode).toHaveBeenCalled());
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
    vi.spyOn(console, "error").mockImplementation(() => {});

    await reachPasswordStep({ changePassword, validatePassword });

    await userEvent.type(screen.getByLabelText("New password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));

    expect(
      await screen.findByText("That password does not meet the requirements."),
    ).toBeInTheDocument();
    expect(await screen.findByText("• Use at least 8 characters.")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
  });

  // The check is remembered with its reasons, so returning to a refused
  // password still shows why.
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

  // Ending other sessions can fail without reading as the password not saving.
  it("signs out other devices when asked to", async () => {
    const signOutOtherDevices = vi.fn().mockResolvedValue(undefined);
    await reachPasswordStep({ signOutOtherDevices });

    await userEvent.type(screen.getByLabelText("New password"), "a-better-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));
    await userEvent.click(await screen.findByRole("button", { name: "Sign out my other devices" }));

    await waitFor(() => expect(signOutOtherDevices).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent(
      /other devices have been signed out/i,
    );
  });

  // Effects run before the redirect; a signed-out visitor must open no challenge.
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

  // A guest is sent to sign in by the route's guard.
  it("sends a guest to sign in", async () => {
    renderWithProviders(<App />, { user: null, route: "/change-password" });

    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
  });
});

describe("sign-in and sign-up screens", () => {
  // `user` may be a stored snapshot; the redirect waits for the restore.
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

  // Sign-up waits for the restore too.
  it("keeps the sign-up form up until the session is confirmed", () => {
    renderWithProviders(<RegisterPage />, {
      user: makeUser(),
      route: "/register",
      auth: { loading: true },
    });

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  // The other side: once restored, a signed-in visitor is redirected.
  it("sends a signed-in visitor away from the sign-up form", () => {
    renderWithProviders(<App />, { user: makeUser(), route: "/register" });

    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  // And a restored guest stays.
  it("shows the sign-up form to a guest", () => {
    renderWithProviders(<App />, { user: null, route: "/register" });

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  /** Arrives at sign-in the way a guard sends a visitor: with where they were headed. */
  function SentToSignIn() {
    return <Navigate to="/login" state={{ from: "/lists/list-1?sort=title" }} replace />;
  }

  // The guard recorded the address, search string included; losing it lands
  // every visitor on the catalog after signing in.
  it("signs in and returns to where the visitor was headed", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <Routes>
        <Route path="/start" element={<SentToSignIn />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/lists/:id" element={<LocationProbe />} />
      </Routes>,
      { route: "/start", auth: { login } },
    );

    await userEvent.type(screen.getByLabelText("Email"), "  singer@example.com ");
    await userEvent.type(screen.getByLabelText("Password"), "a-secret");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(login).toHaveBeenCalledWith("singer@example.com", "a-secret"));
    expect(await screen.findByTestId("location")).toHaveTextContent("/lists/list-1?sort=title");
  });

  // Naming which half was wrong would say which addresses are registered.
  it("does not say which half of a refused sign-in was wrong", async () => {
    const login = vi.fn().mockRejectedValue(namedError("InvalidCredentialsError", "No such user"));
    renderWithProviders(<LoginPage />, { route: "/login", auth: { login } });

    await userEvent.type(screen.getByLabelText("Email"), "nobody@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "a-secret");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("That email and password combination was not recognized."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  // An unverified account would be sent there by the gate anyway; going
  // straight there saves a bounce through the catalog.
  it("creates the account and goes straight to the code screen", async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<p>Code screen</p>} />
      </Routes>,
      { route: "/register", auth: { register } },
    );

    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("Optional");
    await userEvent.type(screen.getByLabelText("Name"), "Μαρίνα");
    await userEvent.type(screen.getByLabelText("Email"), " new@example.com ");
    await userEvent.type(screen.getByLabelText("Password"), "a-better-secret");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({
        email: "new@example.com",
        password: "a-better-secret",
        displayName: "Μαρίνα",
      }),
    );
    expect(await screen.findByText("Code screen")).toBeInTheDocument();
  });

  it("puts the server's reason for a field under that field", async () => {
    const register = vi.fn().mockRejectedValue(
      new ApiError(409, "conflict", "An account with that email already exists.", {
        email: "This address is already registered.",
      }),
    );
    renderWithProviders(<RegisterPage />, { route: "/register", auth: { register } });

    await userEvent.type(screen.getByLabelText("Email"), "taken@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "a-better-secret");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText("An account with that email already exists."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "This address is already registered.",
    );
  });

  // The rules are Prelude's, so they are asked for rather than written here.
  it("shows the password rules when the field is left", async () => {
    const validatePassword = vi
      .fn()
      .mockResolvedValue({ valid: false, messages: ["Use at least 8 characters."] });
    renderWithProviders(<RegisterPage />, { route: "/register", auth: { validatePassword } });

    // Leaving it empty asks nothing: each check is a round trip.
    await userEvent.click(screen.getByLabelText("Password"));
    await userEvent.tab();
    expect(validatePassword).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.tab();

    expect(await screen.findByText("• Use at least 8 characters.")).toBeInTheDocument();
    expect(validatePassword).toHaveBeenCalledWith("short");
  });
});

/** Renders the address it is reached at, for specs that assert a destination. */
function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

describe("verification gate", () => {
  // The API refuses an unverified account everything, so it is held on verification.
  it("holds an unverified account on the verification screen", async () => {
    renderWithProviders(<App />, { user: unverified, route: "/lists" });

    expect(await screen.findByText("Check your email")).toBeInTheDocument();
  });

  it("lets a verified account through", async () => {
    renderWithProviders(<App />, { user: makeUser(), route: "/" });

    expect(await screen.findByRole("searchbox")).toBeInTheDocument();
  });

  // The reset signs the visitor in mid-flow; the gate must not bounce it.
  it("leaves an unverified account on the reset screen", async () => {
    renderWithProviders(<App />, { user: unverified, route: "/forgot-password" });

    expect(await screen.findByText("Reset your password")).toBeInTheDocument();
  });

  // Nor may the reset itself redirect a signed-in visitor.
  it("does not send a signed-in visitor away from the reset screen", async () => {
    renderWithProviders(<App />, { user: makeUser(), route: "/forgot-password" });

    expect(await screen.findByText("Reset your password")).toBeInTheDocument();
  });

  // The gate waits for the restore: a stale snapshot may predate verification.
  it("holds nobody until the session is confirmed", async () => {
    renderWithProviders(<App />, { user: unverified, route: "/", auth: { loading: true } });

    expect(await screen.findByRole("searchbox")).toBeInTheDocument();
  });
});
