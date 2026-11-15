import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect } from "storybook/test";

import { AdminConsole, AdminGenresPage, AdminUsersPage } from "./AdminPages";
import { API, list, makeGenre, makeUser } from "@/test/handlers";

const admin = makeUser({ id: "admin-1", display_name: "Christos", role: "admin" });

/*
 * The console's two screens, each inside the shell the `/admin` layout renders
 * around it, so the heading and tabs are the ones the reader sees.
 */
const meta = {
  title: "Pages/Admin",
  component: AdminUsersPage,
  decorators: [
    (Story) => (
      <AdminConsole>
        <Story />
      </AdminConsole>
    ),
  ],
  parameters: { layout: "fullscreen", user: admin, route: "/admin/users" },
} satisfies Meta<typeof AdminUsersPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const genresRoute = { route: "/admin/genres" };

export const Users: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get(`${API}/api/v1/admin/users`, () =>
        HttpResponse.json(
          list([
            admin,
            makeUser({
              id: "user-2",
              email: "maria@example.com",
              display_name: "Μαρία Φαραντούρη",
              role: "contributor",
            }),
            makeUser({ id: "user-3", email: "listener@example.com" }),
          ]),
        ),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("listener@example.com")).toBeVisible();
  },
};

export const Genres: Story = {
  render: () => <AdminGenresPage />,
  parameters: genresRoute,
  beforeEach({ msw }) {
    msw.use(
      http.get(`${API}/api/v1/genres`, () =>
        HttpResponse.json(
          list([
            makeGenre({ song_count: 42 }),
            makeGenre({ id: "genre-2", name: "Έντεχνο", slug: "entechno", song_count: 17 }),
            // The API omits a count of zero.
            makeGenre({ id: "genre-3", name: "Λαϊκό", slug: "laiko" }),
          ]),
        ),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Έντεχνο")).toBeVisible();
  },
};

export const NoGenres: Story = {
  render: () => <AdminGenresPage />,
  parameters: genresRoute,
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("No genres yet")).toBeVisible();
  },
};
