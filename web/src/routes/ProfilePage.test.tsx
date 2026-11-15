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
 * Press the pencil on the picture: the single, named way into both controls.
 */
const openPictureMenu = () => userEvent.click(screen.getByRole("button", { name: "Edit picture" }));

/**
 * The page under an auth context whose account record really is replaced;
 * `renderWithProviders` stubs a fixed user, under which the bug cannot occur.
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

    // The canvas's bytes, not the file's: the API caps the body size.
    await waitFor(() => expect(uploaded).not.toBeNull());
    expect(uploaded).toEqual({ bytes: pipeline.output.size, type: "image/jpeg" });

    // The response is handed straight to the context, with no GET /me.
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

  // The upload is held open so the close is observed mid-flight; an instant
  // handler would also pass with the close moved after the await.
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

    // Reopened mid-request: the sheet refuses a second pick, not the trigger.
    await openPictureMenu();
    expect(screen.getByLabelText("Working…")).toBeDisabled();

    expect(screen.getByRole("status")).toHaveTextContent("Saving your picture…");

    // Focus parked inside the open sheet must survive the re-render on landing;
    // `useDialog` in lib/modal.ts opens the dialog once per `open`, not per render.
    screen.getByRole("button", { name: "Close" }).focus();

    // Still "Add picture": the stubbed context holds a fixed record.
    land();
    await waitFor(() => expect(screen.getByLabelText("Add picture")).toBeEnabled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  // Closing unmounts the pressed control; `Sheet` returns focus to the trigger,
  // which stays enabled while busy so it can take it.
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

  // The failure shows on the page; the sheet has already closed.
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

    // Both halves: the message and the actionable detail.
    expect(
      await screen.findByText("That picture is too large. Use a picture under 1024 KB."),
    ).toBeInTheDocument();
  });

  // A picture save replaces the user record; that must not reset a typed name.
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

    // Reopened to confirm the record was replaced ("Change picture" keys on
    // `avatar_updated_at`). `findBy`: it reads "Working…" until the upload lands.
    await openPictureMenu();
    expect(await screen.findByLabelText("Change picture")).toBeInTheDocument();
    expect(field).toHaveValue("Μαρία Κ.");
  });

  // A size refusal must not get the format message.
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

  // A browser-side failure is recognized by name; it carries no API message.
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
