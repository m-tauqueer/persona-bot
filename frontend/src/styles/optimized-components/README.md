# Token styles

Styles for the product UI (tokens used by the shell, chat, voice, and dashboard),
split into two layers that are loaded together:

```
oc.tailwind.css   Tailwind layer — only rules whose every declaration maps 1:1 to a utility
                  (display, flex/grid, gap, padding/margin, width/height, position/inset,
                  border-radius, overflow, cursor, text-align/transform, font-weight)

oc.css            Plain CSS — everything else: colour, type, borders, gradients, grain,
                  shadows, transitions, animations, keyframes, media queries
```

The split is **by whole rule, never by individual declaration**, and the Tailwind layer uses
no `border`/`shadow`/`ring` utilities — so it needs no preflight and no border reset. (An earlier
attempt that `@apply`-ed everything and relied on a border-style reset broke the layout.)

## Load order matters

Both files are imported from [`src/main.tsx`](../../main.tsx) and must stay **before**
[`ui.css`](../ui.css). The `oc-*` classes are layered on top of the `ui-btn` / `ui-input`
primitives, and many pairs land at equal specificity, where source order alone decides the
winner. Reordering the imports silently changes the component library's layout.

Sizing that a `ui-*` primitive also owns is set inline rather than in this layer — see
[`ClipButton`](../../components/ui/ClipButton.tsx), whose box and `clip-path` come from the same
geometry so they can never disagree.

## Tailwind setup

- [`tailwind.config.cjs`](../../../tailwind.config.cjs) — `corePlugins.preflight = false` (no global
  reset, so the hand-written CSS on the rest of the app is untouched) and `content` limited to the
  component-library page.
- [`postcss.config.cjs`](../../../postcss.config.cjs) — `tailwindcss` + `autoprefixer`. Tailwind only
  transforms files that use its directives; all other CSS passes through unchanged.

Both layers depend on the design tokens in [`styles/index.css`](../index.css) and
[`styles/fonts.css`](../fonts.css) (the `--accent` / `--text-*` / `--font-*` / `--rule` ladder).
