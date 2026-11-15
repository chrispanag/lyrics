import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, userEvent, type within } from "storybook/test";

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

/** Answers the catalog search with whatever `respond` returns. */
const answerSearch = (respond: () => Response) => http.get(`${API}/api/v1/songs`, respond);

/** Types into the box, which is what opens the panel, and returns the box. */
async function search(canvas: ReturnType<typeof within>, text: string) {
  const box = canvas.getByRole("combobox", { name: /search songs/i });
  await userEvent.type(box, text);
  return box;
}

export const Empty: Story = {};

export const Results: Story = {
  beforeEach({ msw }) {
    msw.use(answerSearch(() => HttpResponse.json(list(matches))));
  },
  play: async ({ canvas }) => {
    const box = await search(canvas, "τραγ");
    const first = await canvas.findByRole("option", { name: /Λίμνης/ });

    // Focus never leaves the box: the highlight is aria-activedescendant.
    await userEvent.keyboard("{ArrowDown}");
    await expect(box).toHaveFocus();
    await expect(box).toHaveAttribute("aria-activedescendant", first.id);
  },
};

export const MoreThanListed: Story = {
  beforeEach({ msw }) {
    msw.use(answerSearch(() => HttpResponse.json(list(matches, { total: 12 }))));
  },
  play: async ({ canvas }) => {
    await search(canvas, "love");
    await expect(await canvas.findByRole("link", { name: /see all 12 songs/i })).toBeVisible();
  },
};

export const NoMatches: Story = {
  beforeEach({ msw }) {
    msw.use(answerSearch(() => HttpResponse.json(list([]))));
  },
  play: async ({ canvas }) => {
    await search(canvas, "zzz");
    await expect(await canvas.findByText(/No songs matched/)).toBeVisible();
  },
};

/** A failed search says so, rather than claiming nothing matched. */
export const Failed: Story = {
  beforeEach({ msw }) {
    msw.use(answerSearch(() => apiError(500, "internal", "boom")));
  },
  play: async ({ canvas }) => {
    await search(canvas, "τραγ");
    await expect(await canvas.findByText(/unavailable/i)).toBeVisible();
  },
};
