import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Section } from "../../components/Section";
import { api } from "../../lib/gateway";
import { loadNavConfig } from "../../lib/nav";
import { matchPattern, navigate, useRoute } from "../../lib/router";
import { dashboardSessionPath, PATTERNS, ROUTES } from "../../lib/routes";
import {
  fetchPersonalSession,
  fetchPersonalSessions,
  type SessionDetail,
  type SessionListItem,
} from "../../lib/insights";
import {
  parsePublishedDirectory,
  type PublishedPersona,
} from "../../lib/publishedPersonas";
import { loadUiCopy } from "../../lib/uiCopy";
import { loadVoiceClientConfig } from "../../lib/voiceConfig";
import { AgentSelector } from "../voice/AgentSelector";
import { useSession } from "../session";
import { EmptyNote, FetchError } from "./FetchState";
import { MemoryPanel } from "./MemoryPanel";
import { SessionRows } from "./SessionRows";
import { SpokenTranscript } from "./Transcripts";

export function PersonalHome() {
  const path = useRoute();
  const params = matchPattern(path, PATTERNS.dashboardSession);
  if (params?.id) {
    return <PersonalSession id={params.id} />;
  }
  return <PersonalIndex />;
}

function PersonalIndex() {
  const session = useSession();
  const nav = loadNavConfig();
  const copy = loadUiCopy();
  const voiceUi = loadVoiceClientConfig();
  const me = session.status === "ready" ? session.me : null;
  const [boot, setBoot] = useState<"loading" | "ready">("loading");
  const [directory, setDirectory] = useState<PublishedPersona[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [rows, setRows] = useState<SessionListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const loadGen = useRef(0);
  const picked = directory.find((row) => row.id === pickedId) ?? null;

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
      } catch (caught) {
        if (!cancelled) {
          setError(caught);
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

  const load = useCallback(
    async (nextCursor?: string) => {
      const gen = ++loadGen.current;
      if (!pickedId) {
        setRows([]);
        setCursor(null);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const page = await fetchPersonalSessions({
          range: copy.defaultRange,
          cursor: nextCursor,
          personaId: pickedId,
        });
        if (gen !== loadGen.current) {
          return;
        }
        setRows((current) =>
          nextCursor ? [...current, ...page.sessions] : page.sessions,
        );
        setCursor(page.next_cursor);
      } catch (caught) {
        if (gen !== loadGen.current) {
          return;
        }
        setError(caught);
      } finally {
        if (gen === loadGen.current) {
          setLoading(false);
        }
      }
    },
    [copy.defaultRange, pickedId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (!me || boot === "loading") {
    return (
      <div className="mc-wrap">
        <p>{nav.loadingLabel}</p>
      </div>
    );
  }

  return (
    <div className="mc-wrap">
      <div className="mc-pagehead">
        <div>
          <h1 className="mc-pagehead__title">
            {picked?.display_name ?? copy.personaPickerTitle}
          </h1>
        </div>
      </div>
      <div className="voice-pick voice-pick--inline">
        <AgentSelector
          directory={directory}
          title={copy.personaPickerTitle}
          empty={copy.personaPickerEmpty}
          help={copy.personaPickerHistoryHelp}
          config={voiceUi}
          pickedId={pickedId}
          onPick={setPickedId}
        />
      </div>
      <Section title={copy.recentTitle} first>
        {error ? <FetchError error={error} onRetry={() => void load()} /> : null}
        {!error && !pickedId ? <EmptyNote text={copy.personaNeedPick} /> : null}
        {!error && pickedId ? (
          <SessionRows
            sessions={rows}
            showUser={false}
            hrefFor={(row) => dashboardSessionPath(row.id)}
          />
        ) : null}
        {cursor ? (
          <div style={{ marginTop: 16 }}>
            <Button type="button" disabled={loading} onClick={() => void load(cursor)}>
              {copy.loadMore}
            </Button>
          </div>
        ) : null}
      </Section>
      <MemoryPanel personaId={pickedId} />
    </div>
  );
}

function PersonalSession({ id }: { id: string }) {
  const nav = loadNavConfig();
  const copy = loadUiCopy();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await fetchPersonalSession(id));
    } catch (caught) {
      setDetail(null);
      setError(caught);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mc-wrap">
      <div className="mc-pagehead">
        <div>
          <h1 className="mc-pagehead__title">{copy.recentTitle}</h1>
        </div>
        <Button type="button" onClick={() => navigate(ROUTES.dashboard)}>
          {copy.backLabel}
        </Button>
      </div>
      {error ? <FetchError error={error} onRetry={() => void load()} /> : null}
      {!error && !detail ? <p>{nav.loadingLabel}</p> : null}
      {detail ? <SpokenTranscript detail={detail} /> : null}
    </div>
  );
}
