const RAMP = [
  "rgba(255,255,255,0.22)",
  "rgba(255,255,255,0.40)",
  "rgba(255,255,255,0.62)",
  "rgba(255,255,255,0.82)",
  "rgba(255,255,255,0.98)",
];

const EMPTY_DOT = "rgba(255,255,255,0.14)";

export function DotMeter({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <div className="dots" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className="dot"
          style={{ background: i < value ? RAMP[Math.min(i, RAMP.length - 1)] : EMPTY_DOT }}
        />
      ))}
    </div>
  );
}

export function BarMeter({
  value,
  accent = false,
  label,
}: {
  value: number;
  accent?: boolean;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="ui-meter">
      {label && (
        <div className="ui-meter__head">
          <span>{label}</span>
          <span className="ui-meter__pct">{pct}%</span>
        </div>
      )}
      <div className="ui-meter__track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span className={`ui-meter__fill${accent ? " is-accent" : ""}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
