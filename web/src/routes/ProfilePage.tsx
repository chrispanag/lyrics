import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { KeyRound, Loader2, LogOut, Moon, Pencil, Sun, Trash2, Upload } from "lucide-react";

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
    // Belt to the close below's suspenders, which unmounts this input and so
    // already empties it: on one that outlived the pick, retrying the same file
    // — the usual one after a failure — would raise no change event at all.
    event.target.value = "";
    setPictureMenu(false);
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
        {/* The badge's spinner said this to everyone who could see it and to
            nobody else — the button's name does not change and the badge is
            `aria-hidden`, so between choosing a photo and its landing (a 12MP
            decode, on the device where that is slowest) a screen reader had
            silence. Rendered always and emptied rather than mounted on demand:
            a live region has to be on the page before its text changes, or the
            change is the region arriving and there is nothing to announce. */}
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
 * The picture, and the one control that changes it.
 *
 * The whole circle is the button rather than the pencil alone. A badge small
 * enough to sit on the perimeter of an 80px circle is around 32px across, well
 * under the 44px floor every other control on this page keeps — and pressing
 * the pencil still works, because it is drawn inside the button it marks.
 * What the pair of buttons this replaces could not do is line up with the
 * circle: a `<label>` and a `<Button>` are separate elements sized separately,
 * so the stack beside the picture sat visibly ragged against it and against
 * each other, which no spacing on the row could fix.
 *
 * Busy is drawn on the circle for the same reason the pending state is set
 * before the canvas work rather than around the request alone: preparing a
 * 12MP photo is the slow half, on the device where it is slowest, and the
 * sheet holding the control has closed by then — so the circle is the only
 * thing left on screen that can say something is happening.
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
      // Deliberately not `disabled` while busy, which is what it was: closing
      // the sheet hands focus back here, and focus cannot land on a disabled
      // element — so the reader who pressed the control that just unmounted was
      // dropped on `<body>` instead. Reopening mid-upload is harmless because
      // the sheet refuses its own controls while busy, which is where that guard
      // belongs anyway: it is the pick that must not happen twice, not the menu.
      aria-busy={busy}
      aria-label="Edit picture"
      className={
        // `group` so the badge can answer a hover over the whole circle: it is
        // the part that looks pressable, and lighting up only when the pointer
        // is on the badge itself makes the other 80% of the target look inert.
        //
        // `inline-flex` and not the button's own `inline-block`, which leaves a
        // line box under the picture for a descender that is not there — three
        // or four pixels of it, enough to drop the badge clear of the circle it
        // is meant to straddle. Nor plain `flex`, which is block-level and
        // would stretch the target across the column.
        //
        // No focus classes: `index.css` outlines every `:focus-visible` in
        // `brand-500`, and this is a real button, so the outline lands on it —
        // following the `rounded-full` as an outline does. The `<label>` below
        // draws its own only because focus there is on an `sr-only` input the
        // outline would trace instead.
        "group relative inline-flex cursor-pointer rounded-full"
      }
    >
      <Avatar user={user} size="lg" className={busy ? "opacity-50" : undefined} />
      <span
        // Decorative: the button around it carries the name, and a second one
        // here would have a screen reader announce the control twice.
        aria-hidden
        className={cn(
          // Straddling the perimeter, not inside it: a badge within the circle
          // covers the face, and one clear of it reads as a separate control
          // beside the picture — which is the arrangement this replaces.
          "absolute -right-0.5 -bottom-0.5 flex size-8 items-center justify-center rounded-full",
          // The ring is the page's own ground rather than a color of its own
          // — `stone-50`, which is what `body` paints, not white — so the badge
          // separates from a photo of any brightness while reading as a bite
          // out of the circle rather than as a second disc on top of it.
          "bg-brand-600 text-white ring-2 ring-stone-50 transition-colors dark:ring-stone-950",
          !busy && "group-hover:bg-brand-700 group-active:bg-brand-800",
        )}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-3.5" />}
      </span>
    </button>
  );
}

/**
 * The choice between the two things that can be done to a picture.
 *
 * A sheet rather than a menu anchored to the badge: it is the app's one modal,
 * so Escape, the scroll lock and the pair of attributes `lib/modal.ts` reads
 * all come with it. An anchored menu would need its own dismissal listener over
 * the page, which is the shape of thing the tap strips were.
 *
 * Both actions close it the moment they start, so failure is reported on the
 * page rather than in here: waiting instead would leave the sheet over the
 * picture it is in the middle of replacing. What it does still have to say is
 * that a picture is already on its way, because the trigger no longer refuses a
 * press while one is — this is where that refusal lives now, and it has to be
 * stated rather than inferred from the sheet being shut, or the second pick is
 * a second decode and two reloads landing in whatever order they finish.
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
        {/* A label around a visually hidden input, rather than a button that
            clicks one: this way the control is a real file picker to a
            keyboard and a screen reader, and `sr-only` keeps the input
            focusable where `hidden` would not. */}
        <label
          className={cn(
            buttonClasses("secondary", "lg", "w-full"),
            // The ring belongs to the label because the input it wraps is
            // `sr-only`: the browser draws focus on a 1px clipped box, so a
            // keyboard user got no visible focus here while every other
            // control on the page — a real button — shows one. The disabled
            // pair is conditional for the same reason: a `disabled:` variant
            // can never match a label, only the input inside it.
            "cursor-pointer focus-within:ring-2 focus-within:outline-none",
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
          // Ghost and not `danger`, and with no color passed through either:
          // `cn` is a plain join, so a `text-red-600` here lands beside the
          // variant's own `text-stone-700` and loses to it on source order —
          // rendering exactly as it does without the class, which is how a
          // dead override survives being looked at. The trash is what marks
          // this as the destructive one, and a removed picture can be put
          // back, which is not what the solid red is for.
          <Button variant="ghost" className="w-full" disabled={busy} onClick={onRemove}>
            <Trash2 aria-hidden className="size-4" />
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
  return (
    <h2 className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">{children}</h2>
  );
}

/**
 * What the live region says while a picture is in flight.
 *
 * Two sentences rather than one, because the two waits end in opposite places:
 * a reader told "saving" who then finds no picture has been given the wrong
 * account of what they just did.
 */
function busyMessage(removing: boolean): string {
  return removing ? "Removing your picture…" : "Saving your picture…";
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

