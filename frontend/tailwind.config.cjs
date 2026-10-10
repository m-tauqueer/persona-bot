/** @type {import('tailwindcss').Config} */

/* ============================================================
   Tailwind — SCOPED to the /optimized-components gallery.

   • content is limited to the gallery page, so `@tailwind utilities`
     never emits classes that could leak onto the other (hand-CSS'd)
     pages. `@apply` works regardless of content, so the component
     layer in tailwind/oc.tailwind.css is unaffected by this scope.
   • preflight is OFF — Tailwind must NOT reset/normalize the rest of
     the app, which ships its own base styles in styles/index.css.
   • The brand design tokens (defined in styles/index.css + fonts.css)
     are surfaced as ergonomic utilities, e.g.
       bg-card  text-text-hi  border-rule  font-display  rounded-card
   ============================================================ */
module.exports = {
  content: ["./src/pages/optimized-components/**/*.tsx"],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        accent: "var(--accent)",
        "brand-orange": "var(--brand-orange)",
        "app-bg": "var(--app-bg)",
        panel: "var(--panel)",
        card: "var(--card)",
        "text-hi": "var(--text-hi)",
        "text-mid": "var(--text-mid)",
        "text-lo": "var(--text-lo)",
        "text-faint": "var(--text-faint)",
        "ink-dim": "var(--ink-dim)",
        rule: "var(--rule)",
        "rule-strong": "var(--rule-strong)",
        stroke: "var(--stroke)",
        "stroke-2": "var(--stroke-2)",
        "glass-border": "var(--glass-border)",
        "glass-chip": "var(--glass-chip)",
        "color-error": "var(--color-error)",
      },
      fontFamily: {
        display: "var(--font-display)",
        body: "var(--font-body)",
        ui: "var(--font-ui)",
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
        serif: "var(--font-serif)",
      },
      borderRadius: {
        card: "var(--r-card)",
        pill: "999px",
      },
    },
  },
  plugins: [],
};
