import { screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext } from "@/auth/context";
import { useAuth } from "@/auth/useAuth";
import type { User } from "@/lib/types";
import { ProfilePage } from "@/routes/ProfilePage";
import { stubImagePipeline, type ImagePipelineStub } from "@/test/canvas";
import { deferred } from "@/test/deferred";
import { API, makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

const photo = () => new File(["pretend jpeg"], "portrait.jpg", { type: "image/jpeg" });

/**
 * Press the pencil on the picture.
 *
 * Both controls that touch a picture live behind it, so every spec here opens
 * the sheet before it can reach one — which is the pin on there being a single
 * way in, and on that way being reachable by name rather than by the badge
 * being found among the page's other buttons.
 */
const openPictureMenu = () =>
  userEvent.click(screen.getByRole("button", { name: "Edit picture" }));

/**
 * The page under an auth context whose account record really is replaced.
 *
 * `renderWithProviders` stubs a fixed user, which is exactly the condition the
 * bug cannot occur under: what breaks an unsaved edit is the *new object* the
 * real provider stores when a mutation's response is handed back to it. So this
 * nests a provider that holds the record in state, keeping every other stubbed
 * method from the one outside it.
 */
function LiveAccount({ start }: { start: User }) {
  const stub = useAuth();
  const [user, setUser] = useState(start);

  return (
    <AuthContext.Provider
      value={{
        ...stub,
        user,
        reload: async (next) => {
          if (next) setUser(next);
        },
      }}
    >
      <ProfilePage />
    </AuthContext.Provider>
  );
}

describe("ProfilePage pictures", () => {
  let pipeline: ImagePipelineStub;

  beforeEach(() => {
    pipeline = stubImagePipeline();
  });

  it("uploads the prepared square and hands the updated account back to the context", async () => {
    const stored = makeUser({ avatar_updated_at: "2026-08-22T20:00:00Z" });
    let uploaded: { bytes: number; type: string | null } | null = null;
    server.use(
      http.post(`${API}/api/v1/me/avatar`, async ({ request }) => {
        const body = await request.arrayBuffer();
        uploaded = { bytes: body.byteLength, type: request.headers.get("Content-Type") };
        return HttpResponse.json(stored);
      }),
    );
    const reload = vi.fn();

    renderWithProviders(<ProfilePage />, { user: makeUser(), auth: { reload } });
    await openPictureMenu();
    await userEvent.upload(screen.getByLabelText("Add picture"), photo());

    // The bytes on the wire are the canvas's, not the chosen file's: the API
    // caps a body at 1 MB and a photo from a phone is several.
    await waitFor(() => expect(uploaded).not.toBeNull());
    expect(uploaded).toEqual({ bytes: pipeline.output.size, type: "image/jpeg" });

    // Handed straight to the context, like the display name is — the response
    // already carries the record a GET /me would return.
    await waitFor(() => expect(reload).toHaveBeenCalledWith(stored));
  });

  it("offers removal only to an account that has a picture", async () => {
    const { unmount } = renderWithProviders(<ProfilePage />, { user: makeUser() });

    await openPictureMenu();
    expect(screen.getByLabelText("Add picture")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove picture" })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<ProfilePage />, {
      user: makeUser({ avatar_updated_at: "2026-08-22T20:00:00Z" }),
    });

    await openPictureMenu();
    expect(screen.getByLabelText("Change picture")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove picture" })).toBeInTheDocument();
  });

  // The sheet is a modal — `lib/modal.ts` finds it, and the arrow keys and the
  // paging swipe stand down while it is up. Left open across an upload it would
  // also cover the picture being replaced, which is the one thing worth
  // watching, and its file input would still be there to start a second decode
  // over the first.
  //
  // The upload is held open on purpose. Against a handler that answers at once,
  // this passes just as well with the close moved *after* the await — which is
  // the arrangement it exists to refuse — so "as soon as" has to be read while
  // the request is still in flight or it is not being read at all.
  it("closes the menu as soon as a picture is chosen, before the upload lands", async () => {
    const stored = makeUser({ avatar_updated_at: "2026-08-22T20:00:00Z" });
    const [landed, land] = deferred();
    server.use(
      http.post(`${API}/api/v1/me/avatar`, async () => {
        await landed;
        return HttpResponse.json(stored);
      }),
    );

    renderWithProviders(<ProfilePage />, { user: makeUser() });

    await openPictureMenu();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.upload(screen.getByLabelText("Add picture"), photo());

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Reopened while the request is still out: the pick that must not happen
    // twice is refused here rather than by the trigger, which stays pressable so
    // that closing the sheet has somewhere to put focus back.
    await openPictureMenu();
    expect(screen.getByLabelText("Working…")).toBeDisabled();

    expect(screen.getByRole("status")).toHaveTextContent("Saving your picture…");

    // Parked on a control inside the open sheet, because landing re-renders the
    // page under it: `Sheet` restores focus from an effect keyed on `open`
    // alone, and folded into the effect beside it — whose `onClose` dep is a
    // fresh closure every render — that restore would run here, mid-open, and
    // pull focus onto the trigger behind the backdrop.
    screen.getByRole("button", { name: "Close" }).focus();

    // Still "Add picture" once it lands, not "Change picture": the stubbed
    // context holds a fixed record, so what is being read here is the pick
    // being offered again — not the account gaining a picture, which is the
    // spec above's with a provider that really replaces it.
    land();
    await waitFor(() => expect(screen.getByLabelText("Add picture")).toBeEnabled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  // Closing unmounts the control that was pressed, and focus goes with it — to
  // `<body>`, which leaves a keyboard reader at the top of the document with the
  // whole page to tab through again. `Sheet` hands it back; the trigger stays
  // enabled while busy so that there is something to hand it back to.
  it("returns focus to the pencil when the menu closes", async () => {
    server.use(
      http.delete(`${API}/api/v1/me/avatar`, () =>
        HttpResponse.json(makeUser({ avatar_updated_at: null })),
      ),
    );

    renderWithProviders(<ProfilePage />, {
      user: makeUser({ avatar_updated_at: "2026-08-22T20:00:00Z" }),
    });
    const trigger = screen.getByRole("button", { name: "Edit picture" });

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: "Remove picture" }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("removes a picture and hands that account back too", async () => {
    const cleared = makeUser({ avatar_updated_at: null });
    server.use(http.delete(`${API}/api/v1/me/avatar`, () => HttpResponse.json(cleared)));
    const reload = vi.fn();

    renderWithProviders(<ProfilePage />, {
      user: makeUser({ avatar_updated_at: "2026-08-22T20:00:00Z" }),
      auth: { reload },
    });
    await openPictureMenu();
    await userEvent.click(screen.getByRole("button", { name: "Remove picture" }));

    await waitFor(() => expect(reload).toHaveBeenCalledWith(cleared));
  });

  // Without this the promise rejects unhandled, the pencil stops spinning, and
  // nothing on the screen distinguishes a refused upload from one that worked.
  // The message has to be on the page rather than in the sheet, which the pick
  // has already closed.
  it("says so when the API refuses the picture", async () => {
    server.use(
      http.post(`${API}/api/v1/me/avatar`, () =>
        HttpResponse.json(
          {
            error: {
              code: "validation_failed",
              message: "That picture is too large.",
              details: { image: "Use a picture under 1024 KB." },
            },
          },
          { status: 422 },
        ),
      ),
    );

    renderWithProviders(<ProfilePage />, { user: makeUser() });
    await openPictureMenu();
    await userEvent.upload(screen.getByLabelText("Add picture"), photo());

    // Both halves: the message says what went wrong, and the detail is the only
    // part that says what would work instead.
    expect(
      await screen.findByText("That picture is too large. Use a picture under 1024 KB."),
    ).toBeInTheDocument();
  });

  // The display name and the picture are two controls on one screen, and the
  // picture's save replaces the whole user record in the auth context. Reset
  // from that record, the name field threw away whatever had been typed into it
  // — silently, since the upload itself succeeded.
  it("keeps an unsaved display name while a picture is uploaded", async () => {
    const stored = makeUser({ display_name: null });
    server.use(
      http.post(`${API}/api/v1/me/avatar`, () =>
        HttpResponse.json({ ...stored, avatar_updated_at: "2026-08-22T20:00:00Z" }),
      ),
    );

    renderWithProviders(<LiveAccount start={stored} />, { user: stored });
    const field = screen.getByLabelText("Display name");
    await userEvent.type(field, "Μαρία Κ.");
    await openPictureMenu();
    await userEvent.upload(screen.getByLabelText("Add picture"), photo());

    // Opened a second time — the pick closed it — to read the account the
    // context now holds: the label in there is keyed on `avatar_updated_at`, so
    // "Change picture" is what says the record really was replaced, which is the
    // condition the field has to survive and the reason this spec nests its own
    // provider. That the sheet shut at all belongs to the spec above.
    //
    // `findBy`, because the sheet can be reopened before the upload lands and
    // the label reads "Working…" until it does. A `getBy` here passes only on
    // the stubbed pipeline being fast, and fails on a spec's own slowness rather
    // than on the invariant.
    await openPictureMenu();
    expect(await screen.findByLabelText("Change picture")).toBeInTheDocument();
    expect(field).toHaveValue("Μαρία Κ.");
  });

  // A photo refused on size was perfectly readable, so the message about
  // formats would be advice its own JPEG already satisfied.
  it("names the size when the photo is too large to prepare", async () => {
    renderWithProviders(<ProfilePage />, { user: makeUser() });
    const huge = photo();
    Object.defineProperty(huge, "size", { value: 40 * 1024 * 1024 });

    await openPictureMenu();
    await userEvent.upload(screen.getByLabelText("Add picture"), huge);

    expect(
      await screen.findByText("That photo is too large to prepare. Use one under 20 MB."),
    ).toBeInTheDocument();
  });

  // A failure inside the browser carries no message of the API's, so it has to
  // be recognized by name — rendered through `errorMessage` alone it would read
  // as a server fault and send the reader looking for an outage.
  it("says so when the browser cannot read the file", async () => {
    vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("unsupported format")));

    renderWithProviders(<ProfilePage />, { user: makeUser() });
    await openPictureMenu();
    await userEvent.upload(screen.getByLabelText("Add picture"), photo());

    expect(
      await screen.findByText("That image could not be read. Try a JPEG or PNG photo."),
    ).toBeInTheDocument();
  });
});
