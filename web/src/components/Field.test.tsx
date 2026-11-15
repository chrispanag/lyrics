import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Field, Input, Select, Textarea } from "./ui";

/*
 * Field points its control at the text it shows, so no caller has to: wired by
 * hand, nothing failed when a caller forgot, and several did.
 */
describe("Field", () => {
  it("describes its control by the hint while there is no error", () => {
    render(
      <Field label="Notes" htmlFor="notes" hint="Optional">
        <Input id="notes" />
      </Field>,
    );

    expect(screen.getByLabelText("Notes")).toHaveAccessibleDescription("Optional");
  });

  it("replaces the hint with the error, on screen and in the description", () => {
    render(
      <Field label="Notes" htmlFor="notes" hint="Optional" error="Notes are too long.">
        <Input id="notes" />
      </Field>,
    );

    expect(screen.getByLabelText("Notes")).toHaveAccessibleDescription("Notes are too long.");
    expect(screen.queryByText("Optional")).not.toBeInTheDocument();
  });

  it("leaves a control with nothing to say undescribed", () => {
    render(
      <Field label="Name" htmlFor="name">
        <Input id="name" />
      </Field>,
    );

    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-describedby");
  });

  it("describes every primitive, not just an input", () => {
    render(
      <>
        <Field label="Language" htmlFor="language" error="Pick a language.">
          <Select id="language">
            <option>el</option>
          </Select>
        </Field>
        <Field label="Lyrics" htmlFor="lyrics" error="Lyrics are too long.">
          <Textarea id="lyrics" />
        </Field>
      </>,
    );

    expect(screen.getByLabelText("Language")).toHaveAccessibleDescription("Pick a language.");
    expect(screen.getByLabelText("Lyrics")).toHaveAccessibleDescription("Lyrics are too long.");
  });

  it("keeps a description the caller names, beside its own and once", () => {
    render(
      <>
        <p id="rules">At least eight characters.</p>
        <Field label="Password" htmlFor="password" error="Too short.">
          <Input id="password" aria-describedby="password-error rules" />
        </Field>
      </>,
    );

    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("aria-describedby", "password-error rules");
    expect(input).toHaveAccessibleDescription("Too short. At least eight characters.");
  });

  it("describes a control outside any field only as its caller says", () => {
    render(
      <>
        <p id="help">Search by title or lyrics.</p>
        <Input aria-label="Search" aria-describedby="help" />
        <Input aria-label="Filter" />
      </>,
    );

    expect(screen.getByLabelText("Search")).toHaveAccessibleDescription(
      "Search by title or lyrics.",
    );
    expect(screen.getByLabelText("Filter")).not.toHaveAttribute("aria-describedby");
  });
});
