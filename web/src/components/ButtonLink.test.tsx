import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ButtonLink } from "./ButtonLink";
import { buttonClasses } from "./buttonStyles";
import { linkClasses } from "./textStyles";
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

describe("linkClasses", () => {
  it("sets each tone apart", () => {
    expect(linkClasses("accent")).toContain("text-fg-accent");
    expect(linkClasses("muted")).toContain("font-medium");
    expect(linkClasses("quiet")).not.toContain("font-medium");
  });

  // A button drawn as a link must look disabled when it is.
  it("draws a disabled button as disabled in every tone", () => {
    for (const tone of ["accent", "muted", "quiet"] as const) {
      expect(linkClasses(tone)).toContain("disabled:no-underline");
    }
  });
});
