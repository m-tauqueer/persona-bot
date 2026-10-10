/* PostCSS pipeline — added for the scoped Tailwind build used by
   /optimized-components. Tailwind only transforms files that contain its
   directives (@tailwind / @apply); every other plain CSS file in the app
   passes straight through. Autoprefixer is purely additive. */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
