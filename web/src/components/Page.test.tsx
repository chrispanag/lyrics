import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Page } from "@/components/Page";

describe("Page", () => {
  it("sets the content width for a page that lists things", () => {
    render(<Page width="content">Your lists</Page>);

    expect(screen.getByText("Your lists")).toHaveClass("mx-auto", "max-w-3xl", "px-4", "py-6");
  });

  it("sets the narrower form width for a page that edits one thing", () => {
    render(<Page width="form">Profile</Page>);

    const page = screen.getByText("Profile");
    expect(page).toHaveClass("max-w-2xl");
    expect(page).not.toHaveClass("max-w-3xl");
  });
});
