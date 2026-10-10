import { useCallback, useEffect, useRef, useState } from "react";
import { ChatBox, type ChatThreadMessage } from "../../components/chat/ChatBox";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import {
  clearStoredChatSessionId,
  readStoredChatSessionId,
  writeStoredChatSessionId,
} from "../../lib/chatSession";
import {
  ApiError,
  api,
  chatSilenceStatus,
  turnSpeakerPersona,
  turnSpeakerUser,
} from "../../lib/gateway";
import { loadNavConfig } from "../../lib/nav";
import { personaPinField } from "../../lib/personaVoice";
import {
  parsePublishedDirectory,
  type PublishedPersona,
} from "../../lib/publishedPersonas";
import { useSitChrome } from "../../lib/sitChrome";
import { loadUiCopy } from "../../lib/uiCopy";
import { loadVoiceClientConfig } from "../../lib/voiceConfig";
import { useSession } from "../session";
import { AgentSelector } from "../voice/AgentSelector";

type TranscriptTurn = {
  ordinal: number;
  speaker: string;
  text: string;
};

type ChatGetResponse = {
  persona: PublishedPersona;
  session_id?: string;
  turns: TranscriptTurn[];
};

type ChatPostResponse = {
  action: string;
  reply_text: string | null;
  session_id: string;
  reasons: string[];
  recorded?: boolean;
  warning?: string | null;
  warning_code?: string | null;
};

type Banner = {
  tone: "error" | "warning";
  text: string;
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function threadMessages(
  turns: readonly TranscriptTurn[],
  userSpeaker: string,
): ChatThreadMessage[] {
  return turns.map((turn) => ({
    id: String(turn.ordinal),
    role: turn.speaker === userSpeaker ? "user" : "assistant",
    text: turn.text,
  }));
}

function BannerCard({ banner }: { banner: Banner }) {
  return (
    <Card>
      <p
        className="ui-field__error"
        style={banner.tone === "warning" ? { color: "var(--text-mid)" } : undefined}
      >
        {banner.text}
      </p>
    </Card>
  );
}

export function ChatPage() {
  const session = useSession();
  const copy = loadUiCopy();
  const voiceUi = loadVoiceClientConfig();
  const { setSitting } = useSitChrome();
  const { loadingLabel } = loadNavConfig();
  const me = session.status === "ready" ? session.me : null;
  const [boot, setBoot] = useState<"loading" | "ready">("loading");
  const [banner, setBanner] = useState<Banner | null>(null);
  const [directory, setDirectory] = useState<PublishedPersona[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sittingLoad, setSittingLoad] = useState(false);
  const [ending, setEnding] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const picked = directory.find((row) => row.id === pickedId) ?? null;
  const blocked = busy || sittingLoad || ending;

  useEffect(() => {
    setSitting(picked !== null);
    return () => {
      setSitting(false);
    };
  }, [picked, setSitting]);
  const userSpeaker = turnSpeakerUser();
  const personaSpeaker = turnSpeakerPersona();
  const pageStyle = {
    ["--chat-column-max" as string]: `${copy.chatColumnMaxPx}px`,
    ["--chat-thread-min" as string]: `${copy.chatThreadMinPx}px`,
  };

  const applySession = useCallback(
    (userId: string, personaId: string, next: string) => {
      setSessionId(next);
      writeStoredChatSessionId(userId, personaId, next);
    },
    [],
  );

  useEffect(() => {
    if (!me) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const payload = await api<{ personas?: unknown }>("/api/personas");
        if (!cancelled) {
          setDirectory(parsePublishedDirectory(payload));
        }
      } catch (error) {
        if (!cancelled) {
          setBanner({ tone: "error", text: errorMessage(error, copy.requestFailed) });
        }
      } finally {
        if (!cancelled) {
          setBoot("ready");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function loadSitting(userId: string, personaId: string) {
    const stored = readStoredChatSessionId(userId, personaId);
    if (!stored) {
      setSessionId(null);
      setTurns([]);
      return;
    }
    try {
      const history = await api<ChatGetResponse>(
        `/api/chat?session_id=${encodeURIComponent(stored)}`,
      );
      if (history.persona.id !== personaId) {
        clearStoredChatSessionId(userId, personaId);
        setSessionId(null);
        setTurns([]);
        return;
      }
      setTurns(history.turns);
      applySession(userId, personaId, stored);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        clearStoredChatSessionId(userId, personaId);
        setSessionId(null);
        setTurns([]);
        return;
      }
      setBanner({ tone: "error", text: errorMessage(error, copy.requestFailed) });
    }
  }

  async function pickPersona(id: string) {
    if (!me || id === pickedId || blocked) {
      return;
    }
    setPickedId(id);
    setBanner(null);
    setDraft("");
    setTurns([]);
    setSessionId(null);
    setSittingLoad(true);
    try {
      await loadSitting(me.id, id);
    } finally {
      setSittingLoad(false);
    }
  }

  function leaveSitting() {
    if (blocked) {
      return;
    }
    setPickedId(null);
    setBanner(null);
    setDraft("");
    setTurns([]);
    setSessionId(null);
  }

  async function send(text: string) {
    if (!me || !picked || !text || blocked) {
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const pendingOrdinal = (turns.at(-1)?.ordinal ?? 0) + 1;
    setBusy(true);
    setBanner(null);
    setDraft("");
    setTurns((current) => [
      ...current,
      { ordinal: pendingOrdinal, speaker: userSpeaker, text },
    ]);
    let posted: ChatPostResponse | null = null;
    try {
      const payload: Record<string, string> = { text };
      if (sessionId) {
        payload.session_id = sessionId;
      } else {
        payload[personaPinField()] = picked.id;
      }
      posted = await api<ChatPostResponse>("/api/chat", {
        method: "POST",
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      applySession(me.id, picked.id, posted.session_id);
      if (posted.recorded === false) {
        setTurns((current) => {
          if (!posted?.reply_text) {
            return current;
          }
          const lastOrdinal = current.at(-1)?.ordinal ?? pendingOrdinal;
          return [
            ...current,
            {
              ordinal: lastOrdinal + 1,
              speaker: personaSpeaker,
              text: posted.reply_text,
            },
          ];
        });
      } else {
        const history = await api<ChatGetResponse>(
          `/api/chat?session_id=${encodeURIComponent(posted.session_id)}`,
          { signal: controller.signal },
        );
        setTurns(history.turns);
      }
      if (posted.warning) {
        setBanner({ tone: "warning", text: posted.warning });
      } else if (posted.reply_text == null) {
        setBanner({ tone: "warning", text: chatSilenceStatus() });
      }
    } catch (error) {
      if (isAbortError(error)) {
        if (!posted) {
          setTurns((current) => current.filter((turn) => turn.ordinal !== pendingOrdinal));
          setDraft(text);
        }
        return;
      }
      setTurns((current) => current.filter((turn) => turn.ordinal !== pendingOrdinal));
      setDraft(text);
      setBanner({ tone: "error", text: errorMessage(error, copy.requestFailed) });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setBusy(false);
    }
  }

  function stopSend() {
    abortRef.current?.abort();
  }

  async function hangUp() {
    if (!me || !picked || !sessionId || blocked) {
      return;
    }
    abortRef.current?.abort();
    setEnding(true);
    setBanner(null);
    try {
      await api("/api/chat/end", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId }),
      });
      clearStoredChatSessionId(me.id, picked.id);
      setSessionId(null);
      setTurns([]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        clearStoredChatSessionId(me.id, picked.id);
        setSessionId(null);
        setTurns([]);
        return;
      }
      setBanner({ tone: "error", text: errorMessage(error, copy.requestFailed) });
    } finally {
      setEnding(false);
    }
  }

  if (!me || boot === "loading") {
    return (
      <div className="chat-page" style={pageStyle}>
        <p>{loadingLabel}</p>
      </div>
    );
  }

  if (!picked) {
    return (
      <div className="chat-page" style={pageStyle}>
        {banner ? <BannerCard banner={banner} /> : null}
        <AgentSelector
          directory={directory}
          title={copy.personaPickerTitle}
          empty={copy.personaPickerEmpty}
          help={copy.personaPickerChatHelp}
          config={voiceUi}
          onPick={(id) => {
            void pickPersona(id);
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="chat-page chat-page--sit"
      style={pageStyle}
      role="region"
      aria-label={picked.display_name}
    >
      <div className="chat-page__toolbar">
        <Button type="button" variant="glass" disabled={blocked} onClick={leaveSitting}>
          {copy.callBackLabel}
        </Button>
        <div className="chat-page__who">
          <h1 className="chat-page__title">{picked.display_name}</h1>
          <p className="chat-page__handle">@{picked.handle}</p>
        </div>
        <Button
          type="button"
          variant="glass"
          disabled={blocked || !sessionId}
          onClick={() => {
            void hangUp();
          }}
        >
          {copy.chatEndLabel}
        </Button>
      </div>
      {banner ? <BannerCard banner={banner} /> : null}
      <ChatBox
        messages={threadMessages(turns, userSpeaker)}
        empty={copy.personaChatReady}
        thinkingLabel={copy.chatThinkingLabel}
        streaming={busy}
        placeholder={copy.chatInputPlaceholder}
        messageLabel={copy.chatMessageLabel}
        sendLabel={copy.chatSendLabel}
        stopLabel={copy.chatStopLabel}
        inputMaxPx={copy.chatInputMaxPx}
        value={draft}
        onChange={setDraft}
        onSend={(content) => {
          void send(content);
        }}
        onStop={stopSend}
        disabled={sittingLoad || ending}
      />
    </div>
  );
}
