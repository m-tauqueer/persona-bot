import type { InputHTMLAttributes, ReactNode } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: ReactNode;
  error?: string;
}

export function Input({ label, icon, error, className = "", id, ...rest }: InputProps) {
  const inputId = id || (label ? `in-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <label className={`ui-field ${className}`.trim()} htmlFor={inputId}>
      {label && <span className="ui-field__label">{label}</span>}
      <span className={`ui-input${error ? " ui-input--error" : ""}`}>
        {icon && <span className="ui-input__ic">{icon}</span>}
        <input id={inputId} className="ui-input__el" {...rest} />
      </span>
      {error && <span className="ui-field__error">{error}</span>}
    </label>
  );
}

export function Textarea({
  label,
  rows = 3,
  className = "",
  id,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  const taId = id || (label ? `ta-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <label className={`ui-field ${className}`.trim()} htmlFor={taId}>
      {label && <span className="ui-field__label">{label}</span>}
      <span className="ui-input ui-input--area">
        <textarea id={taId} rows={rows} className="ui-input__el" {...rest} />
      </span>
    </label>
  );
}
