import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { errorDetails, errorMessage } from "@/api/client";
import { PASSWORD_CHANGE_UNAVAILABLE_ERROR, RESET_UNCONFIGURED_ERROR } from "@/auth/context";
import { returnDestination } from "@/auth/returnTo";
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

  // Wherever they were headed before being asked to sign in.
  const destination = returnDestination(location.state);

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
  // The last verdict *and* what it said. Clicking submit blurs the field, so a
  // refused password is asked about twice within a second — once on the way out
  // of the field and once because Prelude rejected it — and the second round trip
  // can only reproduce an answer already given. Remembering the password without
  // its reasons is worse than not remembering at all: the hints are cleared as
  // soon as any other password is judged, so returning to a refused one would
  // skip the check and show nothing, and the recovery on the refusal path would
  // be skipped too — a password refused with no reasons, for as long as it stays
  // in the field. Nothing is remembered from an empty verdict, because
  // validatePassword swallows a failed fetch into "valid, nothing to report" and
  // that must not be mistaken for a judgment.
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

  // Both screens abandon a password without leaving the field, and the hints
  // under it would otherwise still be describing it when the form comes back.
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
 * The sentences more than one code form says.
 *
 * Owned here for the same reason the cooldown above is: a screen that says the
 * same thing as another screen has to keep saying it, and an edit made one
 * screen at a time is how that stops being true. Each of these was already
 * written out two to four times. Wording that is deliberately per-screen — the
 * reset's one uniform code failure, its expired grant against the change
 * screen's — stays with its screen.
 */
const CODE_RESENT_NOTICE = "A new code is on its way. Use the one in the most recent email.";
const CODE_NOT_SENT = "We could not send a new code. Please try again shortly.";
const CODE_UNSENDABLE = "We could not send a code just now. Try asking for another.";
const PASSWORD_REJECTED = "That password does not meet the requirements.";
const PASSWORD_UNSAVED = "That password could not be saved. Please try another.";

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
 * Whether the password-change screen was refused before it could ask anything.
 *
 * The one failure on that screen an operator can fix rather than a visitor
 * retry: the step-up grants `prld:pwd:write` outright, so no code was sent and
 * nothing re-proves the account. Named for the same reason an unconfigured reset
 * is — `errorMessage` carries through only our API's own messages, so this would
 * otherwise read as Prelude being down.
 */
function isChangeUnavailable(caught: unknown): boolean {
  return caught instanceof Error && caught.name === PASSWORD_CHANGE_UNAVAILABLE_ERROR;
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

/**
 * The new-password field, shared by the two screens that ask for one.
 *
 * Same field, same autofill, same on-blur compliancy check, same hints below it
 * — the reset and the change screen had it written out twice, which is how the
 * four attributes `CodeField` exists to keep in step drift apart one screen at a
 * time. The label does not vary the way `CodeField`'s does: a new password is a
 * new password whichever screen asks.
 */
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
 * What to say when the code that permits a password write is refused.
 *
 * Both screens that ask for that code are past the point where anything can be
 * given away — the change screen is reached only by a signed-in account looking
 * at its own profile, and the reset's second code only after a correct first one
 * — so both may name a mistyped digit, and both must name it the same way. The
 * reset's *first* code step is the one that may not, and it does not use this.
 */
function writeCodeMessage(caught: unknown): string {
  return isBadCode(caught)
    ? "That code is not correct. Check it and try again."
    : "That code could not be checked. Ask for another and try again.";
}

/**
 * What to say when Prelude refused a new password, and whether the field's own
 * hints are worth refreshing.
 *
 * Both screens map the same three cases and only the expired sentence differs:
 * the reset's grant and the change screen's confirmation are the same 300
 * seconds, but there is a different thing to do about each. Returning the
 * hint decision rather than leaving the caller to re-test the error is what
 * keeps the reasons under the field in step with the message above it.
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
 * Offers to end the sessions that were open before the password changed.
 *
 * Both screens that change a password offer this, identically, and afterwards
 * rather than as a checkbox before: this is the point where the choice can be
 * acted on and its outcome reported, and a failure here must not read as a
 * password that did not save — it did, which is what makes this panel's own
 * error the right place for one.
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
        errorMessage(caught, "Your password was changed, but other devices could not be signed out."),
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
 * Which of the reset's steps is on screen.
 *
 * `confirm` is the second code: the step-up that permits the password write asks
 * for one, because the same configuration serves the signed-in change-password
 * screen and has to be strict there. Whether that step is visited at all is
 * Prelude's answer to `confirmPasswordResetCode` rather than this screen's
 * choice, so both routes through have to work.
 */
type ResetStep = "email" | "code" | "confirm" | "password" | "done";

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
    confirmPasswordWriteCode,
    resendPasswordWriteCode,
    changePassword,
  } = useAuth();

  const [step, setStep] = useState<ResetStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // The second code gets its own state rather than reusing the first field's:
  // they answer different challenges, and sharing would carry a spent code into
  // the form for the next one — where it reads as a code that stopped working.
  const [confirmCode, setConfirmCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
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
    setConfirmCode("");
    setPassword("");
    // Hints for the password being abandoned, which would otherwise still be
    // under the field on the way back through.
    passwordHints.clear();
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
      const { secondCodeSent } = await confirmPasswordResetCode(code);
      // Prelude decides which of these the visitor sees. A second code means the
      // step-up asked to prove the mailbox again — the price of one
      // configuration serving the signed-in change-password screen too — and a
      // grant with no code means the one just entered was proof enough.
      if (secondCodeSent) {
        // That code was sent a moment ago, so the next step's rest starts here.
        // The cooldown is one countdown for the whole screen, and without this
        // the second step inherits whatever is left of the first step's — a
        // "Send another" resting for reasons that belong to a different code, or
        // available for a code that has only just gone out.
        startCooldown();
      }
      setStep(secondCodeSent ? "confirm" : "password");
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
      setNotice(CODE_RESENT_NOTICE);
      setResending(false);
    }
  };

  const onSubmitConfirmCode = async (event: FormEvent) => {
    event.preventDefault();
    resetFeedback();
    setSubmitting(true);

    try {
      await confirmPasswordWriteCode(confirmCode);
      setStep("password");
    } catch (caught) {
      // Nothing to keep uniform here, unlike the step before it: only an address
      // with an account could have reached this form, so naming the common
      // mistake gives nothing away and saves a visitor guessing at which of
      // their two codes is being refused.
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
      // naming a cause gives nothing away. The expired grant is the one case
      // worth wording per screen: nothing is wrong with the password, and no
      // password will do, so what it says is where to go instead.
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

  if (step === "confirm") {
    return (
      <AuthShell
        title="One more code"
        subtitle={`We sent a second code to ${email.trim()}`}
      >
        <form onSubmit={onSubmitConfirmCode} className="space-y-4" noValidate>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          {notice && <Notice>{notice}</Notice>}

          {/* Said out loud, because a second code for the same mailbox otherwise
              reads as the first one having quietly failed. */}
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Setting a new password needs one more check of your email. This is the
            last step before you choose it.
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

    // No cancellation flag, deliberately, and this is the one place the ref above
    // makes one dangerous. React runs this effect, its cleanup, and the effect
    // again on a single mounted component — the double invocation the ref is here
    // to survive — so a flag set by that cleanup would discard the result of the
    // run that actually opened the challenge, while the second run reuses it and
    // returns early. Nothing would then clear "Sending code…" or report a
    // failure: a button spinning for good, in development only. Landing the
    // state instead costs nothing, a state update after a real unmount being a
    // no-op in React 18 and later.
    (async () => {
      try {
        await startEmailVerification();
      } catch (caught) {
        // Let it be attempted again: the error below tells the user to ask for
        // another code, and without this the guard would refuse to open one.
        started.current = false;
        setError(errorMessage(caught, CODE_UNSENDABLE));
      } finally {
        setSending(false);
      }
    })();
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
      setNotice(CODE_RESENT_NOTICE);
    } catch (caught) {
      setError(errorMessage(caught, CODE_NOT_SENT));
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
        {/* `sending` counts as resending: the code this screen sends on open is
            still in flight, and a click here would find no challenge open yet
            and start a second step-up — retiring the challenge the first one is
            about to report, so that two codes are emailed and neither works. */}
        <ResendCodeLink
          resending={resending || sending}
          cooldown={cooldown}
          onResend={onResend}
        />
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

/**
 * Which of the change-password steps is on screen.
 *
 * `unavailable` is a step rather than a flag beside one: as a boolean its branch
 * silently outranked every step below it, which is precedence a reader has to
 * notice instead of read.
 */
type ChangeStep = "code" | "password" | "done" | "unavailable";

/**
 * Changes the password of a signed-in user.
 *
 * The proof is an emailed code, and it is the only proof there could be. Prelude
 * grants `prld:pwd:write` on a step-up, and this screen has nothing to step up
 * *with* except the session that asked — which is exactly what a stolen session
 * is. A "current password" field would not close that: nothing in the browser
 * can check one, and Prelude's password step-up has no step that does, so the
 * field would be a gate an attacker skips by calling the SDK directly. The
 * scope's configuration is what enforces this, which is why the screen refuses
 * outright when Prelude answers with no challenge to run.
 *
 * Reached only from the profile, and deliberately outside the app's shell: the
 * steps are state rather than routes, so navigating away is the flow lost
 * part-way through, and there is no reason to offer that beside it. Both exits
 * are therefore explicit.
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

  // The code is sent when this screen opens, like the verification screen and
  // for the same reason: the challenge belongs to the browser's session with
  // Prelude, so there is nobody to open it before the visitor gets here. The ref
  // guards the double invocation React makes in development, which would
  // otherwise open a second challenge and retire the code from the first.
  useEffect(() => {
    // Hooks run before the redirect below them is rendered, so without this a
    // visitor whose session has ended opens a challenge on their way to the
    // sign-in screen — and is emailed a code for a flow they cannot be in.
    if (!user) return;
    if (started.current) return;
    started.current = true;

    // No cancellation flag, for the reason spelled out on the verification
    // screen's copy of this effect: the cleanup React runs between the two
    // invocations would otherwise throw away the result of the run that opened
    // the challenge, and leave this screen sending a code for ever.
    (async () => {
      try {
        await startPasswordChange();
      } catch (caught) {
        // Let it be attempted again: the message tells the visitor to ask for
        // another code, and the guard above would otherwise refuse to open one.
        started.current = false;
        if (isChangeUnavailable(caught)) {
          // Not a fault to retry, and not one the visitor can fix. Saying so
          // beats a code form waiting for a code that is never coming.
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

  // Reached from the profile, which RequireAuth has gated already — this covers
  // the session ending while the screen is open, which would otherwise leave a
  // password form behind that can only fail.
  if (!user) return <Navigate to="/login" replace />;

  const onSubmitCode = async (event: FormEvent) => {
    event.preventDefault();
    resetFeedback();
    setSubmitting(true);

    try {
      await confirmPasswordWriteCode(code);
      setStep("password");
    } catch (caught) {
      // The visitor is signed in to the account they are changing, so there is
      // nothing to keep uniform the way the reset's code step has to: naming a
      // mistyped digit is simply the useful thing to say.
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
      // The same refusal the screen can open with, reachable here because a
      // fresh challenge is what this asks for when the last one cannot be
      // retried — so the configuration is read again, and can have changed.
      // Reported as a failed send it would send whoever reads it hunting an
      // outage.
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

  // The permission a code buys lasts five minutes and the password form can
  // outlive it, so there has to be a way back to a fresh one — the steps are
  // state, not routes, so the back button is not that way. The challenge that
  // got here is spent, which is why this asks for another code rather than
  // returning to a form that nothing would satisfy.
  const startAgain = async () => {
    setPassword("");
    // The hints are about the password being abandoned; left alone they are
    // still under the field when this form comes back.
    passwordHints.clear();
    setStep("code");
    await onResend();
  };

  const onSubmitPassword = async (event: FormEvent) => {
    event.preventDefault();
    resetFeedback();
    setSubmitting(true);

    try {
      await changePassword(password);
      setStep("done");
    } catch (caught) {
      // Same three cases as the reset's password step, and the same reasoning
      // behind naming them; only the expired sentence is this screen's own,
      // because the way back to a code is not the same one.
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
          {/* A genuine way through rather than a consolation: the reset proves
              the same mailbox this screen wanted proven, by the same code. */}
          <p className="text-sm text-stone-500 dark:text-stone-400">
            You can still set a new password by resetting it, which emails you a
            code to confirm it is you.
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
          {/* Held while the first code is still in flight, for the reason given
              on the verification screen: a click then opens a second step-up and
              retires the challenge the first one is about to report. */}
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
          {/* Disabled while it works, because it asks for a code without a
              cooldown to hide behind: a second press before the first returns is
              a second code, and the rest that stops a stuck visitor mailing
              themselves has not started yet. */}
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
    <AuthShell
      title="Password changed"
      subtitle="Your new password is the one to use from now on"
    >
      <div className="space-y-4">
        <SignOutOthersPanel />

        <Link to="/profile" className={buttonClasses("primary", "lg", "w-full")}>
          Back to profile
        </Link>
      </div>
    </AuthShell>
  );
}
