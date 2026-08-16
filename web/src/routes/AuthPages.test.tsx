import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { VerifyEmailPage } from "./AuthPages";
import { App } from "@/App";
import { ApiError } from "@/api/client";
import type { AuthContextValue } from "@/auth/context";
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
});
