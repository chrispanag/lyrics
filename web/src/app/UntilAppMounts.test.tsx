import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { markAppMounted } from "@/lib/appMounted";

import { UntilAppMounts } from "./UntilAppMounts";

describe("the server's stand-in for the app", () => {
  it("stays until the app has mounted, and then leaves", () => {
    render(
      <UntilAppMounts>
        <p>Server copy</p>
      </UntilAppMounts>,
    );
    expect(screen.getByText("Server copy")).toBeInTheDocument();

    act(() => markAppMounted());

    // Unmounted rather than hidden, so a <title> inside goes with it.
    expect(screen.queryByText("Server copy")).not.toBeInTheDocument();
  });
});
