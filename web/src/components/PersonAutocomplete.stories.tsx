import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { useState } from "react";
import { expect, userEvent } from "storybook/test";

import { PersonAutocomplete, type PersonSelection } from "./PersonAutocomplete";
import { API, list, makePerson } from "@/test/handlers";

const people = [
  makePerson({ song_count: 42 }),
  makePerson({ id: "person-2", name: "Μίκης Θεοδωράκης-Φαραντούρη", song_count: 0 }),
];

/**
 * The song editor's name field: suggests existing people and accepts new ones.
 * Named by its required `label`, as each credit and performer row names it.
 */
const meta = {
  title: "Song editor/PersonAutocomplete",
  component: PersonAutocomplete,
  args: { value: { name: "" }, onChange: () => {}, label: "Composer", placeholder: "Name" },
  render: function Render(args) {
    const [value, setValue] = useState<PersonSelection>(args.value);
    return (
      <div className="max-w-sm min-h-72">
        <PersonAutocomplete {...args} value={value} onChange={setValue} />
      </div>
    );
  },
  beforeEach({ msw }) {
    msw.use(http.get(`${API}/api/v1/people`, () => HttpResponse.json(list(people))));
  },
} satisfies Meta<typeof PersonAutocomplete>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

/** The highlight is announced through the field, which keeps focus throughout. */
export const Suggestions: Story = {
  play: async ({ canvas }) => {
    const field = canvas.getByRole("combobox", { name: "Composer" });
    await userEvent.type(field, "Μίκ");
    const first = await canvas.findByRole("option", { name: "Μίκης Θεοδωράκης 42 songs" });

    await userEvent.keyboard("{ArrowDown}");
    await expect(field).toHaveFocus();
    await expect(field).toHaveAttribute("aria-activedescendant", first.id);
    await expect(first).toHaveAttribute("aria-selected", "true");
  },
};
