// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The tokens in index.css, held from both sides: every color token is defined
 * for both themes and exposed to Tailwind, and no component goes back to
 * writing a neutral shade with a `dark:` twin beside it — the shape the tokens
 * replaced, and the one that drifted — or to a sized radius, shadow or z-index
 * where a role-named one exists.
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

// The start of a class, with any variants in front of it (`hover:`, `sm:`),
// and the end of one. Shared so the patterns below agree on what a class is.
const VARIANTS = "(?:[\\w-]+:)*";
const START = `(?<![\\w-])${VARIANTS}`;
const END = "(?![\\w-])";
// An arbitrary value, `[…]`: a size or color nobody named.
const ARBITRARY = "\\[[^\\]]*\\]";
// Every utility that takes a color, in one list so the patterns below cannot
// disagree about which ones count.
const COLOR_UTILITY =
  "bg|text|border(?:-[xytrbse])?|divide|ring-offset|ring|outline|placeholder|fill|stroke|decoration|caret|accent|inset-shadow|shadow|from|via|to";
// A color utility on the neutral ramp, or white or black, which every
// neutral role (`surface`, `fg-on-fill`, `scrim`) already names.
const NEUTRAL = new RegExp(`${START}(?:${COLOR_UTILITY})-(?:stone-\\d+|white|black)${END}`, "g");
// Any color utility behind the dark variant: the token carries both halves.
const DARK_COLOR = new RegExp(
  `(?<![\\w-])${VARIANTS}dark:${VARIANTS}(?:${COLOR_UTILITY})-(?:[a-z]+-\\d+|white|black)${END}`,
  "g",
);

// A size off Tailwind's own scales, or an arbitrary one, where index.css names
// the role instead: `rounded-card`, `shadow-popover`, `z-dropdown`. A bare
// `rounded` is one of those sizes; `rounded-full` is allowed, fully round
// being a role of its own.
const SCALE = new RegExp(
  `${START}-?(?:rounded(?:-[trblxyse]{1,2})?(?:-(?:xs|sm|md|lg|xl|[2-4]xl|${ARBITRARY}))?|shadow-(?:2xs|xs|sm|md|lg|xl|2xl|${ARBITRARY})|z-(?:\\d+|${ARBITRARY}))${END}`,
  "g",
);

// The one categorical palette: hues that tell avatars apart, not roles. Its
// neutral entry is one of those hues, so it is exempt from the two color
// checks — and only those: its shape is held like everyone else's.
const COLOR_EXEMPT = new Set([path.join("lib", "avatar.ts")]);

describe("components use the tokens", () => {
  const files = readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => ({ name, text: readFileSync(path.join(SRC, name), "utf8") }));

  const offenders = (pattern: RegExp, exempt: ReadonlySet<string> = new Set()) =>
    files
      .filter(({ name }) => !exempt.has(name))
      .flatMap(({ name, text }) =>
        [...text.matchAll(pattern)].map((match) => `${name}: ${match[0]}`),
      );

  it("write no neutral shade directly", () => {
    expect(files.map(({ name }) => name)).toContain(path.join("components", "buttonStyles.ts"));
    expect(offenders(NEUTRAL, COLOR_EXEMPT)).toEqual([]);
  });

  it("pair no color with a dark: twin", () => {
    expect(offenders(DARK_COLOR, COLOR_EXEMPT)).toEqual([]);
  });

  it("take radius, shadow and stacking from the role-named scales", () => {
    expect(offenders(SCALE)).toEqual([]);
  });

  // The patterns are only worth anything if they match what they are for.
  it("recognizes the shapes it refuses", () => {
    expect("text-stone-500 hover:bg-stone-100 bg-white".match(NEUTRAL)).toHaveLength(3);
    expect("text-white bg-white/10 backdrop:bg-black/40 bg-surface".match(NEUTRAL)).toHaveLength(3);
    expect("ring-offset-stone-50 inset-shadow-stone-900".match(NEUTRAL)).toHaveLength(2);
    expect("border-t-stone-200 hover:border-x-stone-300".match(NEUTRAL)).toHaveLength(2);
    expect("dark:border-b-stone-800".match(DARK_COLOR)).toHaveLength(1);
    expect(
      "dark:text-red-400 dark:hover:bg-stone-800 dark:from-stone-800".match(DARK_COLOR),
    ).toHaveLength(3);
    expect("dark:scheme-dark dark:hidden".match(DARK_COLOR)).toBeNull();
    expect("rounded-xl sm:rounded-t-3xl shadow-lg z-30 -z-10".match(SCALE)).toHaveLength(5);
    expect('"rounded px-1" rounded-t shadow-lg/50'.match(SCALE)).toHaveLength(3);
    expect(
      "z-[25] rounded-[0.75rem] rounded-tl-[3px] shadow-[0_1px_2px_black]".match(SCALE),
    ).toHaveLength(4);
    expect("md:dark:bg-stone-800 dark:bg-white/10".match(DARK_COLOR)).toHaveLength(2);
    expect(
      "rounded-full rounded-card rounded-inline rounded-t-sheet shadow-popover z-dropdown shadow-stone-900".match(
        SCALE,
      ),
    ).toBeNull();
  });
});
