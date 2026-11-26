import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { BackButton } from "./BackButton";
import { renderWithProviders } from "@/test/render";
import { CurrentAddress } from "@/test/routes";

function Screen() {
  return (
    <>
      <BackButton />
      <CurrentAddress />
    </>
  );
}

describe("BackButton", () => {
  it("goes back through the app's own history", async () => {
    renderWithProviders(<Screen />, { route: ["/?q=agapi", "/songs/a?list=l1"] });

    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/?q=agapi");
  });

  // A fresh tab: Back would leave the site, so it goes up instead.
  it("goes up to the song's list where nothing in the app is behind", async () => {
    renderWithProviders(<Screen />, { route: "/songs/a?list=l1" });

    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/lists/l1");
  });

  it("goes up to the catalog from a song read from no list", async () => {
    renderWithProviders(<Screen />, { route: "/songs/a" });

    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByTestId("location")).toHaveTextContent(/at \/$/);
  });
});
