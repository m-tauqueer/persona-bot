import { useId } from "react";
import { catmullRomPath, closeArea, monotonePath } from "./curve";

export type SparklineTone = "bold" | "fine";

interface ToneSpec {
  path: (xs: number[], ys: number[]) => string;
  strokeWidth: number;
  strokeOpacity: number;
  line: string;
  fill: { offset: string; mono: string; accent: string }[];
}

const TONES: Record<SparklineTone, ToneSpec> = {
  bold: {
    path: monotonePath,
    strokeWidth: 1.5,
    strokeOpacity: 0.8,
    line: "rgba(255,255,255,.55)",
    fill: [
      { offset: "0", mono: "rgba(255,255,255,.13)", accent: "rgba(255,107,62,.22)" },
      { offset: ".55", mono: "rgba(255,255,255,.045)", accent: "rgba(255,107,62,.07)" },
      { offset: "1", mono: "rgba(255,255,255,0)", accent: "rgba(255,107,62,0)" },
    ],
  },
  fine: {
    path: (xs, ys) => catmullRomPath(xs, ys),
    strokeWidth: 1.2,
    strokeOpacity: 0.55,
    line: "rgba(255,255,255,.5)",
    fill: [
      { offset: "0", mono: "rgba(255,255,255,.11)", accent: "rgba(255,107,62,.2)" },
      { offset: "1", mono: "rgba(255,255,255,0)", accent: "rgba(255,107,62,0)" },
    ],
  },
};

const WIDTH = 150;
const PAD_RIGHT = 8;
const PAD_TOP = 9;
const PAD_BOTTOM = 10;

export function NodeSparkline({ data, h = 46, accent = false, tone = "bold" }: {
  data: number[];
  h?: number;
  accent?: boolean;
  tone?: SparklineTone;
}) {
  const gradientId = "spark-" + useId().replace(/:/g, "");
  const spec = TONES[tone];

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;

  const innerWidth = WIDTH - PAD_RIGHT;
  const innerHeight = h - PAD_TOP - PAD_BOTTOM;

  const xs = data.map((_, i) => (data.length === 1 ? innerWidth / 2 : (i / (data.length - 1)) * innerWidth));
  const ys = data.map((value) => PAD_TOP + innerHeight - ((value - min) / span) * innerHeight);

  const line = spec.path(xs, ys);
  const area = closeArea(line, xs[0], xs[xs.length - 1], h - PAD_BOTTOM + 3);
  const stroke = accent ? "var(--accent)" : spec.line;

  return (
    <div className={"oc-spark" + (accent ? " oc-spark--accent" : "")} style={{ height: h }}>
      <svg width="100%" height={h} viewBox={`0 0 ${WIDTH} ${h}`} preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            {spec.fill.map((stop) => (
              <stop key={stop.offset} offset={stop.offset} stopColor={accent ? stop.accent : stop.mono} />
            ))}
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} stroke="none" />
        <path
          d={line}
          fill="none"
          stroke={stroke}
          strokeWidth={spec.strokeWidth}
          strokeOpacity={spec.strokeOpacity}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {xs.map((x, i) => (
        <span
          key={i}
          className={"oc-spark__node" + (i === xs.length - 1 ? " oc-spark__node--last" : "")}
          style={{ left: `${((x / WIDTH) * 100).toFixed(2)}%`, top: `${ys[i].toFixed(1)}px` }}
        />
      ))}
    </div>
  );
}
