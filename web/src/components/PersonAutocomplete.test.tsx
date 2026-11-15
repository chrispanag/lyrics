import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { PersonAutocomplete, type PersonSelection } from "./PersonAutocomplete";
import { API, list, makePerson } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

const people = [
  makePerson({ id: "person-1", name: "Μίκης Θεοδωράκης", song_count: 12 }),
  makePerson({ id: "person-2", name: "Μάνος Χατζιδάκις", song_count: 0 }),
  makePerson({ id: "person-3", name: "Μάρκος Βαμβακάρης" }),
];

/** Answers any non-empty query with every person above. */
const suggestsPeople = http.get(`${API}/api/v1/people`, ({ request }) =>
  HttpResponse.json(list(new URL(request.url).searchParams.get("q") ? people : [])),
);

/**
 * The field as the editor holds it: controlled, inside a form, so an Enter that
 * escapes would submit, with suggestions served by `suggestsPeople`. Every
 * selection is recorded as emitted.
 */
function renderField(initial: PersonSelection = { name: "" }) {
  server.use(suggestsPeople);
  const changes: PersonSelection[] = [];
  const submitted = vi.fn();

  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted();
        }}
      >
        <PersonAutocomplete
          label="Performer"
          value={value}
          placeholder="Name"
          onChange={(selection) => {
            changes.push(selection);
            setValue(selection);
          }}
        />
        <button type="button">Elsewhere</button>
      </form>
    );
  }

  renderWithProviders(<Harness />);
  return { changes, submitted, field: screen.getByRole("combobox", { name: "Performer" }) };
}

/** Types a query and waits for the debounced suggestions to arrive. */
async function typeAndOpen(field: HTMLElement, text = "Μ") {
  await userEvent.type(field, text);
  await screen.findByRole("listbox");
}

/**
 * An option's text without its `aria-hidden` parts: the count is drawn as a
 * bare number and spoken as "12 songs", and the spoken one is what to compare.
 */
function spoken(option: HTMLElement): string {
  const copy = option.cloneNode(true) as HTMLElement;
  for (const hidden of copy.querySelectorAll("[aria-hidden]")) hidden.remove();
  return copy.textContent ?? "";
}

describe("PersonAutocomplete", () => {
  it("suggests matching people as the name is typed", async () => {
    const { field } = renderField();

    await typeAndOpen(field);

    expect(field).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option").map(spoken)).toEqual([
      "Μίκης Θεοδωράκης12 songs",
      // No count for nobody's songs, nor for a count the server left out.
      "Μάνος Χατζιδάκις",
      "Μάρκος Βαμβακάρης",
    ]);
  });

  // The id is what keeps a picked person one record rather than a new upsert.
  it("emits the person's id with the name when a suggestion is clicked", async () => {
    const { field, changes } = renderField();

    await typeAndOpen(field);
    await userEvent.click(screen.getByRole("option", { name: "Μάνος Χατζιδάκις" }));

    expect(changes.at(-1)).toEqual({ personId: "person-2", name: "Μάνος Χατζιδάκις" });
    expect(field).toHaveValue("Μάνος Χατζιδάκις");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  // Typing over a pick names somebody else, so no id may ride along with it.
  it("emits a typed name with no id, even over a picked person", async () => {
    const { field, changes } = renderField({ personId: "person-1", name: "Μίκης" });

    await userEvent.type(field, "!");

    expect(changes.at(-1)).toEqual({ name: "Μίκης!" });
    expect(changes.every((change) => !("personId" in change))).toBe(true);
  });

  it("moves the highlight with the arrow keys, wrapping at both ends", async () => {
    const { field } = renderField();
    await typeAndOpen(field);

    const highlighted = () =>
      screen
        .getAllByRole("option")
        .filter((option) => option.getAttribute("aria-selected") === "true")
        .map(spoken);

    expect(highlighted()).toEqual([]);
    await userEvent.keyboard("{ArrowDown}");
    expect(highlighted()).toEqual(["Μίκης Θεοδωράκης12 songs"]);
    await userEvent.keyboard("{ArrowUp}");
    expect(highlighted()).toEqual(["Μάρκος Βαμβακάρης"]);
    await userEvent.keyboard("{ArrowDown}");
    expect(highlighted()).toEqual(["Μίκης Θεοδωράκης12 songs"]);
  });

  // Focus stays on the field, so the highlight is announced only through the
  // field pointing at the row; and a row must not be a tab stop, or Tab moves
  // focus into a listbox the field's blur is about to unmount.
  it("names the highlighted row as the field's active descendant, rows out of the tab order", async () => {
    const { field } = renderField();
    await typeAndOpen(field);

    expect(field).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    expect(field).not.toHaveAttribute("aria-activedescendant");
    for (const option of screen.getAllByRole("option")) {
      expect(option).toHaveAttribute("tabindex", "-1");
    }

    await userEvent.keyboard("{ArrowDown}");
    const [first] = screen.getAllByRole("option");
    expect(field).toHaveAttribute("aria-activedescendant", first!.id);

    await userEvent.keyboard("{Escape}");
    expect(field).not.toHaveAttribute("aria-controls");
    expect(field).not.toHaveAttribute("aria-activedescendant");
  });

  it("picks the highlighted suggestion on Enter without submitting the form", async () => {
    const { field, changes, submitted } = renderField();
    await typeAndOpen(field);

    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(changes.at(-1)).toEqual({ personId: "person-2", name: "Μάνος Χατζιδάκις" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(submitted).not.toHaveBeenCalled();
  });

  // The field sits inside the song form: a bare Enter must not save the song.
  it("keeps a typed name on Enter with nothing highlighted, and does not submit", async () => {
    const { field, changes, submitted } = renderField();
    await typeAndOpen(field, "Νέος");

    await userEvent.keyboard("{Enter}");

    expect(changes.at(-1)).toEqual({ name: "Νέος" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(submitted).not.toHaveBeenCalled();
  });

  it("closes the suggestions on Escape and leaves the text alone", async () => {
    const { field, changes } = renderField();
    await typeAndOpen(field);
    const before = changes.length;

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field).toHaveAttribute("aria-expanded", "false");
    expect(changes).toHaveLength(before);
    expect(field).toHaveValue("Μ");
  });

  // Placeholder data outlives the query's enabled flag; the field gates it too.
  it("drops the suggestions when the field is cleared", async () => {
    const { field } = renderField();
    await typeAndOpen(field);

    await userEvent.clear(field);

    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("closes the suggestions when focus leaves the field", async () => {
    const { field } = renderField();
    await typeAndOpen(field);

    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));

    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  // Reopened by focus, a kept highlight would be announced and taken by Enter.
  it("drops the highlight when the suggestions close", async () => {
    const { field, changes } = renderField();
    await typeAndOpen(field);
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());

    await userEvent.click(field);
    await screen.findByRole("listbox");

    expect(field).not.toHaveAttribute("aria-activedescendant");
    const before = changes.length;
    await userEvent.keyboard("{Enter}");
    expect(changes).toHaveLength(before);
  });
});
