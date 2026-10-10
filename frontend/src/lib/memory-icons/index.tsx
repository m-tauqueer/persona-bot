import { BRAND_ICONS } from "./brand";
import { NAVIGATION_ICONS } from "./navigation";
import { PEOPLE_ICONS } from "./people";
import { ACTION_ICONS } from "./actions";
import { SYSTEM_ICONS } from "./system";
import { UI_ICONS } from "./ui";
import type { MemoryIconDef } from "./types";

export type { MemoryCategory, MemoryIconDef } from "./types";
export { MEMORY_CATEGORIES } from "./categories";
export type { CategoryMeta } from "./categories";

export const MEMORY_ICONS: Record<string, MemoryIconDef> = {
  ...BRAND_ICONS,
  ...NAVIGATION_ICONS,
  ...PEOPLE_ICONS,
  ...ACTION_ICONS,
  ...SYSTEM_ICONS,
  ...UI_ICONS,
};

export function iconNamesByCategory(cat: string) {
  return Object.keys(MEMORY_ICONS).filter((name) => MEMORY_ICONS[name].cat === cat);
}

export function MemoryIcon({ name, size = 24, weight = 1.75 }: {
  name: string;
  size?: number;
  weight?: number;
}) {
  const icon = MEMORY_ICONS[name];
  if (!icon) return null;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: icon.inner }}
    />
  );
}

export function memoryIconSvg(name: string, weight: number) {
  const inner = MEMORY_ICONS[name].inner.replace(/\n/g, "\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round">\n  ${inner}\n</svg>`;
}
