import type { MemoryCategory } from "./types";

export interface CategoryMeta {
  id: MemoryCategory;
  description: string;
}

export const MEMORY_CATEGORIES: CategoryMeta[] = [
  { id: "Brand", description: "Memory-native marks that reuse the node + bridge motif." },
  { id: "Navigation", description: "Primary sidebar destinations." },
  { id: "People", description: "Members, teams, identity." },
  { id: "Actions", description: "Verbs the user performs on a memory." },
  { id: "System", description: "Data, settings, account, status." },
  { id: "UI", description: "Chrome, controls, layout." },
];
