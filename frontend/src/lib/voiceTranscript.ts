export type TranscriptLine = {
  id: number;
  role: string;
  text: string;
  interim: boolean;
};

export function applyTranscriptEvent(
  lines: readonly TranscriptLine[],
  event: { role: string; text: string; interim: boolean },
  nextId: number,
): { lines: TranscriptLine[]; nextId: number } {
  const next = lines.slice();
  if (event.interim) {
    for (let index = next.length - 1; index >= 0; index -= 1) {
      const line = next[index];
      if (line && line.role === event.role && line.interim) {
        next[index] = { ...line, text: event.text };
        return { lines: next, nextId };
      }
    }
    return {
      lines: [
        ...next,
        { id: nextId, role: event.role, text: event.text, interim: true },
      ],
      nextId: nextId + 1,
    };
  }
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const line = next[index];
    if (line && line.role === event.role && line.interim) {
      next[index] = { ...line, text: event.text, interim: false };
      return { lines: next, nextId };
    }
  }
  return {
    lines: [
      ...next,
      { id: nextId, role: event.role, text: event.text, interim: false },
    ],
    nextId: nextId + 1,
  };
}

export function commitInterimRole(
  lines: readonly TranscriptLine[],
  role: string,
): TranscriptLine[] {
  let changed = false;
  const next = lines.map((line) => {
    if (line.role !== role || !line.interim) {
      return line;
    }
    changed = true;
    return { ...line, interim: false };
  });
  return changed ? next : [...lines];
}

export function labelForTranscriptRole(
  role: string,
  userRole: string,
  assistantRole: string,
  userLabel: string,
  assistantLabel: string,
): string {
  if (role === userRole) {
    return userLabel;
  }
  if (role === assistantRole) {
    return assistantLabel;
  }
  return role;
}
