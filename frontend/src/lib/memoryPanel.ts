export function memoryPanelReloadKey(
  userId: string | undefined,
  status: string,
  personaId: string | undefined,
): string {
  return `${status}:${userId ?? ""}:${personaId ?? ""}`;
}
