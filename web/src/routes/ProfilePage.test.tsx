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
import { API, makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

const photo = () => new File(["pretend jpeg"], "portrait.jpg", { type: "image/jpeg" });

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
    await userEvent.upload(screen.getByLabelText("Add picture"), photo());

    // The bytes on the wire are the canvas's, not the chosen file's: the API
    // caps a body at 1 MB and a photo from a phone is several.
    await waitFor(() => expect(uploaded).not.toBeNull());
    expect(uploaded).toEqual({ bytes: pipeline.output.size, type: "image/jpeg" });

    // Handed straight to the context, like the display name is — the response
    // already carries the record a GET /me would return.
    await waitFor(() => expect(reload).toHaveBeenCalledWith(stored));
  });

  it("offers removal only to an account that has a picture", () => {
    const { unmount } = renderWithProviders(<ProfilePage />, { user: makeUser() });

    expect(screen.getByLabelText("Add picture")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove picture" })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<ProfilePage />, {
      user: makeUser({ avatar_updated_at: "2026-08-22T20:00:00Z" }),
    });

    expect(screen.getByLabelText("Change picture")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove picture" })).toBeInTheDocument();
  });

  it("removes a picture and hands that account back too", async () => {
    const cleared = makeUser({ avatar_updated_at: null });
    server.use(http.delete(`${API}/api/v1/me/avatar`, () => HttpResponse.json(cleared)));
    const reload = vi.fn();

    renderWithProviders(<ProfilePage />, {
      user: makeUser({ avatar_updated_at: "2026-08-22T20:00:00Z" }),
      auth: { reload },
    });
    await userEvent.click(screen.getByRole("button", { name: "Remove picture" }));

    await waitFor(() => expect(reload).toHaveBeenCalledWith(cleared));
  });

  // Without this the promise rejects unhandled, the control returns to "Add
  // picture", and nothing on the screen distinguishes a refused upload from one
  // that worked.
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
    await userEvent.upload(screen.getByLabelText("Add picture"), photo());

    await waitFor(() => expect(screen.getByLabelText("Change picture")).toBeInTheDocument());
    expect(field).toHaveValue("Μαρία Κ.");
  });

  // A photo refused on size was perfectly readable, so the message about
  // formats would be advice its own JPEG already satisfied.
  it("names the size when the photo is too large to prepare", async () => {
    renderWithProviders(<ProfilePage />, { user: makeUser() });
    const huge = photo();
    Object.defineProperty(huge, "size", { value: 40 * 1024 * 1024 });

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
    await userEvent.upload(screen.getByLabelText("Add picture"), photo());

    expect(
      await screen.findByText("That image could not be read. Try a JPEG or PNG photo."),
    ).toBeInTheDocument();
  });
});
