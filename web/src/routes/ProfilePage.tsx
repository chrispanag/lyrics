import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { KeyRound, LogOut, Moon, Sun } from "lucide-react";

import { errorDetails, errorMessage } from "@/api/client";
import { useRemoveAvatar, useUpdateProfile, useUploadAvatar } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { Avatar } from "@/components/Avatar";
import { Button, ErrorMessage, Field, Input, Spinner } from "@/components/ui";
import { buttonClasses } from "@/components/buttonStyles";
import { PageTitle } from "@/components/PageTitle";
import { cn } from "@/lib/cn";
import {
  IMAGE_TOO_LARGE_ERROR,
  IMAGE_UNREADABLE_ERROR,
  MAX_SOURCE_MB,
  toSquareJpeg,
} from "@/lib/image";
import { applyTheme, storeTheme, storedTheme, type Theme } from "@/lib/theme";

const THEME_OPTIONS: { value: Theme; label: string; icon?: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System" },
];

export function ProfilePage() {
  const { user, loading, logout, reload } = useAuth();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const removeAvatar = useRemoveAvatar();

  const savedName = user?.display_name ?? "";
  const [displayName, setDisplayName] = useState(savedName);
  const [syncedName, setSyncedName] = useState(savedName);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [pictureError, setPictureError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [theme, setTheme] = useState<Theme>(storedTheme);

  // Adjusted while rendering, and keyed on the stored name rather than on the
  // user object. Every write to the auth context replaces that object — a new
  // picture, a removed one — and an effect watching it reset this field each
  // time, throwing away a display name the reader had typed and not yet saved.
  // The stored name actually changing is the one case that should win.
  if (savedName !== syncedName) {
    setSyncedName(savedName);
    setDisplayName(savedName);
  }

  // Applying the theme is the button's side effect, not a consequence of state
  // changing. As an effect it also re-ran on mount, redoing the matchMedia query
  // and localStorage write that main.tsx already performed before first paint.
  const selectTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
    storeTheme(next);
  };

  // The title is repeated across all three branches rather than hoisted, which
  // is a trade rather than a necessity: collapsing the branches into one
  // insertion point means lifting three unrelated layouts into a variable and
  // moving `onSubmit` above the guard it sits below. Three copies of a
  // five-word line is the cheaper side of that.
  //
  // What is not optional is having one on each. React unmounts the hoisted
  // title with the branch that rendered it, so a branch without one does not
  // inherit the previous page's name — it falls back to the static title in
  // index.html, and the tab reads a bare "Songfolio" for as long as that state
  // lasts. On the guest branch that is until they sign in.
  if (loading)
    return (
      <>
        <PageTitle name="Profile" />
        <Spinner />
      </>
    );

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 text-center">
        <PageTitle name="Profile" />
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
    setError("");
    try {
      // The PATCH responds with the updated user, so handing it straight to the
      // context saves a GET /me for a record we are already holding.
      const updated = await updateProfile.mutateAsync({
        display_name: displayName.trim() || null,
      });
      await reload(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (caught) {
      // Without this the rejection is unhandled and the button simply returns
      // to "Save changes", leaving no way to tell a failed save from a
      // successful one.
      setError(errorMessage(caught, "Your profile could not be saved."));
    }
  };

  const onPickPicture = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared straight away, because a change event needs the value to differ:
    // after a failed upload the file worth retrying is usually the same one,
    // and left in place picking it again would do nothing at all.
    event.target.value = "";
    if (!file) return;

    setPictureError("");
    // Set before the canvas work rather than only around the request:
    // preparing a 12MP photo is the slow half, on the device where it is
    // slowest, and left out of the pending state the control reads "Add
    // picture" throughout — so a second pick starts a second decode and a
    // second upload, and two reloads land in whatever order they finish.
    setPreparing(true);
    try {
      // Cropped and shrunk here, which is what keeps a phone photo under the
      // API's 1 MB cap. The server re-encodes it regardless.
      const updated = await uploadAvatar.mutateAsync(await toSquareJpeg(file));
      await reload(updated);
    } catch (caught) {
      setPictureError(pictureFailure(caught));
    } finally {
      setPreparing(false);
    }
  };

  const busy = preparing || uploadAvatar.isPending || removeAvatar.isPending;

  const onRemovePicture = async () => {
    setPictureError("");
    try {
      await reload(await removeAvatar.mutateAsync());
    } catch (caught) {
      setPictureError(errorMessage(caught, "Your picture could not be removed."));
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <PageTitle name="Profile" />
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Profile</h1>

      <div className="mb-6 flex items-center gap-4">
        <Avatar user={user} size="lg" />
        <div className="min-w-0 space-y-1">
          {/* A label around a visually hidden input, rather than a button that
              clicks one: this way the control is a real file picker to a
              keyboard and a screen reader, and `sr-only` keeps the input
              focusable where `hidden` would not. */}
          <label
            className={cn(
              buttonClasses("secondary", "md"),
              // The ring belongs to the label because the input it wraps is
              // `sr-only`: the browser draws focus on a 1px clipped box, so a
              // keyboard user got no visible focus here while every other
              // control on the page — a real button — shows one. The disabled
              // pair is conditional for the same reason, since a `disabled:`
              // variant can never match a label.
              "cursor-pointer focus-within:ring-2 focus-within:outline-none",
              busy && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={busy}
              onChange={(event) => void onPickPicture(event)}
            />
            {busy ? "Working…" : user.avatar_updated_at ? "Change picture" : "Add picture"}
          </label>
          {user.avatar_updated_at && (
            <Button
              variant="ghost"
              className="w-full"
              loading={removeAvatar.isPending}
              onClick={() => void onRemovePicture()}
            >
              Remove picture
            </Button>
          )}
        </div>
      </div>

      {pictureError && (
        <div className="mb-6">
          <ErrorMessage>{pictureError}</ErrorMessage>
        </div>
      )}

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
        {error && <ErrorMessage>{error}</ErrorMessage>}
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

      <div className="mt-8">
        <SectionHeading>Security</SectionHeading>
        {/* A link rather than a form on this page: changing a password takes an
            emailed code first, which is a flow of its own and not something to
            begin by accident beside the display name. */}
        <Link to="/change-password" className={buttonClasses("secondary", "lg", "w-full")}>
          <KeyRound aria-hidden className="size-4" />
          Change password
        </Link>
      </div>

      <ThemeToggle theme={theme} onChange={selectTheme} className="mt-8" />

      <Button variant="ghost" className="mt-8 w-full" onClick={() => void logout()}>
        <LogOut aria-hidden className="size-4" />
        Sign out
      </Button>
    </div>
  );
}

/**
 * The label above a group of settings, shared so the two groups cannot drift
 * apart — `cn()` is a plain join, so chrome is shared rather than overridden.
 */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">{children}</h2>
  );
}

/**
 * What to say when a picture does not get stored.
 *
 * The failures worth distinguishing happen on either side of the request. One
 * is the API's, and carries its own sentence. The other never leaves the
 * browser — an image it has no decoder for, a file far too big to decode — and
 * carries none, so `errorMessage` would render the fallback and send whoever
 * read it looking for a server fault. That one is matched by name, the way the
 * auth screens match Prelude's.
 */
function pictureFailure(caught: unknown): string {
  // Two names, because one message cannot serve both: a photo refused on size
  // was perfectly readable, and telling whoever chose it to try a JPEG is
  // advice their JPEG already satisfied.
  if (caught instanceof Error && caught.name === IMAGE_TOO_LARGE_ERROR) {
    return `That photo is too large to prepare. Use one under ${MAX_SOURCE_MB} MB.`;
  }
  if (caught instanceof Error && caught.name === IMAGE_UNREADABLE_ERROR) {
    return "That image could not be read. Try a JPEG or PNG photo.";
  }

  const message = errorMessage(caught, "Your picture could not be saved.");
  // The API's message says what went wrong and its `image` detail says what to
  // do about it — the size and dimension limits. There is no field here to hang
  // a field-level detail on, the way a form would, so the two are read as one
  // sentence rather than the half that is actionable being dropped.
  const detail = errorDetails(caught).image;
  return detail ? `${message} ${detail}` : message;
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
      <SectionHeading>Appearance</SectionHeading>
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

