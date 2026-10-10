export type PublishedPersona = {
  id: string;
  handle: string;
  display_name: string;
  description: string | null;
};

function asPersona(value: unknown): PublishedPersona | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    row.id.length === 0 ||
    typeof row.handle !== "string" ||
    typeof row.display_name !== "string"
  ) {
    return null;
  }
  return {
    id: row.id,
    handle: row.handle,
    display_name: row.display_name,
    description: typeof row.description === "string" ? row.description : null,
  };
}

export function parsePublishedDirectory(payload: unknown): PublishedPersona[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  const raw = (payload as { personas?: unknown }).personas;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((item) => {
    const persona = asPersona(item);
    return persona ? [persona] : [];
  });
}
