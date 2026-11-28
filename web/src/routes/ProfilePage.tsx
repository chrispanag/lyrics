"use client";

import { useId, useState, type ChangeEvent, type SubmitEvent } from "react";
import {
  ChevronRight,
  LoaderCircle,
  LogOut,
  Monitor,
  Moon,
  Pencil,
  Sun,
  Trash,
  Upload,
} from "lucide-react";

import { errorDetails, errorMessage } from "@/api/client";
import { useRemoveAvatar, useUpdateProfile, useUploadAvatar } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { Avatar } from "@/components/Avatar";
import { Button, ErrorMessage, Field, Input, Sheet } from "@/components/ui";
import { ButtonLink } from "@/components/ButtonLink";
import { buttonClasses, segmentClasses, segmentedTrack } from "@/components/buttonStyles";
import { Page } from "@/components/Page";
import { Fact, FactList } from "@/components/FactList";
import { PageHeader } from "@/components/PageHeader";
import { PageTitle } from "@/components/PageTitle";
import { Waiting } from "@/routes/guards";
import type { Identity } from "@/lib/avatar";
import { ADMIN_ITEM, offeredTo } from "@/components/navItems";
import { cn } from "@/lib/cn";
import { pageSubtitle, pageTitle, sectionLabel } from "@/components/textStyles";
import { Link } from "@/lib/navigation";
import {
  IMAGE_TOO_LARGE_ERROR,
  IMAGE_UNREADABLE_ERROR,
  MAX_SOURCE_MB,
  toSquareJpeg,
} from "@/lib/image";
import { applyTheme, storeTheme, storedTheme, type Theme } from "@/lib/theme";
import { useStoredState } from "@/lib/useStoredState";

/** A display name as the API should hold it: trimmed, and null when blank. */
function normalizedName(name: string | null): string | null {
  return name?.trim() || null;
}

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
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
  const [theme, setTheme] = useStoredState<Theme>("system", storedTheme);

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
  if (loading) return <Waiting title="Profile" />;

  if (!user) {
    return (
      <ProfileColumn>
        <PageHeader title="You are browsing as a guest" />
        <p className="mt-2 text-sm text-fg-muted">Sign in to build lists of songs.</p>
        <div className="mt-6 flex flex-col gap-2">
          <ButtonLink href="/login" variant="primary" size="lg">
            Sign in
          </ButtonLink>
          <ButtonLink href="/register" variant="secondary" size="lg">
            Create an account
          </ButtonLink>
        </div>

        <ThemeToggle theme={theme} onChange={selectTheme} className="mt-10" />
      </ProfileColumn>
    );
  }

  // The name as the save would send it, so a save that would change nothing,
  // padding included, is not offered. A successful save moves the stored name
  // to match, which disables the button again.
  // The stored name is normalized too: one saved by another client with
  // padding must not offer a save on load.
  const nameToSend = normalizedName(displayName);
  const nameUnchanged = nameToSend === normalizedName(user.display_name);

  const onSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      // The PATCH returns the updated user, saving a GET /me.
      const updated = await updateProfile.mutateAsync({ display_name: nameToSend });
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
    <ProfileColumn>
      {/* The reader is the page's title, set as a song's is, with their role
          as its italic subtitle, as a song's other title sits under it. The
          tab still says Profile (`ProfileColumn`). */}
      <header className="mb-8 flex items-center gap-4">
        <div className="shrink-0">
          <PictureButton user={user} busy={busy} onClick={() => setPictureMenu(true)} />
          {/* Announces the wait the aria-hidden badge spinner shows. Always
              rendered: a live region must exist before its text changes. */}
          <span role="status" className="sr-only">
            {busy ? busyMessage(removeAvatar.isPending) : ""}
          </span>
        </div>
        <div className="min-w-0">
          <h1 className={pageTitle}>{user.display_name || user.email}</h1>
          <p className={cn(pageSubtitle, "capitalize")}>{user.role}</p>
        </div>
      </header>

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

      {/* The account as liner notes: facts on ruled rows, and the ways to
          change them as quiet links at the row's end, not filled buttons. */}
      <FactList layout="justified" className="mb-8 border-y border-line py-3 text-sm">
        <Fact label="Email">
          <span className="block truncate" title={user.email}>
            {user.email}
          </span>
        </Fact>
        {/* A link: changing a password is its own emailed-code flow. */}
        <Fact label="Password">
          <RowLink href="/change-password">Change password</RowLink>
        </Fact>
        {/* A phone's way to the console: its bottom bar has room for the
            screens everyone uses, and an admin's Profile tab leads here. From
            `md` up the rail has an Admin entry of its own, offered to the same
            readers. */}
        {offeredTo(ADMIN_ITEM, user) && (
          <Fact label="Administration" className="md:hidden">
            <RowLink href={ADMIN_ITEM.to}>Admin console</RowLink>
          </Fact>
        )}
      </FactList>

      <form onSubmit={onSubmit} className="space-y-4">
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <Field label="Display name" htmlFor="display-name" hint="Shown instead of your email">
          <Input
            id="display-name"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              // A failed save's error belongs to the name it tried; once the
              // name is back to the stored one there is nothing to retry.
              setError("");
            }}
          />
        </Field>
        <Button type="submit" loading={updateProfile.isPending} disabled={nameUnchanged}>
          {saved ? "Saved" : "Save changes"}
        </Button>
      </form>

      <ThemeToggle theme={theme} onChange={selectTheme} className="mt-8" />

      <Button variant="ghost" className="mt-8 w-full" onClick={() => void logout()}>
        <LogOut aria-hidden className="size-4" />
        Sign out
      </Button>
    </ProfileColumn>
  );
}

/**
 * Profile's page, guest or signed in. A short settings card, so it keeps a
 * narrow column inside the form column, starting at that column's left edge as
 * the song editor's fields do.
 */
function ProfileColumn({ children }: { children: React.ReactNode }) {
  return (
    <Page width="form">
      <PageTitle name="Profile" />
      <div className="max-w-md">{children}</div>
    </Page>
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
          // The ring is the color the profile sits on, a phone's screen or a
          // desk's sheet, so it reads as a bite out of the circle.
          "bg-accent text-fg-on-fill ring-2 ring-surface transition-colors",
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
 * A way to change a fact, at the end of its row: the accent's text and a
 * chevron, as a link in running text, rather than a filled button. As tall as
 * a thumb, though the row's text is small.
 */
function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="-my-3 inline-flex min-h-11 items-center gap-0.5 font-medium text-fg-accent hover:underline"
    >
      {children}
      <ChevronRight aria-hidden className="size-4" />
    </Link>
  );
}

/**
 * The label above a group of settings, shared so the two groups cannot drift
 * apart — `cn()` is a plain join, so chrome is shared rather than overridden.
 */
function SectionHeading({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className={cn(sectionLabel, "mb-2")}>
      {children}
    </h2>
  );
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
  const id = useId();

  // Native radios drawn as a segmented control: the browser gives the group one
  // Tab stop and moves the choice with the arrow keys. Named by the visible
  // heading rather than a <legend>, which will not lay out as a flex row's
  // sibling and would repeat the heading's text.
  return (
    <div className={className}>
      <SectionHeading id={`${id}-heading`}>Appearance</SectionHeading>
      <fieldset aria-labelledby={`${id}-heading`} className={segmentedTrack}>
        {THEME_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={segmentClasses(theme === option.value, "flex-1 cursor-pointer")}
          >
            <input
              type="radio"
              name={`${id}-theme`}
              value={option.value}
              checked={theme === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <option.icon aria-hidden className="size-4" />
            {option.label}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
