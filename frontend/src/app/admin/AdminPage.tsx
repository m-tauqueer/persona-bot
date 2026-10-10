import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Input, Textarea } from "../../components/ui/Input";
import { ApiError, api } from "../../lib/gateway";
import { loadNavConfig } from "../../lib/nav";
import {
  adminPersonaQuery,
  mergePersonaVoices,
  personaFishKey,
  personaPinField,
  personaProviderAura,
  personaProviderFish,
  personaProviderKey,
  personaTtsKey,
  splitVoiceConfig,
} from "../../lib/personaVoice";
import { loadUiCopy } from "../../lib/uiCopy";
import { useSession } from "../session";

type Persona = {
  id: string;
  engram_persona_id: string;
  handle: string;
  display_name: string;
  description: string | null;
  voice_config: Record<string, unknown>;
  published: boolean;
};

type ShowResponse = {
  persona: Persona | null;
  personas?: Persona[];
  engram: Record<string, unknown> | null;
  subscriptions: Array<{
    status: string;
    email: string;
    engram_user_id: string;
  }>;
};

type QuestionsResponse = {
  questions: unknown[];
  coverage: unknown;
};

const wrapStyle: CSSProperties = {
  maxWidth: 840,
  margin: "0 auto",
  display: "grid",
  gap: 18,
};

const headStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
};

const listButtonStyle: CSSProperties = {
  width: "100%",
  textAlign: "left",
  background: "transparent",
  border: 0,
  color: "var(--text-hi)",
  cursor: "pointer",
  padding: "10px 0",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

function questionKey(item: unknown): string | null {
  if (!item || typeof item !== "object") {
    return typeof item === "string" ? item : null;
  }
  const record = item as Record<string, unknown>;
  const candidates = [record.question_key, record.key, record.id];
  for (const value of candidates) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

function questionLabel(item: unknown): string {
  if (typeof item === "string") {
    return item;
  }
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    const candidates = [record.text, record.prompt, record.question, record.label];
    for (const value of candidates) {
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
    return JSON.stringify(item);
  }
  return JSON.stringify(item);
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function emptyForm() {
  return {
    engramPersonaId: "",
    handle: "",
    displayName: "",
    description: "",
    ttsVoice: "",
    fishVoice: "",
    provider: personaProviderAura(),
    voiceConfig: "{}",
  };
}

function formFromPersona(
  persona: Persona,
  ttsKey: string,
  fishKey: string,
  providerKey: string,
  auraValue: string,
) {
  const split = splitVoiceConfig(
    persona.voice_config ?? {},
    ttsKey,
    fishKey,
    providerKey,
    auraValue,
  );
  return {
    engramPersonaId: persona.engram_persona_id,
    handle: persona.handle,
    displayName: persona.display_name,
    description: persona.description ?? "",
    ttsVoice: split.ttsVoice,
    fishVoice: split.fishVoice,
    provider: split.provider,
    voiceConfig: JSON.stringify(split.style, null, 2),
  };
}

export function AdminPage() {
  const session = useSession();
  const copy = loadUiCopy();
  const { loadingLabel, notOwnerMessage, signIn } = loadNavConfig();
  const me = session.status === "ready" ? session.me : null;
  const ttsKey = personaTtsKey();
  const fishKey = personaFishKey();
  const providerKey = personaProviderKey();
  const auraValue = personaProviderAura();
  const fishValue = personaProviderFish();
  const pinField = personaPinField();
  const [boot, setBoot] = useState<"loading" | "ready">("loading");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [subscriptions, setSubscriptions] = useState<ShowResponse["subscriptions"]>([]);

  const [teachText, setTeachText] = useState("");
  const [questions, setQuestions] = useState<unknown[]>([]);
  const [coverage, setCoverage] = useState<unknown>(null);
  const [answerKey, setAnswerKey] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [subscribeUser, setSubscribeUser] = useState("");
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  const [destroyConfirm, setDestroyConfirm] = useState("");
  const loadSeq = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const selected = personas.find((row) => row.id === selectedId) ?? null;

  const applyShown = useCallback(
    (shown: ShowResponse, preferId?: string | null) => {
      const rows = shown.personas ?? (shown.persona ? [shown.persona] : []);
      setPersonas(rows);
      const nextId =
        preferId ??
        shown.persona?.id ??
        (rows.length === 1 ? rows[0]?.id : selectedIdRef.current);
      const next = rows.find((row) => row.id === nextId) ?? null;
      setSelectedId(next?.id ?? null);
      if (next) {
        setForm(formFromPersona(next, ttsKey, fishKey, providerKey, auraValue));
        setAdding(false);
      }
      setSubscriptions(shown.subscriptions ?? []);
      return next;
    },
    [ttsKey, fishKey, providerKey, auraValue],
  );

  const loadPersona = useCallback(
    async (personaId?: string | null) => {
      const seq = ++loadSeq.current;
      const query = personaId ? `?${adminPersonaQuery(personaId)}` : "";
      const shown = await api<ShowResponse>(`/api/admin/persona${query}`);
      if (seq !== loadSeq.current) {
        return null;
      }
      return applyShown(shown, personaId);
    },
    [applyShown],
  );

  const loadQuestions = useCallback(async (personaId: string) => {
    const payload = await api<QuestionsResponse>(
      `/api/admin/questions?${adminPersonaQuery(personaId)}`,
    );
    setQuestions(payload.questions ?? []);
    setCoverage(payload.coverage);
    return payload;
  }, []);

  useEffect(() => {
    if (!me) {
      return;
    }
    let cancelled = false;
    (async () => {
      if (!me.owner) {
        setBoot("ready");
        return;
      }
      try {
        const next = await loadPersona();
        if (next) {
          try {
            await loadQuestions(next.id);
          } catch {
            // questions require a recorded persona that Engram still has
          }
        }
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) {
          setStatus(errorMessage(error, copy.fetchError));
        }
      }
      if (!cancelled) {
        setBoot("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [copy.fetchError, loadPersona, loadQuestions, me]);

  async function run(label: string, op: () => Promise<void>) {
    setBusy(label);
    setStatus(null);
    try {
      await op();
    } catch (error) {
      setStatus(errorMessage(error, copy.fetchError));
    } finally {
      setBusy(null);
    }
  }

  function parseStyle(): Record<string, unknown> {
    const parsed = JSON.parse(form.voiceConfig) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(copy.personaVoiceInvalid);
    }
    return parsed as Record<string, unknown>;
  }

  function writePayload(extra: Record<string, unknown> = {}) {
    return {
      handle: form.handle || undefined,
      display_name: form.displayName || undefined,
      description: form.description,
      voice_config: mergePersonaVoices(
        parseStyle(),
        form.ttsVoice,
        ttsKey,
        form.fishVoice,
        fishKey,
        form.provider,
        providerKey,
      ),
      tts_voice: form.ttsVoice,
      fish_voice: form.fishVoice,
      voice_provider: form.provider,
      ...extra,
    };
  }

  async function selectExisting(id: string) {
    setAdding(false);
    setStatus(null);
    const next = await loadPersona(id);
    if (next) {
      try {
        await loadQuestions(next.id);
      } catch {
        setQuestions([]);
        setCoverage(null);
      }
    }
  }

  function startAdd() {
    loadSeq.current += 1;
    setAdding(true);
    setSelectedId(null);
    setForm(emptyForm());
    setSubscriptions([]);
    setQuestions([]);
    setCoverage(null);
    setStatus(null);
  }

  async function togglePublished(persona: Persona) {
    const nextPublished = !persona.published;
    await api("/api/admin/persona/publish", {
      method: "POST",
      body: JSON.stringify({
        [pinField]: persona.id,
        published: nextPublished,
      }),
    });
    await loadPersona(persona.id);
    await session.reloadPersona();
    setStatus(nextPublished ? copy.personaPublished : copy.personaUnpublished);
  }

  // Publishing is safe. Taking a persona away from members mid-call is not,
  // so that direction asks first.
  function requestPublishToggle(persona: Persona) {
    if (persona.published) {
      setConfirmingUnpublish(true);
      return;
    }
    void run("publish", async () => {
      await togglePublished(persona);
    });
  }

  async function destroyPersona(persona: Persona) {
    await api("/api/admin/persona/destroy", {
      method: "POST",
      body: JSON.stringify({
        [pinField]: persona.id,
        confirmation: destroyConfirm,
      }),
    });
    setDestroyConfirm("");
    loadSeq.current += 1;
    setSelectedId(null);
    setSubscriptions([]);
    setQuestions([]);
    setCoverage(null);
    await loadPersona();
    await session.reloadPersona();
    setStatus(copy.personaDestroyed);
  }

  if (!me || boot === "loading") {
    return (
      <div style={wrapStyle}>
        <p>{loadingLabel}</p>
      </div>
    );
  }

  if (!me.owner) {
    return (
      <div style={wrapStyle}>
        <Card>
          <h1 className="mc-pagehead__title" style={{ marginBottom: 8 }}>
            {signIn.personaTitle}
          </h1>
          <p style={{ color: "var(--text-mid)" }}>{notOwnerMessage}</p>
        </Card>
      </div>
    );
  }

  const canOperate = selected !== null && !adding;

  return (
    <div style={wrapStyle}>
      <div style={headStyle}>
        <div>
          <h1 className="mc-pagehead__title">{signIn.personaTitle}</h1>
          <p style={{ color: "var(--text-mid)", marginTop: 8 }}>
            {copy.personaCatalogHelp}
          </p>
        </div>
        <Badge tone="accent">Owner</Badge>
      </div>

      {status && (
        <Card>
          <p className="ui-field__error">{status}</p>
        </Card>
      )}

      <Card>
        <div style={{ ...headStyle, marginBottom: 14 }}>
          <h2 className="mc-sec__title">{copy.personaListTitle}</h2>
          <Button size="sm" disabled={busy !== null} onClick={startAdd}>
            {copy.personaAddLabel}
          </Button>
        </div>
        {personas.length === 0 ? (
          <p style={{ color: "var(--text-mid)" }}>{copy.personaListEmpty}</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {personas.map((row) => (
              <li key={row.id} style={{ borderTop: "1px solid var(--line, #333)" }}>
                <button
                  type="button"
                  style={listButtonStyle}
                  aria-pressed={row.id === selectedId}
                  onClick={() => {
                    setAdding(false);
                    setStatus(null);
                    setSelectedId(row.id);
                    setForm(formFromPersona(row, ttsKey, fishKey, providerKey, auraValue));
                    void run("select", async () => {
                      await selectExisting(row.id);
                    });
                  }}
                >
                  <span>
                    {row.display_name}{" "}
                    <span style={{ color: "var(--text-mid)" }}>@{row.handle}</span>
                  </span>
                  <Badge tone={row.published ? "positive" : "neutral"}>
                    {row.published
                      ? copy.personaPublishedBadge
                      : copy.personaDraftBadge}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {adding && (
        <>
          <Card>
            <h2 className="mc-sec__title" style={{ marginBottom: 8 }}>
              {copy.personaCreateTitle}
            </h2>
            <p style={{ color: "var(--text-mid)", marginBottom: 16 }}>
              {copy.personaCreateHelp}
            </p>
            <div style={{ display: "grid", gap: 12 }}>
              <Input
                label={copy.personaNameLabel}
                value={form.displayName}
                onChange={(event) =>
                  setForm((current) => ({ ...current, displayName: event.target.value }))
                }
              />
              <Input
                label={copy.personaHandleLabel}
                value={form.handle}
                onChange={(event) =>
                  setForm((current) => ({ ...current, handle: event.target.value }))
                }
              />
              <Textarea
                label={copy.personaDescriptionLabel}
                rows={3}
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
              />
              <Input
                label={copy.personaTtsLabel}
                value={form.ttsVoice}
                onChange={(event) =>
                  setForm((current) => ({ ...current, ttsVoice: event.target.value }))
                }
              />
              <Input
                label={copy.personaFishLabel}
                value={form.fishVoice}
                onChange={(event) =>
                  setForm((current) => ({ ...current, fishVoice: event.target.value }))
                }
              />
              <p style={{ color: "var(--text-mid)", margin: 0 }}>{copy.personaProviderHelp}</p>
              <div
                style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
                role="group"
                aria-label={copy.personaProviderLabel}
              >
                <Button
                  type="button"
                  variant={form.provider === auraValue ? "solid" : "glass"}
                  aria-pressed={form.provider === auraValue}
                  onClick={() =>
                    setForm((current) => ({ ...current, provider: auraValue }))
                  }
                >
                  {copy.personaProviderAuraLabel}
                </Button>
                <Button
                  type="button"
                  variant={form.provider === fishValue ? "solid" : "glass"}
                  aria-pressed={form.provider === fishValue}
                  onClick={() =>
                    setForm((current) => ({ ...current, provider: fishValue }))
                  }
                >
                  {copy.personaProviderFishLabel}
                </Button>
              </div>
              <Button
                variant="solid"
                disabled={busy !== null}
                onClick={() =>
                  run("create", async () => {
                    try {
                      const created = await api<ShowResponse>("/api/admin/persona", {
                        method: "PUT",
                        body: JSON.stringify(
                          writePayload({ create_remote: true }),
                        ),
                      });
                      if (created.persona?.id) {
                        await loadPersona(created.persona.id);
                        try {
                          await loadQuestions(created.persona.id);
                        } catch {
                          setQuestions([]);
                          setCoverage(null);
                        }
                      }
                      await session.reloadPersona();
                      setStatus(copy.personaCreated);
                    } catch (error) {
                      if (error instanceof ApiError && error.status === 403) {
                        setStatus(copy.personaCreateForbidden);
                        return;
                      }
                      throw error;
                    }
                  })
                }
              >
                {busy === "create" ? copy.personaCreatingLabel : copy.personaCreateLabel}
              </Button>
            </div>
          </Card>

          <Card>
            <h2 className="mc-sec__title" style={{ marginBottom: 8 }}>
              {copy.personaLinkTitle}
            </h2>
            <p style={{ color: "var(--text-mid)", marginBottom: 16 }}>
              {copy.personaLinkHelp}
            </p>
            <div style={{ display: "grid", gap: 12 }}>
              <Input
                label={copy.personaEngramIdLabel}
                value={form.engramPersonaId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    engramPersonaId: event.target.value,
                  }))
                }
              />
              <Button
                variant="solid"
                disabled={busy !== null}
                onClick={() =>
                  run("link", async () => {
                    const linked = await api<ShowResponse>("/api/admin/persona", {
                      method: "PUT",
                      body: JSON.stringify(
                        writePayload({
                          engram_persona_id: form.engramPersonaId || undefined,
                        }),
                      ),
                    });
                    if (linked.persona?.id) {
                      await loadPersona(linked.persona.id);
                      try {
                        await loadQuestions(linked.persona.id);
                      } catch {
                        setQuestions([]);
                        setCoverage(null);
                      }
                    }
                    await session.reloadPersona();
                    setStatus(copy.personaLinked);
                  })
                }
              >
                {busy === "link" ? copy.personaLinkingLabel : copy.personaLinkLabel}
              </Button>
            </div>
          </Card>
        </>
      )}

      {canOperate && selected && (
        <>
          <Card>
            <div style={{ ...headStyle, marginBottom: 14 }}>
              <h2 className="mc-sec__title">{selected.display_name}</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Badge tone={selected.published ? "positive" : "neutral"}>
                  {selected.published
                    ? copy.personaPublishedBadge
                    : copy.personaDraftBadge}
                </Badge>
                <Button
                  variant="solid"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => requestPublishToggle(selected)}
                >
                  {selected.published
                    ? copy.personaUnpublishLabel
                    : copy.personaPublishLabel}
                </Button>
              </div>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              <Input
                label={copy.personaEngramIdLabel}
                value={form.engramPersonaId}
                readOnly
              />
              <Input
                label={copy.personaHandleLabel}
                value={form.handle}
                onChange={(event) =>
                  setForm((current) => ({ ...current, handle: event.target.value }))
                }
              />
              <Input
                label={copy.personaNameLabel}
                value={form.displayName}
                onChange={(event) =>
                  setForm((current) => ({ ...current, displayName: event.target.value }))
                }
              />
              <Textarea
                label={copy.personaDescriptionLabel}
                rows={3}
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
              />
              <Input
                label={copy.personaTtsLabel}
                value={form.ttsVoice}
                onChange={(event) =>
                  setForm((current) => ({ ...current, ttsVoice: event.target.value }))
                }
              />
              <p style={{ color: "var(--text-mid)", margin: 0 }}>{copy.personaTtsHelp}</p>
              <Input
                label={copy.personaFishLabel}
                value={form.fishVoice}
                onChange={(event) =>
                  setForm((current) => ({ ...current, fishVoice: event.target.value }))
                }
              />
              <p style={{ color: "var(--text-mid)", margin: 0 }}>{copy.personaFishHelp}</p>
              <p style={{ color: "var(--text-mid)", margin: 0 }}>{copy.personaProviderHelp}</p>
              <div
                style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
                role="group"
                aria-label={copy.personaProviderLabel}
              >
                <Button
                  type="button"
                  variant={form.provider === auraValue ? "solid" : "glass"}
                  aria-pressed={form.provider === auraValue}
                  onClick={() =>
                    setForm((current) => ({ ...current, provider: auraValue }))
                  }
                >
                  {copy.personaProviderAuraLabel}
                </Button>
                <Button
                  type="button"
                  variant={form.provider === fishValue ? "solid" : "glass"}
                  aria-pressed={form.provider === fishValue}
                  onClick={() =>
                    setForm((current) => ({ ...current, provider: fishValue }))
                  }
                >
                  {copy.personaProviderFishLabel}
                </Button>
              </div>
              <Textarea
                label={copy.personaVoiceJsonLabel}
                rows={6}
                value={form.voiceConfig}
                onChange={(event) =>
                  setForm((current) => ({ ...current, voiceConfig: event.target.value }))
                }
              />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button
                  variant="solid"
                  disabled={busy !== null}
                  onClick={() =>
                    run("save", async () => {
                      await api("/api/admin/persona", {
                        method: "PUT",
                        body: JSON.stringify(
                          writePayload({ [pinField]: selected.id }),
                        ),
                      });
                      await loadPersona(selected.id);
                      await session.reloadPersona();
                      setStatus(copy.personaSaved);
                    })
                  }
                >
                  {busy === "save" ? copy.personaSavingLabel : copy.personaSaveLabel}
                </Button>
                <Button
                  disabled={busy !== null}
                  onClick={() => requestPublishToggle(selected)}
                >
                  {selected.published
                    ? copy.personaUnpublishLabel
                    : copy.personaPublishLabel}
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="mc-sec__title" style={{ marginBottom: 8 }}>
              {copy.personaCloneTitle}
            </h2>
            <p style={{ color: "var(--text-mid)", marginTop: 0 }}>
              {copy.personaCloneHelp}
            </p>
            <input
              type="file"
              aria-label={copy.personaCloneFileLabel}
              accept={copy.personaCloneAccept}
              onChange={(event) => setCloneFile(event.target.files?.[0] ?? null)}
            />
            <div style={{ marginTop: 12 }}>
              <Button
                disabled={busy !== null || !cloneFile}
                onClick={() =>
                  run("clone", async () => {
                    if (!cloneFile) return;
                    const body = new FormData();
                    body.append("file", cloneFile);
                    await api(
                      `/api/admin/persona/clone?${adminPersonaQuery(selected.id)}`,
                      { method: "POST", body },
                    );
                    setCloneFile(null);
                    await loadPersona(selected.id);
                    setStatus(copy.personaCloned);
                  })
                }
              >
                {busy === "clone" ? copy.personaCloningLabel : copy.personaCloneButton}
              </Button>
            </div>
          </Card>

          {confirmingUnpublish && (
            <Card>
              <h2 className="mc-sec__title" style={{ marginBottom: 10 }}>
                {copy.personaUnpublishConfirmTitle}
              </h2>
              <p style={{ color: "var(--text-mid)", marginTop: 0 }}>
                {copy.personaUnpublishConfirmBody}
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button
                  variant="danger"
                  disabled={busy !== null}
                  onClick={() =>
                    run("unpublish", async () => {
                      await togglePublished(selected);
                      setConfirmingUnpublish(false);
                    })
                  }
                >
                  {copy.personaUnpublishConfirmLabel}
                </Button>
                <Button
                  disabled={busy !== null}
                  onClick={() => setConfirmingUnpublish(false)}
                >
                  {copy.personaConfirmCancelLabel}
                </Button>
              </div>
            </Card>
          )}

          <Card>
            <h2 className="mc-sec__title" style={{ marginBottom: 14 }}>
              {copy.personaTeachTitle}
            </h2>
            <Textarea
              label={copy.personaTeachLabel}
              rows={4}
              value={teachText}
              onChange={(event) => setTeachText(event.target.value)}
            />
            <div style={{ marginTop: 12 }}>
              <Button
                disabled={busy !== null}
                onClick={() =>
                  run("teach", async () => {
                    await api("/api/admin/teach", {
                      method: "POST",
                      body: JSON.stringify({
                        [pinField]: selected.id,
                        text: teachText,
                      }),
                    });
                    setTeachText("");
                    setStatus(copy.personaTaught);
                  })
                }
              >
                {busy === "teach" ? copy.personaTeachingLabel : copy.personaTeachButton}
              </Button>
            </div>
          </Card>

          <Card>
            <h2 className="mc-sec__title" style={{ marginBottom: 8 }}>
              {copy.personaQuestionsTitle}
            </h2>
            <p style={{ color: "var(--text-mid)", marginBottom: 12 }}>
              {copy.personaQuestionsCoverage}:{" "}
              {coverage === null || coverage === undefined ? "—" : String(coverage)}
            </p>
            {questions.length === 0 ? (
              <p style={{ color: "var(--text-mid)", marginBottom: 12 }}>
                {copy.personaQuestionsEmpty}
              </p>
            ) : (
              <ul style={{ margin: "0 0 16px", paddingLeft: 18, color: "var(--text-mid)" }}>
                {questions.map((item, index) => (
                  <li key={questionKey(item) ?? String(index)} style={{ marginBottom: 8 }}>
                    <button
                      type="button"
                      className="ui-btn ui-btn--ghost ui-btn--sm"
                      onClick={() => {
                        const key = questionKey(item);
                        if (key) setAnswerKey(key);
                      }}
                    >
                      {copy.personaQuestionsUseKey}
                    </button>{" "}
                    {questionLabel(item)}
                  </li>
                ))}
              </ul>
            )}
            <div style={{ display: "grid", gap: 12 }}>
              <Input
                label={copy.personaQuestionsKey}
                value={answerKey}
                onChange={(event) => setAnswerKey(event.target.value)}
              />
              <Textarea
                label={copy.personaQuestionsAnswer}
                rows={3}
                value={answerText}
                onChange={(event) => setAnswerText(event.target.value)}
              />
              <div style={{ display: "flex", gap: 10 }}>
                <Button
                  disabled={busy !== null}
                  onClick={() =>
                    run("questions", async () => {
                      await loadQuestions(selected.id);
                      setStatus(copy.personaQuestionsRefreshed);
                    })
                  }
                >
                  {copy.personaQuestionsRefresh}
                </Button>
                <Button
                  variant="solid"
                  disabled={busy !== null}
                  onClick={() =>
                    run("answer", async () => {
                      await api("/api/admin/answer", {
                        method: "POST",
                        body: JSON.stringify({
                          [pinField]: selected.id,
                          question_key: answerKey,
                          text: answerText,
                        }),
                      });
                      setAnswerText("");
                      await loadQuestions(selected.id);
                      setStatus(copy.personaQuestionsSaved);
                    })
                  }
                >
                  {copy.personaQuestionsSave}
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="mc-sec__title" style={{ marginBottom: 14 }}>
              {copy.personaIngestTitle}
            </h2>
            <input
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <div style={{ marginTop: 12 }}>
              <Button
                disabled={busy !== null || !file}
                onClick={() =>
                  run("ingest", async () => {
                    if (!file) return;
                    const body = new FormData();
                    body.append("file", file);
                    await api(
                      `/api/admin/ingest?${adminPersonaQuery(selected.id)}`,
                      { method: "POST", body },
                    );
                    setStatus(copy.personaIngested);
                  })
                }
              >
                {busy === "ingest" ? copy.personaIngestingLabel : copy.personaIngestButton}
              </Button>
            </div>
          </Card>

          <Card>
            <h2 className="mc-sec__title" style={{ marginBottom: 14 }}>
              {copy.personaSubscribeTitle}
            </h2>
            <Input
              label={copy.personaSubscribeUser}
              value={subscribeUser}
              onChange={(event) => setSubscribeUser(event.target.value)}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <Button
                variant="solid"
                disabled={busy !== null || subscribeUser.trim().length === 0}
                onClick={() =>
                  run("subscribe", async () => {
                    await api("/api/admin/subscribe", {
                      method: "POST",
                      body: JSON.stringify({
                        [pinField]: selected.id,
                        user: subscribeUser,
                      }),
                    });
                    await loadPersona(selected.id);
                    setStatus(copy.personaSubscribed);
                  })
                }
              >
                {copy.personaSubscribeButton}
              </Button>
            </div>
            {subscriptions.length > 0 && (
              <ul style={{ marginTop: 16, paddingLeft: 18, color: "var(--text-mid)" }}>
                {subscriptions.map((row) => (
                  <li key={row.engram_user_id}>
                    {row.email} · {row.status}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mc-sec__title" style={{ marginBottom: 10 }}>
              {copy.personaDestroyTitle}
            </h2>
            <p style={{ color: "var(--text-mid)", marginTop: 0 }}>
              {copy.personaDestroyBody}
            </p>
            <p style={{ color: "var(--text-mid)" }}>
              {copy.personaDestroyHint} <code>{selected.handle}</code>
            </p>
            <Input
              label={copy.personaDestroyConfirmLabel}
              value={destroyConfirm}
              onChange={(event) => setDestroyConfirm(event.target.value)}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <Button
                variant="danger"
                disabled={
                  busy !== null || destroyConfirm.trim() !== selected.handle
                }
                onClick={() =>
                  run("destroy", async () => {
                    await destroyPersona(selected);
                  })
                }
              >
                {busy === "destroy"
                  ? copy.personaDestroyingLabel
                  : copy.personaDestroyLabel}
              </Button>
            </div>
          </Card>
        </>
      )}

      {!canOperate && !adding && personas.length > 1 && (
        <Card>
          <p style={{ color: "var(--text-mid)" }}>{copy.personaSelectFirst}</p>
        </Card>
      )}
    </div>
  );
}
