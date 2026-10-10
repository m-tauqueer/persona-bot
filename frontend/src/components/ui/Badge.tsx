import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "positive" | "negative" | "accent";

export function Badge({
  tone = "neutral",
  icon,
  children,
  className = "",
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`ui-badge ui-badge--${tone} ${className}`.trim()}>
      {icon && <span className="ui-badge__ic">{icon}</span>}
      {children}
    </span>
  );
}
