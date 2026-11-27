import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Fact, FactList } from "./FactList";

describe("FactList", () => {
  it("pairs each label with its value", () => {
    render(
      <FactList layout="aligned">
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
  it("gives every row its list's layout, stacking an aligned one when narrow", () => {
    render(
      <FactList layout="aligned">
        <Fact label="Music">Μίκης Θεοδωράκης</Fact>
      </FactList>,
    );

    const row = screen.getByRole("term").parentElement;
    expect(row?.parentElement).toHaveClass("@container");
    expect(row).toHaveClass("grid-cols-subgrid", "@max-xs:block");
  });
});
