import type { CSSProperties } from "react";
import { Card } from "../components/ui/Card";
import type { PublishedPersona } from "../lib/publishedPersonas";

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

export function PersonaPicker({
  directory,
  pickedId,
  locked,
  title,
  empty,
  help,
  onPick,
}: {
  directory: PublishedPersona[];
  pickedId: string | null;
  locked: boolean;
  title: string;
  empty: string;
  help: string;
  onPick: (id: string) => void;
}) {
  return (
    <Card>
      <h2 className="mc-sec__title" style={{ marginBottom: 8 }}>
        {title}
      </h2>
      <p style={{ color: "var(--text-mid)", marginTop: 0 }}>{help}</p>
      {directory.length === 0 ? (
        <p style={{ color: "var(--text-mid)" }}>{empty}</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {directory.map((row) => (
            <li key={row.id} style={{ borderTop: "1px solid var(--line, #333)" }}>
              <button
                type="button"
                style={{
                  ...listButtonStyle,
                  cursor: locked ? "not-allowed" : "pointer",
                  opacity: locked ? 0.55 : 1,
                }}
                aria-pressed={row.id === pickedId}
                disabled={locked}
                onClick={() => onPick(row.id)}
              >
                <span>
                  {row.display_name}{" "}
                  <span style={{ color: "var(--text-mid)" }}>@{row.handle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
