import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Fact, FactList } from "./FactList";

describe("FactList", () => {
  it("pairs each label with its value", () => {
    render(
      <FactList layout="inline">
        <Fact label="Music">Μίκης Θεοδωράκης</Fact>
        <Fact label="Year">1964</Fact>
      </FactList>,
    );

    const terms = screen.getAllByRole("term");
    const values = screen.getAllByRole("definition");
    expect(terms.map((term) => term.textContent)).toEqual(["Music", "Year"]);
    expect(values.map((value) => value.textContent)).toEqual(["Μίκης Θεοδωράκης", "1964"]);
  });

  it("adds a detail under the value", () => {
    render(
      <FactList layout="justified">
        <Fact label="Views" detail="3 by signed-in readers">
          12
        </Fact>
      </FactList>,
    );

    expect(screen.getByRole("definition")).toHaveTextContent("123 by signed-in readers");
    expect(screen.getByText("3 by signed-in readers")).toHaveClass("block");
  });

  // jsdom draws nothing, so the classes are the layout.
  it("runs inline facts on as one band that wraps between them", () => {
    render(
      <FactList layout="inline">
        <Fact label="Music">Μίκης Θεοδωράκης</Fact>
      </FactList>,
    );

    const row = screen.getByRole("term").parentElement;
    expect(row?.parentElement).toHaveClass("flex", "flex-wrap");
    expect(row).toHaveClass("flex", "items-baseline");
  });
});
