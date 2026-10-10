import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Segmented } from "../../components/ui/Segmented";
import { api } from "../../lib/gateway";
import { loadNavConfig } from "../../lib/nav";
import { personaPinField } from "../../lib/personaVoice";
import {
  parsePublishedDirectory,
  type PublishedPersona,
} from "../../lib/publishedPersonas";
import {
  matchPattern,
  navigate,
  useRoute,
  useSearchParams,
} from "../../lib/router";
import { adminSessionPath, PATTERNS, ROUTES } from "../../lib/routes";
import {
  fetchOwnerSession,
  fetchOwnerSessions,
  type SessionDetail,
  type SessionListItem,
} from "../../lib/insights";
import { loadUiCopy } from "../../lib/uiCopy";
import { PersonaPicker } from "../PersonaPicker";
import { EmptyNote, FetchError } from "../dashboard/FetchState";
import { SessionRows } from "../dashboard/SessionRows";
import { SessionReconstruct } from "../dashboard/Transcripts";

export function ConversationsPage() {
  const path = useRoute();
  const params = matchPattern(path, PATTERNS.adminSession);
  if (params?.id) {
    return <ConversationDetail id={params.id} />;
  }
  return <ConversationList />;
}

function ConversationList() {
  const nav = loadNavConfig();
  const copy = loadUiCopy();
  const search = useSearchParams();
  const pinField = personaPinField();
  const range = search.get("range") ?? copy.defaultRange;
  const channelRaw = search.get("channel") ?? copy.filterAnyId;
  const userId = search.get("user_id") ?? "";
  const rawPin = search.get(pinField);
  const [directory, setDirectory] = useState<PublishedPersona[]>([]);
  const [boot, setBoot] = useState<"loading" | "ready">("loading");
  const [rows, setRows] = useState<SessionListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const loadGen = useRef(0);
  const pickedId =
    rawPin && directory.some((row) => row.id === rawPin) ? rawPin : null;

  const title =
    nav.adminItems.find((item) => item.to === ROUTES.adminConversations)?.label ??
    copy.conversationsTitle;

  const channelParam = channelRaw === copy.filterAnyId ? undefined : channelRaw;

  useEffect(() => {
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
  }, []);

  const load = useCallback(
    async (nextCursor?: string) => {
      const gen = ++loadGen.current;
      if (!pickedId) {
        setRows([]);
        setCursor(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const page = await fetchOwnerSessions({
          range,
          cursor: nextCursor,
          channel: channelParam,
          userId: userId || undefined,
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
    [channelParam, pickedId, range, userId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const queryFor = (next: {
    range?: string;
    channel?: string;
    personaId?: string | null;
  }) => {
    const query = new URLSearchParams();
    query.set("range", next.range ?? range);
    query.set("channel", next.channel ?? channelRaw);
    const pin = next.personaId === undefined ? pickedId : next.personaId;
    if (pin) {
      query.set(pinField, pin);
    }
    if (userId) {
      query.set("user_id", userId);
    }
    return `${ROUTES.adminConversations}?${query.toString()}`;
  };

  return (
    <div className="mc-wrap">
      <div className="mc-pagehead">
        <div>
          <h1 className="mc-pagehead__title">{title}</h1>
        </div>
        <Segmented
          options={copy.ranges.map((item) => ({
            value: item.id,
            label: item.label,
          }))}
          value={range}
          onChange={(value) => navigate(queryFor({ range: value }))}
        />
      </div>
      <div style={{ marginBottom: 16 }}>
        <Segmented
          options={copy.channelFilters.map((item) => ({
            value: item.id,
            label: item.label,
          }))}
          value={channelRaw}
          onChange={(value) => navigate(queryFor({ channel: value }))}
        />
      </div>
      {boot === "loading" ? <p>{nav.loadingLabel}</p> : null}
      {boot === "ready" ? (
        <PersonaPicker
          directory={directory}
          pickedId={pickedId}
          locked={false}
          title={copy.personaPickerTitle}
          empty={copy.personaPickerEmpty}
          help={copy.personaPickerHistoryHelp}
          onPick={(id) => navigate(queryFor({ personaId: id }))}
        />
      ) : null}
      {error ? <FetchError error={error} onRetry={() => void load()} /> : null}
      {!error && !pickedId && boot === "ready" ? (
        <EmptyNote text={copy.personaNeedPick} />
      ) : null}
      {!error && pickedId ? (
        <SessionRows
          sessions={rows}
          showUser
          hrefFor={(row) => adminSessionPath(row.id)}
        />
      ) : null}
      {cursor ? (
        <div style={{ marginTop: 16 }}>
          <Button type="button" disabled={loading} onClick={() => void load(cursor)}>
            {copy.loadMore}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ConversationDetail({ id }: { id: string }) {
  const nav = loadNavConfig();
  const copy = loadUiCopy();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await fetchOwnerSession(id));
    } catch (caught) {
      setDetail(null);
      setError(caught);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const heading = useMemo(
    () => detail?.user_email ?? copy.conversationsTitle,
    [copy.conversationsTitle, detail],
  );

  return (
    <div className="mc-wrap">
      <div className="mc-pagehead">
        <div>
          <h1 className="mc-pagehead__title">{heading}</h1>
        </div>
        <Button type="button" onClick={() => navigate(ROUTES.adminConversations)}>
          {copy.backLabel}
        </Button>
      </div>
      {error ? <FetchError error={error} onRetry={() => void load()} /> : null}
      {!error && !detail ? <p>{nav.loadingLabel}</p> : null}
      {detail ? <SessionReconstruct detail={detail} /> : null}
    </div>
  );
}
