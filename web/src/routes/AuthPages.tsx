import { useCallback, useEffect, useRef, useState, type SubmitEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { errorDetails, errorMessage } from "@/api/client";
import { PASSWORD_CHANGE_UNAVAILABLE_ERROR, RESET_UNCONFIGURED_ERROR } from "@/auth/context";
import { returnDestination } from "@/auth/returnTo";
import { useAuth } from "@/auth/useAuth";
import { buttonClasses } from "@/components/buttonStyles";
import { PageTitle } from "@/components/PageTitle";
import { Button, ErrorMessage, Field, Input, Notice, Spinner } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";

/** Shell shared by every auth screen. */
function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      {/* Titled per step, so a reset's steps (state, not routes) differ in history. */}
      <PageTitle name={title} />
      <div className="mb-8 text-center">
        <Wordmark size="lg" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Wherever they were headed before being asked to sign in.
  const destination = returnDestination(location.state);

  // Only a restored session redirects: `user` starts as a possibly expired
  // snapshot, which would bounce someone who came to sign in.
  if (user && !loading) return <Navigate to={destination} replace />;

  const onSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await login(email.trim(), password);
      void navigate(destination, { replace: true });
    } catch (caught) {
      // Credential errors are not distinguished, so registered emails don't leak.
      setError(errorMessage(caught, "That email and password combination was not recognized."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to manage your lists">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <ErrorMessage>{error}</ErrorMessage>}

        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Sign in
        </Button>
      </form>

      <p className="mt-4 text-center text-sm">
        <Link to="/forgot-password" className="text-stone-500 hover:underline dark:text-stone-400">
          Forgot your password?
        </Link>
      </p>

      <p className="mt-6 text-center text-sm text-stone-500 dark:text-stone-400">
        No account?{" "}
        <Link to="/register" className="font-medium text-brand-600 hover:underline">
          Create one
        </Link>
      </p>
      <p className="mt-2 text-center text-sm">
        <Link to="/" className="text-stone-500 hover:underline dark:text-stone-400">
          Continue as guest
        </Link>
      </p>
    </AuthShell>
  );
}

/**
 * Prelude's verdict on a password, checked on blur since each check is a round
 * trip. Shared by every screen that sets a password.
 */
function usePasswordHints() {
  const { validatePassword } = useAuth();
  const [hints, setHints] = useState<string[]>([]);
  // The last verdict and its reasons together, to skip the repeat check submit's
  // blur causes; the password alone would skip it and show no reasons. Empty
  // verdicts are not remembered: validatePassword reports a failed fetch as one.
  const judged = useRef<{ password: string; messages: string[] } | null>(null);

  const check = async (password: string) => {
    if (!password) return;
    if (judged.current?.password === password) {
      setHints(judged.current.messages);
      return;
    }

    const { messages } = await validatePassword(password);
    judged.current = messages.length > 0 ? { password, messages } : null;
    setHints(messages);
  };

  // Clears hints for an abandoned password.
  const clear = () => {
    judged.current = null;
    setHints([]);
  };

  return { hints, check, clear };
}

/** The rules a typed password does not yet meet, in Prelude's own words. */
function PasswordHints({ hints }: { hints: string[] }) {
  if (hints.length === 0) return null;

  return (
    <ul className="space-y-1 text-xs text-stone-500 dark:text-stone-400">
      {hints.map((hint) => (
        <li key={hint}>• {hint}</li>
      ))}
    </ul>
  );
}

/** How long the resend button rests, so a stuck user cannot mail-bomb themselves. */
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Sentences shared by several code forms. Deliberately per-screen wording stays
 * with its screen.
 */
const CODE_RESENT_NOTICE = "A new code is on its way. Use the one in the most recent email.";
const CODE_NOT_SENT = "We could not send a new code. Please try again shortly.";
const CODE_UNSENDABLE = "We could not send a code just now. Try asking for another.";
const PASSWORD_REJECTED = "That password does not meet the requirements.";
const PASSWORD_UNSAVED = "That password could not be saved. Please try another.";

/** The rest between one emailed code and the next, shared by every code screen. */
function useResendCooldown() {
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const startCooldown = useCallback(() => setCooldown(RESEND_COOLDOWN_SECONDS), []);

  return { cooldown, startCooldown };
}

/** "No code yet? Send another", showing the wait while the button rests. */
function ResendCodeLink({
  resending,
  cooldown,
  onResend,
}: {
  resending: boolean;
  cooldown: number;
  onResend: () => void;
}) {
  return (
    <p>
      No code yet?{" "}
      <button
        type="button"
        onClick={onResend}
        disabled={resending || cooldown > 0}
        className="font-medium text-brand-600 hover:underline disabled:cursor-not-allowed disabled:text-stone-400 disabled:no-underline"
      >
        {cooldown > 0 ? `Send another in ${cooldown}s` : "Send another"}
      </button>
    </p>
  );
}

export function RegisterPage() {
  const { user, loading, register } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const passwordHints = usePasswordHints();

  // Waits for the session, as the sign-in screen does.
  if (user && !loading) return <Navigate to="/" replace />;

  const onSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    setSubmitting(true);

    try {
      await register({ email: email.trim(), password, displayName });
      // Straight to the code screen: the gate would send an unverified account there.
      void navigate("/verify-email", { replace: true });
    } catch (caught) {
      setError(errorMessage(caught, "Your account could not be created. Please try again."));
      setFieldErrors(errorDetails(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Create an account" subtitle="Build and share your own song lists">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <ErrorMessage>{error}</ErrorMessage>}

        <Field label="Name" htmlFor="display-name" hint="Optional">
          <Input
            id="display-name"
            autoComplete="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>

        <Field label="Email" htmlFor="email" error={fieldErrors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
          />
        </Field>

        <Field label="Password" htmlFor="password" error={fieldErrors.password}>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={() => passwordHints.check(password)}
            aria-describedby={fieldErrors.password ? "password-error" : undefined}
          />
        </Field>

        <PasswordHints hints={passwordHints.hints} />

        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-stone-500 dark:text-stone-400">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

/** Digits in a Prelude code, mirroring the application's `code_size`. */
const CODE_LENGTH = 6;

/**
 * Whether a thrown value is Prelude's "that code was wrong". By name, so this
 * page imports nothing from the SDK.
 */
function isBadCode(caught: unknown): boolean {
  return caught instanceof Error && caught.name === "BadCheckCodeError";
}

/**
 * Whether a thrown value is "this build has no OTP login configuration", so an
 * operator-fixable failure does not read as an outage.
 */
function isUnconfigured(caught: unknown): boolean {
  return caught instanceof Error && caught.name === RESET_UNCONFIGURED_ERROR;
}

/**
 * Whether Prelude rejected the password itself. `changePassword` bypasses our
 * API, so `errorMessage` cannot name the reason.
 */
function isInvalidPassword(caught: unknown): boolean {
  return caught instanceof Error && caught.name === "InvalidPasswordError";
}

/**
 * Whether the change screen was refused because the step-up granted
 * `prld:pwd:write` with no code. Operator-fixable; must not read as an outage.
 */
function isChangeUnavailable(caught: unknown): boolean {
  return caught instanceof Error && caught.name === PASSWORD_CHANGE_UNAVAILABLE_ERROR;
}

/**
 * Whether the `prld:pwd:write` grant expired. Named, or it reads as "try another
 * password", which no password satisfies.
 */
function isExpiredGrant(caught: unknown): boolean {
  return caught instanceof Error && caught.name === "ForbiddenError";
}

/** The emailed-code field, shared by every screen that asks for one. */
function CodeField({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: string;
  error?: string | undefined;
  onChange: (code: string) => void;
}) {
  return (
    <Field label={label} htmlFor="code" error={error}>
      <Input
        id="code"
        // Numeric keypad, and one-time-code autofill from the mail notification.
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        required
        className="text-center text-lg tracking-[0.4em]"
        value={value}
        // Non-digits are stripped, so a pasted "Code: 123456" works.
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
        aria-describedby={error ? "code-error" : undefined}
      />
    </Field>
  );
}

/** The new-password field, shared by the reset and change screens. */
function NewPasswordField({
  value,
  hints,
  onChange,
  onCheck,
}: {
  value: string;
  hints: string[];
  onChange: (password: string) => void;
  onCheck: () => void;
}) {
  return (
    <>
      <Field label="New password" htmlFor="new-password">
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          autoFocus
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onCheck}
        />
      </Field>

      <PasswordHints hints={hints} />
    </>
  );
}

/**
 * What to say when the code permitting a password write is refused. Naming a
 * wrong digit leaks nothing here; the reset's first code step must not use this.
 */
function writeCodeMessage(caught: unknown): string {
  return isBadCode(caught)
    ? "That code is not correct. Check it and try again."
    : "That code could not be checked. Ask for another and try again.";
}

/**
 * What to say when Prelude refused a new password, and whether to refresh the
 * field's hints. Only the expired sentence differs per screen.
 */
function passwordSaveFailure(
  caught: unknown,
  expired: string,
): { message: string; hintsWorthChecking: boolean } {
  if (isExpiredGrant(caught)) return { message: expired, hintsWorthChecking: false };
  if (isInvalidPassword(caught)) return { message: PASSWORD_REJECTED, hintsWorthChecking: true };
  return { message: errorMessage(caught, PASSWORD_UNSAVED), hintsWorthChecking: false };
}

/**
 * Offers, after a password change, to end the other sessions. Its failures are
 * its own, so they cannot read as the password not saving.
 */
function SignOutOthersPanel() {
  const { signOutOtherDevices } = useAuth();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  if (signedOut) return <Notice>Your other devices have been signed out.</Notice>;

  const onSignOutOthers = async () => {
    setError("");
    setSubmitting(true);

    try {
      await signOutOtherDevices();
      setSignedOut(true);
    } catch (caught) {
      setError(
        errorMessage(
          caught,
          "Your password was changed, but other devices could not be signed out.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <p className="text-sm text-stone-500 dark:text-stone-400">
        If you are signed in somewhere else, you can end those sessions now.
      </p>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full"
        loading={submitting}
        onClick={onSignOutOthers}
      >
        Sign out my other devices
      </Button>
    </>
  );
}

/**
 * Which of the reset's steps is on screen. `confirm` is the step-up's second
 * code; whether it is visited is Prelude's answer, so both routes must work.
 */
type ResetStep = "email" | "code" | "confirm" | "password" | "done";

/**
 * Resets a forgotten password. The emailed code is a login, so the visitor is
 * signed in from the code step on. See CLAUDE.md, "Password reset".
 */
export function ForgotPasswordPage() {
  const {
    startPasswordReset,
    resendPasswordResetCode,
    confirmPasswordResetCode,
    confirmPasswordWriteCode,
    resendPasswordWriteCode,
    changePassword,
  } = useAuth();

  const [step, setStep] = useState<ResetStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // Separate from the first code, which would otherwise carry over spent.
  const [confirmCode, setConfirmCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const passwordHints = usePasswordHints();
  const { cooldown, startCooldown } = useResendCooldown();

  // Clears the previous attempt's messages.
  const resetFeedback = () => {
    setError("");
    setNotice("");
  };

  // Back to the first step, keeping only the address. The code and the grant
  // both expire, and the steps are state, so Back is no exit.
  const startOver = () => {
    resetFeedback();
    setCode("");
    setConfirmCode("");
    setPassword("");
    // Drop hints for the abandoned password.
    passwordHints.clear();
    setStep("email");
  };

  const onSubmitEmail = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetFeedback();
    setSubmitting(true);

    try {
      await startPasswordReset(email.trim());
      // On to the code form whatever the address: branching here would reveal
      // which addresses have accounts.
      setStep("code");
    } catch (caught) {
      setError(
        isUnconfigured(caught)
          ? "Password reset is not configured for this deployment."
          : errorMessage(caught, "We could not send a code just now. Please try again."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitCode = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetFeedback();
    setSubmitting(true);

    try {
      const { secondCodeSent } = await confirmPasswordResetCode(code);
      // Prelude decides: a second code, or a grant with none.
      if (secondCodeSent) {
        // A code just went out, so the shared cooldown restarts for it.
        startCooldown();
      }
      setStep(secondCodeSent ? "confirm" : "password");
    } catch (caught) {
      // One message for every failure, or this step reveals which addresses are
      // registered. The cause goes to the console.
      console.error("Password reset code could not be checked:", caught);
      setError("That code is not correct, or it has expired. Ask for another and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Every observable is identical whether the retry succeeds or fails, or it
  // reveals which addresses are registered. The cause goes to the console.
  const onResend = async () => {
    resetFeedback();
    setResending(true);

    try {
      await resendPasswordResetCode();
    } catch (caught) {
      console.error("A new password reset code could not be sent:", caught);
    } finally {
      startCooldown();
      setCode("");
      setNotice(CODE_RESENT_NOTICE);
      setResending(false);
    }
  };

  const onSubmitConfirmCode = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetFeedback();
    setSubmitting(true);

    try {
      await confirmPasswordWriteCode(confirmCode);
      setStep("password");
    } catch (caught) {
      // Only a real account reaches this step, so a wrong code can be named.
      console.error("The password confirmation code could not be checked:", caught);
      setError(writeCodeMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const onResendConfirmCode = async () => {
    resetFeedback();
    setResending(true);

    try {
      await resendPasswordWriteCode();
      startCooldown();
      setConfirmCode("");
      setNotice(CODE_RESENT_NOTICE);
    } catch (caught) {
      setError(errorMessage(caught, CODE_NOT_SENT));
    } finally {
      setResending(false);
    }
  };

  const onSubmitPassword = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetFeedback();
    setSubmitting(true);

    try {
      await changePassword(password);
      setStep("done");
    } catch (caught) {
      // Prelude's errors bypass errorMessage, and the visitor is signed in, so
      // causes can be named.
      console.error("The new password could not be saved:", caught);
      const failure = passwordSaveFailure(
        caught,
        "This reset has expired. Ask for a new code and start again.",
      );
      setError(failure.message);
      if (failure.hintsWorthChecking) await passwordHints.check(password);
    } finally {
      setSubmitting(false);
    }
  };

  // No redirect for a signed-in visitor: the accepted code is a login, so a
  // redirect would eject them one step short of the new password.

  if (step === "email") {
    return (
      <AuthShell title="Reset your password" subtitle="We will email you a code to get back in">
        <form onSubmit={onSubmitEmail} className="space-y-4" noValidate>
          {error && <ErrorMessage>{error}</ErrorMessage>}

          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              autoFocus
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            Email me a code
          </Button>
        </form>

        <p className="mt-6 text-center text-sm">
          <Link to="/login" className="text-stone-500 hover:underline dark:text-stone-400">
            Back to sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  if (step === "code") {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`We sent a ${CODE_LENGTH}-digit code to ${email.trim()}`}
      >
        <form onSubmit={onSubmitCode} className="space-y-4" noValidate>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          {notice && <Notice>{notice}</Notice>}

          <CodeField label="Reset code" value={code} onChange={setCode} />

          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={submitting}
            disabled={code.length < CODE_LENGTH}
          >
            Continue
          </Button>
        </form>

        <div className="mt-6 space-y-2 text-center text-sm text-stone-500 dark:text-stone-400">
          <ResendCodeLink resending={resending} cooldown={cooldown} onResend={onResend} />
          <p>
            Wrong address?{" "}
            <button
              type="button"
              onClick={startOver}
              className="font-medium text-stone-500 hover:underline dark:text-stone-400"
            >
              Start over
            </button>
          </p>
        </div>
      </AuthShell>
    );
  }

  if (step === "confirm") {
    return (
      <AuthShell title="One more code" subtitle={`We sent a second code to ${email.trim()}`}>
        <form onSubmit={onSubmitConfirmCode} className="space-y-4" noValidate>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          {notice && <Notice>{notice}</Notice>}

          {/* Explains the second code, which otherwise reads as the first failing. */}
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Setting a new password needs one more check of your email. This is the last step before
            you choose it.
          </p>

          <CodeField label="Confirmation code" value={confirmCode} onChange={setConfirmCode} />

          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={submitting}
            disabled={confirmCode.length < CODE_LENGTH}
          >
            Continue
          </Button>
        </form>

        <div className="mt-6 space-y-2 text-center text-sm text-stone-500 dark:text-stone-400">
          <ResendCodeLink
            resending={resending}
            cooldown={cooldown}
            onResend={onResendConfirmCode}
          />
          <p>
            <button
              type="button"
              onClick={startOver}
              className="font-medium text-stone-500 hover:underline dark:text-stone-400"
            >
              Start over
            </button>
          </p>
        </div>
      </AuthShell>
    );
  }

  if (step === "password") {
    return (
      <AuthShell title="Choose a new password" subtitle="This replaces the one you forgot">
        <form onSubmit={onSubmitPassword} className="space-y-4" noValidate>
          {error && <ErrorMessage>{error}</ErrorMessage>}

          <NewPasswordField
            value={password}
            hints={passwordHints.hints}
            onChange={setPassword}
            onCheck={() => passwordHints.check(password)}
          />

          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            Save new password
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-stone-500 dark:text-stone-400">
          <button
            type="button"
            onClick={startOver}
            className="font-medium text-stone-500 hover:underline dark:text-stone-400"
          >
            Start again with a new code
          </button>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Password changed" subtitle="You are signed in with your new password">
      <div className="space-y-4">
        <SignOutOthersPanel />

        {/* A styled Link: a button inside an anchor is invalid. */}
        <Link to="/" className={buttonClasses("primary", "lg", "w-full")}>
          Continue to Songfolio
        </Link>
      </div>
    </AuthShell>
  );
}

/**
 * Confirms a new account's email address; every unverified visitor is held
 * here. Sign-out is the exit for a mistyped address.
 */
export function VerifyEmailPage() {
  const { user, loading, startEmailVerification, verifyEmail, resendVerificationCode, logout } =
    useAuth();
  const navigate = useNavigate();

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [sending, setSending] = useState(true);
  const started = useRef(false);
  const { cooldown, startCooldown } = useResendCooldown();

  // Sent on open: the challenge belongs to the browser's Prelude session. The
  // ref stops StrictMode's double run from retiring the first code.
  useEffect(() => {
    // Hooks run before the redirects below, so a verified or signed-out visitor
    // must not open a challenge here; nor may anyone before the restore settles.
    if (loading || !user || user.email_verified_at) return;
    if (started.current) return;
    started.current = true;

    // No cancellation flag: under StrictMode the cleanup would discard the run
    // that opened the challenge, leaving "Sending code…" forever.
    void (async () => {
      try {
        await startEmailVerification();
      } catch (caught) {
        // Lets a resend open a challenge again.
        started.current = false;
        setError(errorMessage(caught, CODE_UNSENDABLE));
      } finally {
        setSending(false);
      }
    })();
  }, [loading, startEmailVerification, user]);

  // Reached by redirect, so a reload lands here mid-restore; wait, or it bounces
  // to sign-in.
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.email_verified_at) return <Navigate to="/" replace />;

  const onSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    setNotice("");
    setSubmitting(true);

    try {
      await verifyEmail(code);
      void navigate("/", { replace: true });
    } catch (caught) {
      // A wrong code is a Prelude SDK error, named so a typo reads as one.
      setError(
        isBadCode(caught)
          ? "That code is not correct. Check it and try again."
          : errorMessage(caught, "That code could not be checked. Please try again."),
      );
      setFieldErrors(errorDetails(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    setError("");
    setFieldErrors({});
    setNotice("");
    setResending(true);

    try {
      await resendVerificationCode();
      startCooldown();
      setCode("");
      setNotice(CODE_RESENT_NOTICE);
    } catch (caught) {
      setError(errorMessage(caught, CODE_NOT_SENT));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthShell
      title="Check your email"
      subtitle={`We sent a ${CODE_LENGTH}-digit code to ${user.email}`}
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {notice && <Notice>{notice}</Notice>}

        <CodeField
          label="Verification code"
          value={code}
          error={fieldErrors.code}
          onChange={setCode}
        />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={submitting || sending}
          disabled={code.length < CODE_LENGTH}
        >
          {sending ? "Sending code…" : "Verify email"}
        </Button>
      </form>

      <div className="mt-6 space-y-2 text-center text-sm text-stone-500 dark:text-stone-400">
        {/* Held while the opening code is in flight, or a second step-up retires it. */}
        <ResendCodeLink resending={resending || sending} cooldown={cooldown} onResend={onResend} />
        <p>
          Wrong address?{" "}
          <button
            type="button"
            onClick={() => logout()}
            className="font-medium text-stone-500 hover:underline dark:text-stone-400"
          >
            Sign out
          </button>
        </p>
      </div>
    </AuthShell>
  );
}

/** Which of the change-password steps is on screen, `unavailable` included. */
type ChangeStep = "code" | "password" | "done" | "unavailable";

/**
 * Changes a signed-in user's password. The emailed code is the only proof, so
 * there is no "current password" field and a no-code grant is refused. See
 * CLAUDE.md, "Changing a password while signed in".
 */
export function ChangePasswordPage() {
  const {
    user,
    startPasswordChange,
    confirmPasswordWriteCode,
    resendPasswordWriteCode,
    changePassword,
  } = useAuth();

  const [step, setStep] = useState<ChangeStep>("code");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [sending, setSending] = useState(true);
  const passwordHints = usePasswordHints();
  const { cooldown, startCooldown } = useResendCooldown();
  const started = useRef(false);

  const resetFeedback = () => {
    setError("");
    setNotice("");
  };

  // Sent on open, as on the verification screen; the ref survives StrictMode.
  useEffect(() => {
    // Hooks run before the redirect below; a signed-out visitor opens nothing.
    if (!user) return;
    if (started.current) return;
    started.current = true;

    // No cancellation flag, as on the verification screen.
    void (async () => {
      try {
        await startPasswordChange();
      } catch (caught) {
        // Lets a resend open a challenge again.
        started.current = false;
        if (isChangeUnavailable(caught)) {
          // Not retryable by the visitor; say so rather than wait for no code.
          console.error("The password change step-up asked for nothing:", caught);
          setStep("unavailable");
          return;
        }
        setError(errorMessage(caught, CODE_UNSENDABLE));
      } finally {
        setSending(false);
      }
    })();
  }, [startPasswordChange, user]);

  // Covers the session ending while the screen is open.
  if (!user) return <Navigate to="/login" replace />;

  const onSubmitCode = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetFeedback();
    setSubmitting(true);

    try {
      await confirmPasswordWriteCode(code);
      setStep("password");
    } catch (caught) {
      // Signed in to their own account, so a wrong code can be named.
      console.error("The password change code could not be checked:", caught);
      setError(writeCodeMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    resetFeedback();
    setResending(true);

    try {
      await resendPasswordWriteCode();
      startCooldown();
      setCode("");
      setNotice(CODE_RESENT_NOTICE);
    } catch (caught) {
      // A fresh challenge rereads the configuration, so the no-code refusal can
      // surface here too.
      if (isChangeUnavailable(caught)) {
        console.error("The password change step-up asked for nothing:", caught);
        setStep("unavailable");
        return;
      }
      setError(errorMessage(caught, CODE_NOT_SENT));
    } finally {
      setResending(false);
    }
  };

  // The grant can expire under the password form, so this asks for a new code;
  // the spent challenge cannot be reused.
  const startAgain = async () => {
    setPassword("");
    // Drop hints for the abandoned password.
    passwordHints.clear();
    setStep("code");
    await onResend();
  };

  const onSubmitPassword = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetFeedback();
    setSubmitting(true);

    try {
      await changePassword(password);
      setStep("done");
    } catch (caught) {
      // As on the reset; only the expired sentence differs.
      console.error("The new password could not be saved:", caught);
      const failure = passwordSaveFailure(
        caught,
        "That confirmation has expired. Ask for a new code and try again.",
      );
      setError(failure.message);
      if (failure.hintsWorthChecking) await passwordHints.check(password);
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "unavailable") {
    return (
      <AuthShell
        title="Not available right now"
        subtitle="Your password cannot be changed from here"
      >
        <div className="space-y-4">
          <ErrorMessage>
            This deployment is not set up to confirm a password change by email.
          </ErrorMessage>
          {/* The reset proves the same mailbox by the same kind of code. */}
          <p className="text-sm text-stone-500 dark:text-stone-400">
            You can still set a new password by resetting it, which emails you a code to confirm it
            is you.
          </p>
          <Link to="/forgot-password" className={buttonClasses("primary", "lg", "w-full")}>
            Reset my password instead
          </Link>
          <Link to="/profile" className={buttonClasses("secondary", "lg", "w-full")}>
            Back to profile
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (step === "code") {
    return (
      <AuthShell title="Confirm it is you" subtitle={`We sent a code to ${user.email}`}>
        <form onSubmit={onSubmitCode} className="space-y-4" noValidate>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          {notice && <Notice>{notice}</Notice>}

          <CodeField label="Confirmation code" value={code} onChange={setCode} />

          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={submitting || sending}
            disabled={code.length < CODE_LENGTH}
          >
            {sending ? "Sending code…" : "Continue"}
          </Button>
        </form>

        <div className="mt-6 space-y-2 text-center text-sm text-stone-500 dark:text-stone-400">
          {/* Held while the first code is in flight, as on the verification screen. */}
          <ResendCodeLink
            resending={resending || sending}
            cooldown={cooldown}
            onResend={onResend}
          />
          <p>
            <Link
              to="/profile"
              className="font-medium text-stone-500 hover:underline dark:text-stone-400"
            >
              Back to profile
            </Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  if (step === "password") {
    return (
      <AuthShell title="Choose a new password" subtitle="This replaces the one you use now">
        <form onSubmit={onSubmitPassword} className="space-y-4" noValidate>
          {error && <ErrorMessage>{error}</ErrorMessage>}

          <NewPasswordField
            value={password}
            hints={passwordHints.hints}
            onChange={setPassword}
            onCheck={() => passwordHints.check(password)}
          />

          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            Save new password
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-stone-500 dark:text-stone-400">
          {/* Disabled while working: no cooldown has started to stop a second code. */}
          <button
            type="button"
            onClick={startAgain}
            disabled={resending}
            className="font-medium text-stone-500 hover:underline disabled:cursor-not-allowed disabled:text-stone-400 disabled:no-underline dark:text-stone-400"
          >
            Start again with a new code
          </button>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Password changed" subtitle="Your new password is the one to use from now on">
      <div className="space-y-4">
        <SignOutOthersPanel />

        <Link to="/profile" className={buttonClasses("primary", "lg", "w-full")}>
          Back to profile
        </Link>
      </div>
    </AuthShell>
  );
}
