import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { errorDetails, errorMessage } from "@/api/client";
import { useAuth } from "@/auth/useAuth";
import { Button, ErrorMessage, Field, Input, Spinner } from "@/components/ui";
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

export function RegisterPage() {
  const { user, register, validatePassword } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [passwordHints, setPasswordHints] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  // Checking on blur rather than on every keystroke: the rules live in
  // Prelude, so each check is a network round trip.
  const checkPassword = async () => {
    if (!password) return;
    const { messages } = await validatePassword(password);
    setPasswordHints(messages);
  };

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
            onBlur={checkPassword}
            aria-describedby={fieldErrors.password ? "password-error" : undefined}
          />
        </Field>

        {passwordHints.length > 0 && (
          <ul className="space-y-1 text-xs text-stone-500 dark:text-stone-400">
            {passwordHints.map((hint) => (
              <li key={hint}>• {hint}</li>
            ))}
          </ul>
        )}

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
/** How long the resend button rests, so a stuck user cannot mail-bomb themselves. */
const RESEND_COOLDOWN_SECONDS = 30;

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
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(true);
  const started = useRef(false);

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

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

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
      await verifyEmail(code.trim());
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
      setCooldown(RESEND_COOLDOWN_SECONDS);
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
        {notice && (
          <p role="status" className="text-sm text-stone-600 dark:text-stone-300">
            {notice}
          </p>
        )}

        <Field label="Verification code" htmlFor="code" error={fieldErrors.code}>
          <Input
            id="code"
            // A numeric keypad on a phone, and the code offered from the
            // notification the mail app just raised.
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            className="text-center text-lg tracking-[0.4em]"
            value={code}
            // Anything that is not a digit cannot be part of a code, and
            // stripping it here means a pasted "Code: 123456" still works.
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))
            }
            aria-describedby={fieldErrors.code ? "code-error" : undefined}
          />
        </Field>

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
