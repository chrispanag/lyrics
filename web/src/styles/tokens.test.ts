// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The color tokens in index.css, held from both sides: every token is defined
 * for both themes and exposed to Tailwind, and no component goes back to
 * writing a neutral shade with a `dark:` twin beside it — the shape the tokens
 * replaced, and the one that drifted.
 */

const SRC = path.join(import.meta.dirname, "..");
const css = readFileSync(path.join(import.meta.dirname, "index.css"), "utf8");

/** The names declared in a token block, which holds declarations only. */
function declared(selector: string): string[] {
  const body = new RegExp(`^\\s*${selector.replace(".", "\\.")} \\{([^}]*)\\}`, "m").exec(css)?.[1];
  if (body === undefined) throw new Error(`index.css has no ${selector} block`);
  return [...body.matchAll(/^\s*--([\w-]+):/gm)].map(([, name]) => name ?? "").sort();
}

describe("color tokens", () => {
  const light = declared(":root");

  it("defines every token for both themes", () => {
    expect(light.length).toBeGreaterThan(0);
    expect(declared(".dark")).toEqual(light);
  });

  // A primitive is a literal; a token is a `var()` of the property it names.
  it("exposes every token to Tailwind under its own name", () => {
    const exposed = [...css.matchAll(/--color-([\w-]+):\s*var\(--\1\)/g)];
    expect(exposed.map((match) => match[1]).sort()).toEqual(light);
  });
});

// Every utility that takes a color, in one list so the two patterns below
// cannot disagree about which ones count.
const COLOR_UTILITY =
  "bg|text|border(?:-[xytrbse])?|divide|ring-offset|ring|outline|placeholder|fill|stroke|decoration|caret|accent|inset-shadow|shadow|from|via|to";
// A color utility on the neutral ramp, or the white that `surface` stands for.
const NEUTRAL = new RegExp(
  `(?<![\\w-])(?:[\\w-]+:)*(?:(?:${COLOR_UTILITY})-stone-\\d+|bg-white(?![\\w-]))`,
  "g",
);
// Any color utility behind the dark variant: the token carries both halves.
const DARK_COLOR = new RegExp(
  `(?<![\\w-])dark:(?:[\\w-]+:)*(?:${COLOR_UTILITY})-(?:[a-z]+-\\d+|white|black)`,
  "g",
);

// The one categorical palette: hues that tell avatars apart, not roles. Its
// neutral entry is one of those hues, so it is exempt from both checks.
const EXEMPT = new Set([path.join("lib", "avatar.ts")]);

describe("components use the tokens", () => {
  const files = readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .filter((name) => !EXEMPT.has(name))
    .map((name) => ({ name, text: readFileSync(path.join(SRC, name), "utf8") }));

  const offenders = (pattern: RegExp) =>
    files.flatMap(({ name, text }) =>
      [...text.matchAll(pattern)].map((match) => `${name}: ${match[0]}`),
    );

  it("write no neutral shade directly", () => {
    expect(files.map(({ name }) => name)).toContain(path.join("components", "buttonStyles.ts"));
    expect(offenders(NEUTRAL)).toEqual([]);
  });

  it("pair no color with a dark: twin", () => {
    expect(offenders(DARK_COLOR)).toEqual([]);
  });

  // Both patterns are only worth anything if they match what they are for.
  it("recognizes the shapes it refuses", () => {
    expect("text-stone-500 hover:bg-stone-100 bg-white".match(NEUTRAL)).toHaveLength(3);
    expect("text-white bg-white/10 bg-surface".match(NEUTRAL)).toEqual(["bg-white"]);
    expect("ring-offset-stone-50 inset-shadow-stone-900".match(NEUTRAL)).toHaveLength(2);
    expect("border-t-stone-200 hover:border-x-stone-300".match(NEUTRAL)).toHaveLength(2);
    expect("dark:border-b-stone-800".match(DARK_COLOR)).toHaveLength(1);
    expect(
      "dark:text-red-400 dark:hover:bg-stone-800 dark:from-stone-800".match(DARK_COLOR),
    ).toHaveLength(3);
    expect("dark:scheme-dark dark:hidden".match(DARK_COLOR)).toBeNull();
  });
});
