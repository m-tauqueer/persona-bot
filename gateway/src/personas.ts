import type postgres from "postgres";
import { z } from "zod";

type Sql = ReturnType<typeof postgres>;

export type CatalogPersona = {
  id: string;
  engramPersonaId: string;
  handle: string;
  displayName: string;
  description: string | null;
  published: boolean;
  voiceConfig: Record<string, unknown>;
};

type PersonaRow = {
  id: string;
  engram_persona_id: string;
  handle: string;
  display_name: string;
  description: string | null;
  published: boolean;
  voice_config?: unknown;
};

function asVoiceConfig(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function mapPersona(row: PersonaRow): CatalogPersona {
  return {
    id: row.id,
    engramPersonaId: row.engram_persona_id,
    handle: row.handle,
    displayName: row.display_name,
    description: row.description,
    published: row.published,
    voiceConfig: asVoiceConfig(row.voice_config),
  };
}

export function resolveSpeakModel(
  voiceConfig: Record<string, unknown>,
  ttsKey: string,
  fallback: string | undefined,
): string | undefined {
  const raw = voiceConfig[ttsKey];
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return fallback;
}

export function parseOptionalPersonaId(
  source: unknown,
  field: string,
): { ok: true; id?: string } | { ok: false } {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return { ok: true };
  }
  const raw = (source as Record<string, unknown>)[field];
  if (raw === undefined || raw === "") {
    return { ok: true };
  }
  const parsed = z.string().uuid().safeParse(raw);
  if (!parsed.success) {
    return { ok: false };
  }
  return { ok: true, id: parsed.data };
}

export function personaPublicPayload(persona: CatalogPersona) {
  return {
    id: persona.id,
    handle: persona.handle,
    display_name: persona.displayName,
    description: persona.description,
  };
}

export async function listLocalPersonas(sql: Sql): Promise<CatalogPersona[]> {
  const rows = await sql<PersonaRow[]>`
    SELECT id, engram_persona_id, handle, display_name, description, published
    FROM personas
    ORDER BY created_at
  `;
  return rows.map(mapPersona);
}

export async function listPublishedPersonas(
  sql: Sql,
): Promise<CatalogPersona[]> {
  const rows = await sql<PersonaRow[]>`
    SELECT id, engram_persona_id, handle, display_name, description, published
    FROM personas
    WHERE published = true
    ORDER BY created_at
  `;
  return rows.map(mapPersona);
}

export async function getPersonaById(
  sql: Sql,
  personaId: string,
): Promise<CatalogPersona | null> {
  const rows = await sql<PersonaRow[]>`
    SELECT id, engram_persona_id, handle, display_name, description, published,
           voice_config
    FROM personas
    WHERE id = ${personaId}
  `;
  const row = rows[0];
  return row ? mapPersona(row) : null;
}

export async function getPublishedPersonaById(
  sql: Sql,
  personaId: string,
): Promise<CatalogPersona | null> {
  const persona = await getPersonaById(sql, personaId);
  if (!persona || !persona.published) {
    return null;
  }
  return persona;
}
