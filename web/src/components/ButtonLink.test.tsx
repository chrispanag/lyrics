import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ButtonLink } from "./ButtonLink";
import { buttonClasses } from "./buttonStyles";
import { renderWithProviders } from "@/test/render";

describe("ButtonLink", () => {
  it("is a link drawn as the button it names", () => {
    renderWithProviders(
      <ButtonLink href="/songs/new" variant="secondary" size="sm" className="w-full">
        Add song
      </ButtonLink>,
    );

    const link = screen.getByRole("link", { name: "Add song" });
    expect(link).toHaveAttribute("href", "/songs/new");
    expect(link).toHaveAttribute("class", buttonClasses("secondary", "sm", "w-full"));
  });

  it("defaults to the primary, medium button", () => {
    renderWithProviders(<ButtonLink href="/">Browse songs</ButtonLink>);

    expect(screen.getByRole("link")).toHaveAttribute("class", buttonClasses("primary", "md"));
  });
});
