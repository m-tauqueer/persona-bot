import type { HTMLAttributes, ReactNode } from "react";

export type CardVariant = "glass" | "paper" | "ember";

export function Card({
  variant = "glass",
  children,
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement> & { variant?: CardVariant; children?: ReactNode }) {
  return (
    <div className={`ui-card ui-card--${variant} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}
