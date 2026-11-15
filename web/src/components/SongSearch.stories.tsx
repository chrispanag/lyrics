import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, userEvent } from "storybook/test";

import { SongSearch } from "./SongSearch";
import { API, apiError, list, makeRecording, makeSong } from "@/test/handlers";

const matches = [
  makeSong({
    id: "song-2",
    slug: "to-tragoydi-tis-limnis",
    title: "Το Τραγούδι της Λίμνης",
    recordings: [makeRecording()],
    snippet: "κι ένα ⟦τραγούδι⟧ στη λίμνη",
  }),
  makeSong({ id: "song-3", slug: "aspro-poykamiso", title: "Άσπρο Πουκάμισο" }),
];

/**
 * The song page's quick search. Each story types into the box, so what it
 * shows is the open panel; the specs in `SongSearch.test.tsx` own the
 * behavior, and these own how each state looks.
 */
const meta = {
  title: "Song page/SongSearch",
  component: SongSearch,
  parameters: { route: "/songs/thalassa-platia" },
  // Room below the box for the panel, which overlays what follows it.
  decorators: [
    (Story) => (
      <div className="min-h-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SongSearch>;

export default meta;
type Story = StoryObj<typeof meta>;

const box = () => document.querySelector<HTMLInputElement>('[role="combobox"]');

export const Empty: Story = {};

export const Results: Story = {
  beforeEach({ msw }) {
    msw.use(http.get(`${API}/api/v1/songs`, () => HttpResponse.json(list(matches))));
  },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole("combobox", { name: /search songs/i }), "τραγ");
    const first = await canvas.findByRole("option", { name: /Λίμνης/ });

    // Focus never leaves the box: the highlight is aria-activedescendant.
    await userEvent.keyboard("{ArrowDown}");
    await expect(box()).toHaveFocus();
    await expect(box()).toHaveAttribute("aria-activedescendant", first.id);
  },
};

export const MoreThanListed: Story = {
  beforeEach({ msw }) {
    msw.use(http.get(`${API}/api/v1/songs`, () => HttpResponse.json(list(matches, { total: 12 }))));
  },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole("combobox", { name: /search songs/i }), "love");
    await expect(await canvas.findByRole("link", { name: /see all 12 songs/i })).toBeVisible();
  },
};

export const NoMatches: Story = {
  beforeEach({ msw }) {
    msw.use(http.get(`${API}/api/v1/songs`, () => HttpResponse.json(list([]))));
  },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole("combobox", { name: /search songs/i }), "zzz");
    await expect(await canvas.findByText(/No songs matched/)).toBeVisible();
  },
};

/** A failed search says so, rather than claiming nothing matched. */
export const Failed: Story = {
  beforeEach({ msw }) {
    msw.use(http.get(`${API}/api/v1/songs`, () => apiError(500, "internal", "boom")));
  },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole("combobox", { name: /search songs/i }), "τραγ");
    await expect(await canvas.findByText(/unavailable/i)).toBeVisible();
  },
};
