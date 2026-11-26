/*
 * A screen size for a story. The addon sizes the test browser from the
 * viewport global, looking the name up in the options the parameters give it.
 */

function viewport(value: string, name: string, width: number, height: number, type: string) {
  return {
    /** Spread into a story's `parameters`, beside its own. */
    parameters: {
      viewport: {
        options: {
          [value]: { name, styles: { width: `${width}px`, height: `${height}px` }, type },
        },
      },
    },
    /** A story's `globals`, choosing that viewport. */
    globals: { viewport: { value, isRotated: false } },
  };
}

/** A phone's screen: 390×844, an iPhone 12 to 14. */
const phone = viewport("phone", "Phone", 390, 844, "mobile");
export const phoneParameters = phone.parameters;
export const phoneGlobals = phone.globals;

/** A desk's window, at the size a story names. */
export function deskViewport(width: number, height: number) {
  return viewport("desk", "Desk", width, height, "desktop");
}
