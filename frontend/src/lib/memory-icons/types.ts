export type MemoryCategory = "Brand" | "Navigation" | "People" | "Actions" | "System" | "UI";

export interface IconSource {
  label: string;
  paths: string[];
  hero?: boolean;
}

export interface MemoryIconDef {
  label: string;
  cat: MemoryCategory;
  inner: string;
  hero?: boolean;
}
