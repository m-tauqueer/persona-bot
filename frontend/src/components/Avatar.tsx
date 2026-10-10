import { useState } from "react";

const GRADIENTS = [
  "linear-gradient(140deg,#3c3c40,#1d1d20)",
  "linear-gradient(140deg,#4a4a4f,#242428)",
  "linear-gradient(140deg,#343438,#19191c)",
  "linear-gradient(140deg,#46464c,#202024)",
  "linear-gradient(140deg,#38383c,#1c1c1f)",
  "linear-gradient(140deg,#42424a,#222226)",
  "linear-gradient(140deg,#303034,#161618)",
];

const INITIALS_FONT_SCALE = 0.38;

function pick(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 9973;
  return GRADIENTS[h % GRADIENTS.length];
}

export function Avatar({
  name,
  src,
  size = 40,
  radius,
}: {
  name: string;
  src?: string;
  size?: number;
  radius?: number;
}) {
  const [err, setErr] = useState(false);
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius ?? "50%",
  };
  if (src && !err) {
    return (
      <img
        className="avatar"
        src={src}
        alt={name}
        style={style}
        onError={() => setErr(true)}
        loading="lazy"
      />
    );
  }
  return (
    <span
      className="avatar avatar--initials"
      style={{ ...style, background: pick(name), fontSize: size * INITIALS_FONT_SCALE }}
      title={name}
    >
      {initials}
    </span>
  );
}

export function AvatarStack({
  people,
  size = 26,
  max = 3,
}: {
  people: { name: string; src?: string }[];
  size?: number;
  max?: number;
}) {
  const shown = people.slice(0, max);
  return (
    <div className="avatar-stack" style={{ ["--sz" as string]: `${size}px` }}>
      {shown.map((p, i) => (
        <span key={p.name + i} className="avatar-stack__item" style={{ zIndex: shown.length - i }}>
          <Avatar name={p.name} src={p.src} size={size} />
        </span>
      ))}
    </div>
  );
}
