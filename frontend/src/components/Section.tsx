import type { ReactNode } from "react";

interface SectionProps {
  title: string;
  count?: number;
  note?: ReactNode;
  action?: ReactNode;
  first?: boolean;
  children: ReactNode;
}

export function Section({ title, count, note, action, first = false, children }: SectionProps) {
  return (
    <section className="mc-sec" style={first ? { marginTop: 0 } : undefined}>
      <div className="mc-sec__head">
        <span className="mc-sec__title">
          {count === undefined ? title : <>{title} <span className="mc-sec__count">{count}</span></>}
        </span>
        {note !== undefined && <span className="mc-sec__link" style={{ cursor: "default" }}>{note}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}
