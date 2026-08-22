import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar } from "@/components/Avatar";
import { API, makeUser } from "@/test/handlers";

describe("Avatar", () => {
  it("shows initials from a display name when there is no picture", () => {
    render(<Avatar user={makeUser({ display_name: "Μαρία Καλλας" })} />);

    expect(screen.getByText("ΜΚ")).toBeInTheDocument();
  });

  // The fallback still has to say something for an account that never set a
  // name, which is most of them until someone visits their profile.
  it("falls back to the email when there is no name either", () => {
    render(<Avatar user={makeUser({ display_name: null, email: "singer@example.com" })} />);

    expect(screen.getByText("S")).toBeInTheDocument();
  });

  it("shows the picture when there is one, versioned so a new one is not cached", () => {
    const user = makeUser({ avatar_updated_at: "2026-08-22T20:00:00Z" });

    render(<Avatar user={user} />);

    // Written out rather than composed the way the code composes it, so the
    // assertion cannot pass by making the same mistake twice.
    expect(screen.getByRole("presentation")).toHaveAttribute(
      "src",
      `${API}/api/v1/users/${user.id}/avatar?v=2026-08-22T20%3A00%3A00Z`,
    );
  });

  // The address of a picture never changes, so the version in the query string
  // is the only thing that makes a replacement visible.
  it("changes the address when the picture is replaced", () => {
    const { rerender } = render(
      <Avatar user={makeUser({ avatar_updated_at: "2026-08-22T20:00:00Z" })} />,
    );
    const before = screen.getByRole("presentation").getAttribute("src");

    rerender(<Avatar user={makeUser({ avatar_updated_at: "2026-08-22T21:00:00Z" })} />);

    expect(screen.getByRole("presentation").getAttribute("src")).not.toBe(before);
  });

  // Keyed on the record rather than on the image having loaded: a picture that
  // fails to load is a picture, and initials underneath it would be worse than
  // an empty circle.
  it("decides from the record, not from the response", () => {
    render(<Avatar user={makeUser({ display_name: "Never Shown", avatar_updated_at: "2026-01-01T00:00:00Z" })} />);

    expect(screen.queryByText("NS")).not.toBeInTheDocument();
  });
});
