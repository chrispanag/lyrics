/*
 * The two halves of one contract, kept next to each other because they are
 * exactly as useful as their agreement.
 *
 * A song page's tap zones are strips fixed down the left and right edges of the
 * viewport (see `ListSongTapZones`), so they lie over whatever the page puts
 * there. `tapZoneLayer` is what they sit on; `aboveTapZones` is what anything
 * interactive reaching the edge of the column has to sit on to keep answering
 * taps. Stated in two modules, the second number is invisible to whoever tunes
 * the first, and the symptom of a mismatch is a dead Back button on a phone
 * only — never on the desktop where the zones are not rendered at all.
 *
 * Their own module rather than `lib/listContext.ts`, which is otherwise pure
 * logic — URL building and a lookup — and next to the components that wear
 * them, as the other style modules are.
 */

/** The layer the tap zones themselves occupy. */
export const tapZoneLayer = "z-10";

/**
 * Lifts a region above the tap zones.
 *
 * The lyrics and the notes deliberately stay below them, and the lyrics must:
 * their box spans the full width of the column, so lifting it would leave the
 * zones unreachable everywhere the text is — which, while reading, is the whole
 * screen. Neither holds anything interactive, which is what makes them safe to
 * leave. That is also why this is a per-region opt-in rather than one wrapper
 * around the page: a wrapper would establish a stacking context, and nothing
 * inside it could then paint below a fixed element outside it, so the exemption
 * the design needs would have no form to be expressed in.
 */
export const aboveTapZones = "relative z-20";
