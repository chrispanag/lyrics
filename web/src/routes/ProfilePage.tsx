import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { LogOut, Moon, Sun } from "lucide-react";

import { useUpdateProfile } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { Button, Field, Input, Spinner } from "@/components/ui";
import { buttonClasses } from "@/components/buttonStyles";
import { cn } from "@/lib/cn";
import { applyTheme, storeTheme, storedTheme, type Theme } from "@/lib/theme";

const THEME_OPTIONS: { value: Theme; label: string; icon?: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System" },
];

export function ProfilePage() {
  const { user, loading, logout, reload } = useAuth();
  const updateProfile = useUpdateProfile();

  const [displayName, setDisplayName] = useState("");
  const [saved, setSaved] = useState(false);
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    setDisplayName(user?.display_name ?? "");
  }, [user]);

  // Applying the theme is the button's side effect, not a consequence of state
  // changing. As an effect it also re-ran on mount, redoing the matchMedia query
  // and localStorage write that main.tsx already performed before first paint.
  const selectTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
    storeTheme(next);
  };

  if (loading) return <Spinner />;

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 text-center">
        <h1 className="text-2xl font-bold tracking-tight">You are browsing as a guest</h1>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          Sign in to build lists of songs.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link
            to="/login"
            className={buttonClasses("primary", "lg")}
          >
            Sign in
          </Link>
          <Link
            to="/register"
            className={buttonClasses("secondary", "lg")}
          >
            Create an account
          </Link>
        </div>

        <ThemeToggle theme={theme} onChange={selectTheme} className="mt-10" />
      </div>
    );
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    // The PATCH responds with the updated user, so handing it straight to the
    // context saves a GET /me for a record we are already holding.
    const saved = await updateProfile.mutateAsync({ display_name: displayName.trim() || null });
    await reload(saved);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Profile</h1>

      <dl className="mb-6 space-y-2 rounded-2xl bg-stone-100 p-4 text-sm dark:bg-stone-900">
        <div className="flex justify-between gap-3">
          <dt className="text-stone-500 dark:text-stone-400">Email</dt>
          <dd className="truncate font-medium">{user.email}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-stone-500 dark:text-stone-400">Role</dt>
          <dd className="font-medium capitalize">{user.role}</dd>
        </div>
      </dl>

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Display name" htmlFor="display-name" hint="Shown instead of your email">
          <Input
            id="display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
        <Button type="submit" loading={updateProfile.isPending}>
          {saved ? "Saved" : "Save changes"}
        </Button>
      </form>

      <ThemeToggle theme={theme} onChange={selectTheme} className="mt-8" />

      <Button variant="ghost" className="mt-8 w-full" onClick={() => void logout()}>
        <LogOut aria-hidden className="size-4" />
        Sign out
      </Button>
    </div>
  );
}

function ThemeToggle({
  theme,
  onChange,
  className,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <h2 className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">Appearance</h2>
      <div
        role="radiogroup"
        aria-label="Appearance"
        className="flex gap-1 rounded-xl bg-stone-200 p-1 dark:bg-stone-800"
      >
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={theme === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors",
              theme === option.value
                ? "bg-white text-stone-900 shadow-sm dark:bg-stone-950 dark:text-stone-100"
                : "text-stone-600 dark:text-stone-400",
            )}
          >
            {option.icon && <option.icon aria-hidden className="size-4" />}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

