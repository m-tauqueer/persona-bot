import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "glass" | "solid" | "ghost" | "ember" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  block?: boolean;
}

export function Button({
  variant = "glass",
  size = "md",
  icon,
  iconRight,
  block = false,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`ui-btn ui-btn--${variant} ui-btn--${size}${block ? " ui-btn--block" : ""} ${className}`.trim()}
      {...rest}
    >
      {icon && <span className="ui-btn__ic">{icon}</span>}
      {children != null && <span className="ui-btn__lb">{children}</span>}
      {iconRight && <span className="ui-btn__ic">{iconRight}</span>}
    </button>
  );
}

export function IconButton({
  size = 40,
  active = false,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { size?: number; active?: boolean }) {
  return (
    <button
      className={`ibtn${active ? " ibtn--active" : ""} ${className}`.trim()}
      style={{ width: size, height: size }}
      {...rest}
    >
      {children}
    </button>
  );
}
