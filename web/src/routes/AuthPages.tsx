import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { errorDetails, errorMessage } from "@/api/client";
import { RESET_UNCONFIGURED_ERROR } from "@/auth/context";
import { useAuth } from "@/auth/useAuth";
import { buttonClasses } from "@/components/buttonStyles";
import { Button, ErrorMessage, Field, Input, Notice, Spinner } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";

/** Shell shared by the sign-in and sign-up screens. */
function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        {/* The wordmark sits above the heading rather than in it: these screens
            are often a visitor's first, and the heading is the step they are on
            ("Welcome back"), not what they are signing in to. */}
        <Wordmark size="lg" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Return the user to wherever they were headed before being asked to sign in.
  const destination = (location.state as { from?: string } | null)?.from ?? "/";

  if (user) return <Navigate to={destination} replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await login(email.trim(), password);
      navigate(destination, { replace: true });
    } catch (caught) {
      // Credential errors are deliberately not distinguished from one another:
      // saying "no such account" tells an attacker which emails are registered.
      setError(
        errorMessage(caught, "That email and password combination was not recognized."),
      );
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
 * Prelude's verdict on a password, checked on blur.
 *
 * On blur rather than on every keystroke because the rules live in Prelude, so
 * each check is a network round trip. Shared by sign-up and password reset: both
 * ask for a new password, and a rule either screen judged by itself would be the
 * one the server then disagrees with.
 */
function usePasswordHints() {
  const { validatePassword } = useAuth();
  const [hints, setHints] = useState<string[]>([]);

  const check = async (password: string) => {
    if (!password) return;
    const { messages } = await validatePassword(password);
    setHints(messages);
  };

  return { hints, check };
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
 * The rest between one emailed code and the next.
 *
 * Owned here rather than by each screen that sends codes, so the wait cannot
 * drift between them — and because a countdown is the same job wherever it is
 * shown.
 */
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
  const { user, register } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const passwordHints = usePasswordHints();

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    setSubmitting(true);

    try {
      await register({ email: email.trim(), password, displayName });
      // Straight to the code screen rather than home: the account is signed in
      // but unverified, so the gate would bounce it here anyway — one flash
      // later, and from a page that cannot load anything it asks for.
      navigate("/verify-email", { replace: true });
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
 * Whether a thrown value is Prelude's "that code was wrong".
 *
 * Matched by name rather than by class so this page keeps no import from the
 * SDK — the session lives behind the auth context, which is what lets the tests
 * run without it.
 */
function isBadCode(caught: unknown): boolean {
  return caught instanceof Error && caught.name === "BadCheckCodeError";
}

/**
 * Whether a thrown value is "this build has no OTP login configuration".
 *
 * Matched the same way and for the same reason as a bad code: `errorMessage`
 * carries through only our API's own messages, so without this the one failure
 * an operator can actually fix would read as the authentication service being
 * down.
 */
function isUnconfigured(caught: unknown): boolean {
  return caught instanceof Error && caught.name === RESET_UNCONFIGURED_ERROR;
}

/**
 * Whether Prelude rejected the password itself rather than the request.
 *
 * `changePassword` goes from the browser straight to Prelude, so nothing it
 * throws is one of our API's errors and `errorMessage` renders its fallback for
 * every case — the reason has to be recovered some other way.
 */
function isInvalidPassword(caught: unknown): boolean {
  return caught instanceof Error && caught.name === "InvalidPasswordError";
}

/**
 * Whether the permission to write a password has run out.
 *
 * `prld:pwd:write` is granted for five minutes, so a visitor who takes longer
 * than that over the form is refused with nothing whatsoever wrong with the
 * password they chose. Unnamed, it reads as "try another" — advice that no
 * password can satisfy, offered indefinitely.
 */
function isExpiredGrant(caught: unknown): boolean {
  return caught instanceof Error && caught.name === "ForbiddenError";
}

/**
 * The emailed-code field, shared by the two screens that ask for one.
 *
 * Both want the same numeric keypad, the same one-time-code autofill, the same
 * letter spacing and the same digit-stripping, and had drifted into verbatim
 * copies of all four. Only the label differs: the code means a different thing
 * on each screen.
 */
function CodeField({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (code: string) => void;
}) {
  return (
    <Field label={label} htmlFor="code" error={error}>
      <Input
        id="code"
        // A numeric keypad on a phone, and the code offered from the
        // notification the mail app just raised.
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        required
        className="text-center text-lg tracking-[0.4em]"
        value={value}
        // Anything that is not a digit cannot be part of a code, and stripping
        // it here means a pasted "Code: 123456" still works — which is also why
        // no caller trims what this produces.
        onChange={(event) =>
          onChange(event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))
        }
        aria-describedby={error ? "code-error" : undefined}
      />
    </Field>
  );
}

/** Which of the reset's four steps is on screen. */
type ResetStep = "email" | "code" | "password" | "done";

/**
 * Resets a forgotten password.
 *
 * The emailed code is a *login*, not a token this screen checks: Prelude opens
 * step-up challenges only on sessions that already exist, so proving the mailbox
 * is what produces the session, and a step-up on that session is what permits
 * the password write. The visitor is therefore signed in from the moment the
 * code is accepted, which is the trap this page has to be read with in mind —
 * see the note above the render.
 */
export function ForgotPasswordPage() {
  const {
    startPasswordReset,
    resendPasswordResetCode,
    confirmPasswordResetCode,
    changePassword,
    signOutOtherDevices,
  } = useAuth();

  const [step, setStep] = useState<ResetStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [othersSignedOut, setOthersSignedOut] = useState(false);
  const passwordHints = usePasswordHints();
  const { cooldown, startCooldown } = useResendCooldown();

  // Clears what the previous attempt said, so a second submission is not judged
  // against the first one's error.
  const resetFeedback = () => {
    setError("");
    setNotice("");
  };

  // Back to the first step with nothing carried over but the address, which is
  // the one thing worth retyping less. Reachable from both middle steps: the
  // code expires, and so does the permission the code buys, so either can go
  // stale while the visitor is looking at it — and the steps are state rather
  // than routes, so the browser's back button is not an exit from them.
  const startOver = () => {
    resetFeedback();
    setCode("");
    setPassword("");
    setStep("email");
  };

  const onSubmitEmail = async (event: FormEvent) => {
    event.preventDefault();
    resetFeedback();
    setSubmitting(true);

    try {
      await startPasswordReset(email.trim());
      // On to the code form whatever the address was. Prelude answers a dispatch
      // for an address it does not know with the same silent success, and
      // branching on anything here — a message, a different screen, a delay —
      // would answer the one question this flow must not: which addresses have
      // accounts. The code simply never arrives for the others.
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

  const onSubmitCode = async (event: FormEvent) => {
    event.preventDefault();
    resetFeedback();
    setSubmitting(true);

    try {
      await confirmPasswordResetCode(code);
      setStep("password");
    } catch (caught) {
      // One message for every failure, deliberately — the same choice the
      // sign-in screen makes about credentials, and for the same reason. An
      // address with no account gets a code form and no code, so this step is
      // where its attempt fails; distinguishing "wrong code" from anything else
      // here would answer whether the address is registered, having taken care
      // not to a step earlier. Uniform by construction rather than by matching
      // Prelude's error names, which would leak the moment one of them differed
      // for an unknown account.
      //
      // The cost is that a real fault — a step-up configuration that no longer
      // grants outright, a Prelude outage — also reads as a wrong code, so the
      // cause goes to the console for whoever has to find it. Nothing here is
      // recoverable by the visitor beyond asking for another code, which the
      // screen already offers.
      console.error("Password reset code could not be checked:", caught);
      setError("That code is not correct, or it has expired. Ask for another and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Uniform in both directions, exactly like the code step and for the same
  // reason: only an address with an account has a dispatch to retry, so an error
  // here — or a cooldown that did not start, or a field that was not cleared —
  // would answer the question the email step took care not to. Every observable
  // is therefore the same whichever way this goes, and the cause goes to the
  // console. The cost is the same one the code step pays: a genuine fault reads
  // as a code on its way that never arrives.
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
      setNotice("A new code is on its way. Use the one in the most recent email.");
      setResending(false);
    }
  };

  const onSubmitPassword = async (event: FormEvent) => {
    event.preventDefault();
    resetFeedback();
    setSubmitting(true);

    try {
      await changePassword(password);
      setStep("done");
    } catch (caught) {
      // Nothing here arrives from our API, so errorMessage would render its
      // fallback for every case — and by this step the visitor is signed in, so
      // naming a cause gives nothing away. Two are worth naming: a grant that
      // expired while they chose (nothing wrong with the password, and no
      // password will do), and a password Prelude refused, whose reasons the
      // compliancy check already renders as prose for the field's own hints.
      console.error("The new password could not be saved:", caught);
      if (isExpiredGrant(caught)) {
        setError("This reset has expired. Ask for a new code and start again.");
      } else if (isInvalidPassword(caught)) {
        setError("That password does not meet the requirements.");
        await passwordHints.check(password);
      } else {
        setError(errorMessage(caught, "That password could not be saved. Please try another."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Offered after the change rather than as a checkbox before it: this is the
  // point where the choice can be acted on and its outcome reported, and a
  // failure here must not read as a password that did not save — it did.
  const onSignOutOthers = async () => {
    resetFeedback();
    setSubmitting(true);

    try {
      await signOutOtherDevices();
      setOthersSignedOut(true);
    } catch (caught) {
      setError(
        errorMessage(caught, "Your password was changed, but other devices could not be signed out."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Deliberately no redirect for a signed-in visitor, unlike the sign-in and
  // sign-up screens. The accepted code *is* a login, so from the password step
  // onwards this page is being used by a signed-in user: sending them home on
  // that basis would eject them one step short of the new password, leaving the
  // account on the old one with a session opened by an emailed code.

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

  if (step === "password") {
    return (
      <AuthShell title="Choose a new password" subtitle="This replaces the one you forgot">
        <form onSubmit={onSubmitPassword} className="space-y-4" noValidate>
          {error && <ErrorMessage>{error}</ErrorMessage>}

          <Field label="New password" htmlFor="new-password">
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              autoFocus
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onBlur={() => passwordHints.check(password)}
            />
          </Field>

          <PasswordHints hints={passwordHints.hints} />

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
      {error && <ErrorMessage>{error}</ErrorMessage>}

      <div className="space-y-4">
        {othersSignedOut ? (
          <Notice>Your other devices have been signed out.</Notice>
        ) : (
          <>
            <p className="text-sm text-stone-500 dark:text-stone-400">
              If you were signed in somewhere else, you can end those sessions now.
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
        )}

        {/* A Link borrowing the button chrome, not a Button inside a Link: an
            anchor wrapping a button is invalid and loses keyboard handling. */}
        <Link to="/" className={buttonClasses("primary", "lg", "w-full")}>
          Continue to Songfolio
        </Link>
      </div>
    </AuthShell>
  );
}

/**
 * Confirms a new account's email address.
 *
 * Every signed-in but unverified visitor is routed here, whatever they asked
 * for, because the API answers them with a 403 everywhere else. Sign-out is on
 * the page for the one case that has no other exit: an address typed wrong,
 * whose code can never arrive.
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

  // The code is sent when this screen opens, not at registration: the challenge
  // belongs to the browser's session with Prelude, so there is nobody to open
  // it before the user gets here. The ref guards the double invocation React
  // makes in development, which would otherwise open a second challenge and
  // retire the code from the first.
  useEffect(() => {
    // Hooks run before the redirects below are rendered, so without this guard
    // a visitor who is already verified — or not signed in at all — would open
    // a challenge and be emailed a code on their way somewhere else.
    if (!user || user.email_verified_at) return;
    if (started.current) return;
    started.current = true;

    let cancelled = false;
    (async () => {
      try {
        await startEmailVerification();
      } catch (caught) {
        // Let it be attempted again: the error below tells the user to ask for
        // another code, and without this the guard would refuse to open one.
        started.current = false;
        if (!cancelled) {
          setError(
            errorMessage(caught, "We could not send a code just now. Try asking for another."),
          );
        }
      } finally {
        if (!cancelled) setSending(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [startEmailVerification, user]);

  // Unlike the other two screens, this one is reached by redirect and kept in
  // the address bar, so a refresh lands here while the session is still being
  // restored. Waiting for that is what stops a reload from reading as signed
  // out and bouncing to the login page.
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.email_verified_at) return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    setNotice("");
    setSubmitting(true);

    try {
      await verifyEmail(code);
      navigate("/", { replace: true });
    } catch (caught) {
      // Prelude checks the code, so a wrong one arrives as one of its typed SDK
      // errors rather than as a response from our API. Naming that case is what
      // keeps the common mistake — a mistyped digit — from being reported as
      // something the user cannot act on.
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
      setNotice("A new code is on its way. Use the one in the most recent email.");
    } catch (caught) {
      setError(errorMessage(caught, "We could not send a new code. Please try again shortly."));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthShell title="Check your email" subtitle={`We sent a ${CODE_LENGTH}-digit code to ${user.email}`}>
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
        <ResendCodeLink resending={resending} cooldown={cooldown} onResend={onResend} />
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
