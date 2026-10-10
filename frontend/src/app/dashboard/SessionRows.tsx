import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { navigate } from "../../lib/router";
import {
  channelLabel,
  loadUiCopy,
} from "../../lib/uiCopy";
import { formatDateTime, formatDuration } from "../../lib/format";
import type { SessionListItem } from "../../lib/insights";

export function SessionRows({
  sessions,
  hrefFor,
  showUser,
}: {
  sessions: SessionListItem[];
  hrefFor: (row: SessionListItem) => string;
  showUser: boolean;
}) {
  const copy = loadUiCopy();
  if (sessions.length === 0) {
    return (
      <Card>
        <p style={{ color: "var(--text-mid)" }}>{copy.emptyList}</p>
      </Card>
    );
  }
  return (
    <Card>
      {sessions.map((row) => (
        <button
          key={row.id}
          type="button"
          className="mc-activity__row"
          style={{
            width: "100%",
            textAlign: "left",
            background: "transparent",
            border: 0,
            color: "inherit",
            cursor: "pointer",
            padding: "10px 0",
          }}
          onClick={() => navigate(hrefFor(row))}
        >
          <span className="mc-activity__rail">
            <span className={"mc-activity__dot" + (row.ended ? "" : " is-hot")} />
          </span>
          <div className="mc-activity__main">
            <div className="mc-activity__title">
              {showUser ? row.user_email : channelLabel(row.channel)}
            </div>
            <span className="mc-tag">
              <Badge>{channelLabel(row.channel)}</Badge>{" "}
              {row.ended ? copy.sessionEnded : copy.sessionOpen}
              {showUser ? ` · ${row.turn_count}` : ` · ${row.turn_count}`}
            </span>
          </div>
          <span className="mc-activity__time">
            {formatDateTime(row.started_at)}
            {row.duration_ms !== null ? ` · ${formatDuration(row.duration_ms)}` : ""}
          </span>
        </button>
      ))}
    </Card>
  );
}
