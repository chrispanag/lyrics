import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { TextSizeControl } from "./TextSizeControl";
import { FONT_SIZE_ATTRIBUTE, FONT_SIZES } from "@/lib/fontSize";

const drawn = () => document.documentElement.getAttribute(FONT_SIZE_ATTRIBUTE);

describe("TextSizeControl", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(FONT_SIZE_ATTRIBUTE);
    localStorage.clear();
  });

  it("is one named group of two steps", () => {
    render(<TextSizeControl />);

    const group = screen.getByRole("group", { name: "Text size" });
    expect(group).toContainElement(screen.getByRole("button", { name: "Decrease text size" }));
    expect(group).toContainElement(screen.getByRole("button", { name: "Increase text size" }));
  });

  it("draws and remembers each step", async () => {
    render(<TextSizeControl />);

    await userEvent.click(screen.getByRole("button", { name: "Increase text size" }));

    expect(drawn()).toBe("2");
    expect(localStorage.getItem("lyrics:font-size")).toBe("2");
  });

  // Starts from the size already drawn, so the limits are the lyrics' own.
  it("stops at the largest size", async () => {
    document.documentElement.setAttribute(FONT_SIZE_ATTRIBUTE, String(FONT_SIZES.length - 2));
    render(<TextSizeControl />);

    const increase = screen.getByRole("button", { name: "Increase text size" });
    await userEvent.click(increase);

    expect(drawn()).toBe(String(FONT_SIZES.length - 1));
    expect(increase).toBeDisabled();
  });

  it("stops at the smallest size", async () => {
    document.documentElement.setAttribute(FONT_SIZE_ATTRIBUTE, "1");
    render(<TextSizeControl />);

    const decrease = screen.getByRole("button", { name: "Decrease text size" });
    await userEvent.click(decrease);

    expect(drawn()).toBe("0");
    expect(decrease).toBeDisabled();
  });
});
