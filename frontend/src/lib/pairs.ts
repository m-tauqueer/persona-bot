export type Labeled = { id: string; label: string };

export function parseLabeledList(raw: string, name: string): Labeled[] {
  const items: Labeled[] = [];
  const seen = new Set<string>();
  for (const entry of raw.split(/[;\n]+/)) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const parts = trimmed.split("|").map((part) => part.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid ${name} entry: ${trimmed}`);
    }
    const [id, label] = parts;
    if (seen.has(id)) {
      throw new Error(`Duplicate ${name} id: ${id}`);
    }
    seen.add(id);
    items.push({ id, label });
  }
  if (items.length === 0) {
    throw new Error(`${name} is empty`);
  }
  return items;
}

export function labelFor(items: readonly Labeled[], id: string): string {
  return items.find((item) => item.id === id)?.label ?? id;
}
