import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageHeader } from "@/components/PageHeader";

describe("PageHeader", () => {
  it("renders the title as the screen's one h1", () => {
    render(<PageHeader title="Your lists" />);

    expect(screen.getByRole("heading", { level: 1, name: "Your lists" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("renders the page's actions", () => {
    render(<PageHeader title="Your lists" actions={<button type="button">New list</button>} />);

    expect(screen.getByRole("button", { name: "New list" })).toBeInTheDocument();
  });
});
