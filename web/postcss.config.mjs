// Tailwind v4 through PostCSS, which is how it reaches a Next build. The Vite
// plugin (@tailwindcss/vite) it replaces does not apply here; src/styles/index.css
// is unchanged, since the `@import "tailwindcss"` entry is the same either way.
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
