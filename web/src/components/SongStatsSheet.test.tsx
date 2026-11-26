import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SongStats } from "./SongStatsSheet";
import { makePopularity } from "@/test/handlers";

/** The rows the Stats sheet and a song's details column both render. */
describe("SongStats", () => {
  const row = (label: string) => screen.getByText(label).closest("div");

  it("counts every view, and says how many were signed in", () => {
    render(
      <SongStats
        popularity={makePopularity({
          anonymous_clicks: 1203,
          authenticated_clicks: 1,
          list_adds: 4,
          list_users: 3,
        })}
      />,
    );

    expect(row("Views")).toHaveTextContent("1,204");
    expect(row("Views")).toHaveTextContent("1 by signed-in readers");
    expect(row("Added to a list")).toHaveTextContent("4 times");
    expect(row("In lists of")).toHaveTextContent("3 people");
  });

  // "1 times" and "1 people" read wrong; nothing signed in needs no aside.
  it("says once and one person, and leaves out a signed-in count of none", () => {
    render(
      <SongStats
        popularity={makePopularity({ anonymous_clicks: 5, list_adds: 1, list_users: 1 })}
      />,
    );

    expect(row("Views")).toHaveTextContent(/^Views5$/);
    expect(row("Added to a list")).toHaveTextContent("once");
    expect(row("In lists of")).toHaveTextContent("1 person");
  });
});
