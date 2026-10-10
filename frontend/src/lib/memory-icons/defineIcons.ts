import type { IconSource, MemoryCategory, MemoryIconDef } from "./types";

export function defineIcons(cat: MemoryCategory, sources: Record<string, IconSource>) {
  const icons: Record<string, MemoryIconDef> = {};

  for (const [name, { label, paths, hero }] of Object.entries(sources)) {
    icons[name] = { label, cat, inner: paths.join("\n") };
    if (hero) icons[name].hero = true;
  }

  return icons;
}
