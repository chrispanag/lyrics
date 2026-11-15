import { useState, type ChangeEvent, type SubmitEvent } from "react";
import { Link } from "react-router-dom";
import { KeyRound, LoaderCircle, LogOut, Moon, Pencil, Sun, Trash, Upload } from "lucide-react";

import { errorDetails, errorMessage } from "@/api/client";
import { useRemoveAvatar, useUpdateProfile, useUploadAvatar } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { Avatar } from "@/components/Avatar";
import { Button, ErrorMessage, Field, Input, Sheet, Spinner } from "@/components/ui";
import { buttonClasses } from "@/components/buttonStyles";
import { PageTitle } from "@/components/PageTitle";
import type { Identity } from "@/lib/avatar";
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
  const [pictureMenu, setPictureMenu] = useState(false);
  const [theme, setTheme] = useState<Theme>(storedTheme);

  // Keyed on the stored name, not the user object: every auth-context write
  // (e.g. a new picture) replaces the object and would discard a typed name.
  if (savedName !== syncedName) {
    setSyncedName(savedName);
    setDisplayName(savedName);
  }

  // An event handler, not an effect: app/layout.tsx's script already applied
  // the stored theme before first paint.
  const selectTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
    storeTheme(next);
  };

  // Every branch needs its own PageTitle: the hoisted title unmounts with the
  // branch, and a branch without one leaves the tab showing the URL.
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
        <p className="mt-2 text-sm text-fg-muted">Sign in to build lists of songs.</p>
        <div className="mt-6 flex flex-col gap-2">
          <Link to="/login" className={buttonClasses("primary", "lg")}>
            Sign in
          </Link>
          <Link to="/register" className={buttonClasses("secondary", "lg")}>
            Create an account
          </Link>
        </div>

        <ThemeToggle theme={theme} onChange={selectTheme} className="mt-10" />
      </div>
    );
  }

  const onSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      // The PATCH returns the updated user, saving a GET /me.
      const updated = await updateProfile.mutateAsync({
        display_name: displayName.trim() || null,
      });
      await reload(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (caught) {
      setError(errorMessage(caught, "Your profile could not be saved."));
    }
  };

  const onPickPicture = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Lets the same file be picked again; closing the sheet also empties it.
    event.target.value = "";
    setPictureMenu(false);
    if (!file) return;

    setPictureError("");
    // Set before the canvas work, the slow half, so a second pick is refused.
    setPreparing(true);
    try {
      // Shrunk here to stay under the API's upload cap; the server re-encodes.
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
    setPictureMenu(false);
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

      <div className="mb-6">
        <PictureButton user={user} busy={busy} onClick={() => setPictureMenu(true)} />
        {/* Announces the wait the aria-hidden badge spinner shows. Always
            rendered: a live region must exist before its text changes. */}
        <span role="status" className="sr-only">
          {busy ? busyMessage(removeAvatar.isPending) : ""}
        </span>
      </div>

      <PictureMenu
        open={pictureMenu}
        onClose={() => setPictureMenu(false)}
        hasPicture={Boolean(user.avatar_updated_at)}
        busy={busy}
        onPick={(event) => void onPickPicture(event)}
        onRemove={() => void onRemovePicture()}
      />

      {pictureError && (
        <div className="mb-6">
          <ErrorMessage>{pictureError}</ErrorMessage>
        </div>
      )}

      <dl className="mb-6 space-y-2 rounded-2xl bg-panel p-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-fg-tertiary">Email</dt>
          <dd className="truncate font-medium">{user.email}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-fg-tertiary">Role</dt>
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
        {/* A link: changing a password is its own emailed-code flow. */}
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
 * The picture, and the one control that changes it. The whole circle is the
 * button, since the badge alone is under the 44px touch floor. Busy is drawn
 * here because the sheet has closed by then.
 */
function PictureButton({
  user,
  busy,
  onClick,
}: {
  user: Identity;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Not `disabled` while busy: closing the sheet returns focus here, which a
      // disabled element cannot take. The sheet refuses its own controls instead.
      aria-busy={busy}
      aria-label="Edit picture"
      className={
        // `group`: the badge lights on hover anywhere over the circle.
        // `inline-flex`: `inline-block` leaves a descender gap under the picture.
        // No focus classes: index.css's global `:focus-visible` outline applies.
        "group relative inline-flex cursor-pointer rounded-full"
      }
    >
      <Avatar user={user} size="lg" className={busy ? "opacity-50" : undefined} />
      <span
        // Decorative: the button carries the name.
        aria-hidden
        className={cn(
          // Straddles the perimeter: inside it covers the face.
          "absolute -right-0.5 -bottom-0.5 flex size-8 items-center justify-center rounded-full",
          // The ring is the body's ground color, so it reads as a bite out of the circle.
          "bg-accent text-white ring-2 ring-canvas transition-colors",
          !busy && "group-hover:bg-accent-hover group-active:bg-accent-active",
        )}
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Pencil className="size-3.5" />}
      </span>
    </button>
  );
}

/**
 * Change or remove the picture. A `Sheet`, so it gets Escape and an inert page
 * behind it. Both actions close it as they start, so failures show on
 * the page; while busy it disables its own controls, since the trigger does not.
 */
function PictureMenu({
  open,
  onClose,
  hasPicture,
  busy,
  onPick,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  hasPicture: boolean;
  busy: boolean;
  onPick: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Profile picture">
      <div className="space-y-2">
        {/* A label around an `sr-only` input, so it stays a focusable file picker. */}
        <label
          className={cn(
            buttonClasses("secondary", "lg", "w-full"),
            // Focus and disabled styles live on the label: the `sr-only` input
            // shows no focus, and `disabled:` cannot match a label.
            "cursor-pointer focus-within:ring-2 focus-within:outline-hidden",
            busy && "cursor-not-allowed opacity-60",
          )}
        >
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={onPick}
          />
          <Upload aria-hidden className="size-4" />
          {busy ? "Working…" : hasPicture ? "Change picture" : "Add picture"}
        </label>
        {hasPicture && (
          // Ghost, with no color override: `cn` is a plain join, so one would lose.
          <Button variant="ghost" className="w-full" disabled={busy} onClick={onRemove}>
            <Trash aria-hidden className="size-4" />
            Remove picture
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/**
 * The label above a group of settings, shared so the two groups cannot drift
 * apart — `cn()` is a plain join, so chrome is shared rather than overridden.
 */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-sm font-medium text-fg-secondary">{children}</h2>;
}

/** What the live region says while a picture is saving or being removed. */
function busyMessage(removing: boolean): string {
  return removing ? "Removing your picture…" : "Saving your picture…";
}

/**
 * What to say when a picture is not stored. Browser-side failures carry no API
 * message, so they are matched by error name.
 */
function pictureFailure(caught: unknown): string {
  if (caught instanceof Error && caught.name === IMAGE_TOO_LARGE_ERROR) {
    return `That photo is too large to prepare. Use one under ${MAX_SOURCE_MB} MB.`;
  }
  if (caught instanceof Error && caught.name === IMAGE_UNREADABLE_ERROR) {
    return "That image could not be read. Try a JPEG or PNG photo.";
  }

  const message = errorMessage(caught, "Your picture could not be saved.");
  // No field to hang the `image` detail on, so it joins the message.
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
      <div role="radiogroup" aria-label="Appearance" className="flex gap-1 rounded-xl bg-muted p-1">
        {THEME_OPTIONS.map((option) => (
          // biome-ignore lint/a11y/useSemanticElements: a segmented control, styled as one row of buttons.
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={theme === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors",
              theme === option.value ? "bg-canvas text-fg shadow-sm" : "text-fg-tertiary",
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
