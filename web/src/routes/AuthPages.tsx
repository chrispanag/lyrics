import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Disc3 } from "lucide-react";

import { errorDetails, errorMessage } from "@/api/client";
import { useAuth } from "@/auth/useAuth";
import { Button, ErrorMessage, Field, Input } from "@/components/ui";

/** Shell shared by the sign-in and sign-up screens. */
function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <Disc3 aria-hidden className="mx-auto size-10 text-brand-600" />
        <h1 className="mt-3 text-2xl font-bold tracking-tight">{title}</h1>
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
      navigate("/", { replace: true });
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
