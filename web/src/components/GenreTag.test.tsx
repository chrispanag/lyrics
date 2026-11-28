import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GenreTag } from "./GenreTag";
import { genrePageHref } from "@/lib/browse";
import { renderWithProviders } from "@/test/render";

const genre = { name: "Ρεμπέτικο", slug: "rebetiko" };

describe("GenreTag", () => {
  it("leads to the genre's page, by the address the sitemap uses", () => {
    renderWithProviders(<GenreTag genre={genre} linked />);

    expect(screen.getByRole("link", { name: "Ρεμπέτικο" })).toHaveAttribute(
      "href",
      genrePageHref("rebetiko"),
    );
  });

  // Inside a song's row, which is a link itself.
  it("is plain text unless linked", () => {
    renderWithProviders(<GenreTag genre={genre} />);

    expect(screen.getByText("Ρεμπέτικο")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
