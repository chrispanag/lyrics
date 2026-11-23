import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageHeader } from "@/components/PageHeader";

describe("PageHeader", () => {
  it("renders the title as the screen's one h1", () => {
    render(<PageHeader title="Your lists" />);

    expect(screen.getByRole("heading", { level: 1, name: "Your lists" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("names the section above the title without making it a heading", () => {
    render(<PageHeader eyebrow="Admin" title="Users" />);

    // A second heading would put "Admin" in the outline as its own section.
    expect(screen.getByText("Admin").tagName).toBe("P");
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("renders a way back above the title, and the actions beside it", () => {
    render(
      <PageHeader
        title="Edit song"
        back={<a href="/songs">Back</a>}
        actions={<button type="button">New list</button>}
      />,
    );

    expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New list" })).toBeInTheDocument();
  });
});
