import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Snippet } from "./Snippet";
import { parseSegments } from "@/lib/snippet";

describe("parseSegments", () => {
  it("returns plain text unchanged", () => {
    expect(parseSegments("no highlights here")).toEqual([
      { text: "no highlights here", highlighted: false },
    ]);
  });

  it("splits a single highlight", () => {
    expect(parseSegments("before ⟦match⟧ after")).toEqual([
      { text: "before ", highlighted: false },
      { text: "match", highlighted: true },
      { text: " after", highlighted: false },
    ]);
  });

  it("handles several highlights", () => {
    const segments = parseSegments("⟦a⟧ and ⟦b⟧");
    expect(segments.filter((s) => s.highlighted).map((s) => s.text)).toEqual(["a", "b"]);
  });

  it("handles a highlight at the very start and end", () => {
    expect(parseSegments("⟦only⟧")).toEqual([{ text: "only", highlighted: true }]);
  });

  // A truncated snippet must still show its text rather than vanishing.
  it("recovers from an unterminated marker", () => {
    expect(parseSegments("start ⟦dangling")).toEqual([
      { text: "start ", highlighted: false },
      { text: "dangling", highlighted: false },
    ]);
  });

  it("handles empty input", () => {
    expect(parseSegments("")).toEqual([]);
  });
});

describe("Snippet", () => {
  it("marks matched terms", () => {
    render(<Snippet text="Στης ⟦θάλασσας⟧ τα βάθη" />);

    const mark = screen.getByText("θάλασσας");
    expect(mark.tagName).toBe("MARK");
  });

  /*
   * The security property this whole design exists for. PostgreSQL's
   * ts_headline returns the source lyrics verbatim, so markup a contributor
   * typed arrives here untouched. Because the component renders text nodes
   * rather than parsing HTML, that markup can only ever be displayed.
   */
  it("renders markup in lyrics as text, never as elements", () => {
    const { container } = render(
      <Snippet text={`innocent <img src=x onerror=alert(1)> ⟦θάλασσα⟧ here`} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    // The characters are still shown to the reader, just inertly.
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("does not treat a script tag in lyrics as markup", () => {
    const { container } = render(
      <Snippet text={`<script>alert(1)</script> ⟦match⟧`} />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });
});
