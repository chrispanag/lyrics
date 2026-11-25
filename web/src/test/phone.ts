/*
 * A phone's screen for a story: 390×844, an iPhone 12 to 14. The addon sizes
 * the test browser from the viewport global, looking the name up in the
 * options the parameters give it.
 */

/** Spread into a story's `parameters`, beside its own. */
export const phoneParameters = {
  viewport: {
    options: {
      phone: { name: "Phone", styles: { width: "390px", height: "844px" }, type: "mobile" },
    },
  },
} as const;

/** A story's `globals`, choosing that viewport. */
export const phoneGlobals = { viewport: { value: "phone", isRotated: false } } as const;
