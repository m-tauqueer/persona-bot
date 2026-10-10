import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { closeArea, easeInOutCubic, monotonePath, resample } from "./curve";

export interface ActivityPoint {
  label: string;
  tick: string;
  primary: number;
  secondary?: number;
}

const PAD = { top: 24, right: 14, bottom: 30, left: 14 };
const MORPH_MS = 380;
const MAX_NODES = 12;
const NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

function niceCeil(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  for (const s of NICE_STEPS) if (f <= s) return s * p;
  return 10 * p;
}

const fmtK = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${Math.round(v)}`);

export function ActivityGraph({
  points,
  primaryLabel = "Recalls",
  secondaryLabel = "Captures",
  height = 290,
}: {
  points: ActivityPoint[];
  primaryLabel?: string;
  secondaryLabel?: string;
  height?: number;
}) {
  const gid = "ag-" + useId().replace(/:/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const areaRef = useRef<SVGPathElement>(null);
  const secRef = useRef<SVGPathElement>(null);
  const modRef = useRef<SVGGElement>(null);
  const nodesRef = useRef<SVGGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const [w, setW] = useState(0);
  const [entered, setEntered] = useState(false);
  const [hot, setHot] = useState<number | null>(null);

  const morphRaf = useRef(0);
  const morphing = useRef(false);
  const lastIdx = useRef(0);
  const shownRef = useRef<{ prim: number[]; sec: number[] | null; yMax: number } | null>(null);
  const hadPosRef = useRef(false);
  const svgBox = useRef<DOMRect | null>(null);
  const reduceMotion = useRef(false);

  const n = points.length;
  const prim = useMemo(() => points.map((p) => p.primary), [points]);
  const sec = useMemo(
    () => (points.some((p) => p.secondary != null) ? points.map((p) => p.secondary ?? 0) : null),
    [points],
  );

  const g = useMemo(() => {
    const iw = Math.max(0, w - PAD.left - PAD.right);
    const ih = Math.max(0, height - PAD.top - PAD.bottom);
    const bottom = PAD.top + ih;
    const rawMax = Math.max(...prim, ...(sec ?? [0]), 1);
    const step = niceCeil(rawMax / (0.85 * 4));
    const gridN = Math.min(5, Math.max(3, Math.ceil((rawMax * 1.02) / step)));
    const yMax = step * gridN;
    const xs = prim.map((_, i) => PAD.left + (n === 1 ? iw / 2 : (i / (n - 1)) * iw));
    const yOf = (v: number) => PAD.top + ih * (1 - v / yMax);
    const ysP = prim.map(yOf);
    const ysS = sec ? sec.map(yOf) : null;
    const line = monotonePath(xs, ysP);
    const area = w ? closeArea(line, xs[0], xs[n - 1], bottom) : "";
    const secLine = ysS ? monotonePath(xs, ysS) : "";
    const grid = Array.from({ length: gridN }, (_, i) => i + 1).map((k) => ({ y: Math.round(yOf(k * step)) + 0.5, v: k * step }));

    const stride = Math.max(1, Math.round((n - 1) / 5));
    const ticks: { x: number; label: string; anchor: "start" | "middle" | "end" }[] = [];
    for (let i = 0; i < n; i += stride) ticks.push({ x: xs[i], label: points[i].tick, anchor: "middle" });
    const lastTick = { x: xs[n - 1], label: points[n - 1].tick, anchor: "end" as const };
    if (ticks.length && xs[n - 1] - ticks[ticks.length - 1].x < stride * (xs[1] - xs[0] || 0) * 0.55) ticks.pop();
    ticks.push(lastTick);
    if (ticks.length > 1) ticks[0] = { ...ticks[0], anchor: "start" };

    return { iw, ih, bottom, xs, ysP, ysS, line, area, secLine, grid, ticks, yMax, yOf };
  }, [points, prim, sec, w, height, n]);

  useLayoutEffect(() => {
    reduceMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = wrapRef.current!;
    const ro = new ResizeObserver((es) => {
      const cw = Math.round(es[0].contentRect.width);
      if (cw > 0) setW(cw);
      svgBox.current = null;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!w) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [w]);

  useLayoutEffect(() => {
    const from = shownRef.current;
    const done = () => {
      shownRef.current = { prim: prim.slice(), sec: sec ? sec.slice() : null, yMax: g.yMax };
    };

    if (!from || !w || reduceMotion.current) {
      done();
      return;
    }

    cancelAnimationFrame(morphRaf.current);
    morphing.current = true;
    setHot(null);
    const fromP = resample(from.prim, n);
    const fromS = sec ? resample(from.sec ?? from.prim.map(() => 0), n) : null;
    const { xs, ih, bottom } = g;
    const t0 = performance.now();

    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / MORPH_MS);
      const e = easeInOutCubic(t);
      const yMax = from.yMax + (g.yMax - from.yMax) * e;
      const yOf = (v: number) => PAD.top + ih * (1 - v / yMax);
      const vp = prim.map((v, i) => fromP[i] + (v - fromP[i]) * e);
      const ysP = vp.map(yOf);
      const line = monotonePath(xs, ysP);

      lineRef.current?.setAttribute("d", line);
      areaRef.current?.setAttribute("d", closeArea(line, xs[0], xs[n - 1], bottom));
      if (sec && fromS && secRef.current) {
        const ysS = sec.map((v, i) => yOf(fromS[i] + (v - fromS[i]) * e));
        secRef.current.setAttribute("d", monotonePath(xs, ysS));
      }
      modRef.current?.setAttribute("transform", `translate(${xs[n - 1]},${ysP[n - 1]})`);

      const kids = nodesRef.current?.children;
      if (kids) for (let i = 0; i < kids.length; i++) kids[i].setAttribute("cy", String(ysP[i]));

      shownRef.current = { prim: vp, sec: sec ? sec.map((v, i) => fromS![i] + (v - fromS![i]) * e) : null, yMax };

      if (t < 1) {
        morphRaf.current = requestAnimationFrame(frame);
      } else {
        morphing.current = false;
        done();
      }
    };

    morphRaf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(morphRaf.current);
  }, [points]);

  const locate = (clientX: number) => {
    if (!svgBox.current) svgBox.current = svgRef.current!.getBoundingClientRect();
    const x = clientX - svgBox.current.left;
    const stepX = n > 1 ? g.iw / (n - 1) : g.iw;
    return Math.max(0, Math.min(n - 1, Math.round((x - PAD.left) / (stepX || 1))));
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (morphing.current || !w) return;
    const i = locate(e.clientX);
    if (i === hot) return;
    lastIdx.current = i;
    setHot(i);
  };

  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip || hot == null || !w) return;

    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const px = g.xs[hot];
    const py = g.ysP[hot];
    const x = Math.max(tw / 2 + 6, Math.min(w - tw / 2 - 6, px));
    const above = py - th - 18 > 4;
    const y = above ? py - 14 : py + 16;

    if (!hadPosRef.current) tip.style.transition = "none";
    tip.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,${above ? "-100%" : "0"})`;
    if (!hadPosRef.current) {
      void tip.offsetWidth;
      tip.style.transition = "";
      hadPosRef.current = true;
    }
  }, [hot, g, w]);

  const showNodes = n <= MAX_NODES;
  const idx = Math.min(hot ?? lastIdx.current, n - 1);
  const hotX = g.xs[idx] ?? 0;
  const delta = hot != null && hot > 0 && prim[hot - 1] > 0
    ? Math.round(((prim[hot] - prim[hot - 1]) / prim[hot - 1]) * 100)
    : null;

  return (
    <div ref={wrapRef} className={"mc-graph" + (entered ? " is-in" : "")} style={{ height }}>
      {w > 0 && (
        <svg
          ref={svgRef}
          width={w}
          height={height}
          viewBox={`0 0 ${w} ${height}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHot(null)}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1={PAD.top} x2="0" y2={g.bottom} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff" stopOpacity=".16" />
              <stop offset=".3" stopColor="#fff" stopOpacity=".07" />
              <stop offset=".65" stopColor="#fff" stopOpacity=".022" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>

          <g className="mc-graph__chrome" shapeRendering="crispEdges">
            {g.grid.map((ln) => (
              <line key={ln.y} x1={PAD.left} x2={w - PAD.right} y1={ln.y} y2={ln.y} stroke="rgba(255,255,255,.06)" />
            ))}
          </g>
          <g className="mc-graph__chrome">
            {g.grid.slice(0, g.grid.length - 1).map((ln) => (
              <text key={ln.y} className="mc-graph__ylab" x={PAD.left} y={ln.y - 6}>{fmtK(ln.v)}</text>
            ))}
            {g.ticks.map((t, i) => (
              <text key={i} className="mc-graph__xlab" x={t.x} y={height - 9} textAnchor={t.anchor}>{t.label}</text>
            ))}
          </g>

          <path ref={areaRef} className="mc-graph__area" d={g.area} fill={`url(#${gid})`} />
          {g.secLine && (
            <path
              ref={secRef}
              className="mc-graph__sec"
              d={g.secLine}
              fill="none"
              stroke="rgba(255,255,255,.32)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeDasharray="3 6"
            />
          )}
          <path
            ref={lineRef}
            className="mc-graph__line"
            d={g.line}
            fill="none"
            stroke="rgba(255,255,255,.92)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
          />

          <g ref={nodesRef}>
            {showNodes &&
              g.ysP.map((y, i) =>
                i === n - 1 ? null : (
                  <circle
                    key={i}
                    className="mc-graph__node"
                    cx={g.xs[i]}
                    cy={y}
                    r={3}
                    fill="rgba(255,255,255,.92)"
                    stroke="rgb(18,18,20)"
                    strokeWidth={2}
                    style={{ transitionDelay: `${520 + i * 30}ms` }}
                  />
                ),
              )}
          </g>

          <g ref={modRef} transform={`translate(${g.xs[n - 1]},${g.ysP[n - 1]})`}>
            <circle className="mc-graph__pulse" r={7} fill="none" stroke="rgba(255,107,62,.5)" strokeWidth={1.5} />
            <rect className="mc-graph__mod" x={-4.5} y={-4.5} width={9} height={9} rx={2} fill="var(--accent)" stroke="rgb(18,18,20)" strokeWidth={2} />
          </g>

          <g
            className={"mc-graph__xhair" + (hot != null ? " is-on" : "")}
            style={{ transform: `translateX(${hotX}px)`, transition: hadPosRef.current ? undefined : "none" }}
          >
            <line y1={PAD.top} y2={g.bottom} stroke="rgba(255,255,255,.14)" />
          </g>
          {g.ysS && (
            <circle
              className={"mc-graph__adot mc-graph__adot--sec" + (hot != null ? " is-on" : "")}
              r={3.5}
              fill="rgba(255,255,255,.55)"
              stroke="rgb(18,18,20)"
              strokeWidth={2}
              style={{ transform: `translate(${hotX}px,${g.ysS[idx] ?? 0}px)`, transition: hadPosRef.current ? undefined : "none" }}
            />
          )}
          <circle
            className={"mc-graph__adot" + (hot != null ? " is-on" : "")}
            r={4}
            fill="rgba(255,255,255,.95)"
            stroke="rgb(18,18,20)"
            strokeWidth={2}
            style={{ transform: `translate(${hotX}px,${g.ysP[idx] ?? 0}px)`, transition: hadPosRef.current ? undefined : "none" }}
          />
        </svg>
      )}

      <div ref={tipRef} className={"mc-graph__tip" + (hot != null ? " is-on" : "")} role="status">
        {hot != null && (
          <>
            <div className="mc-graph__tip-date">
              {points[hot].label}
              {delta != null && delta !== 0 && (
                <span className={"mc-graph__tip-delta" + (delta > 0 ? " is-up" : "")}>
                  {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}%
                </span>
              )}
            </div>
            <div className="mc-graph__tip-row">
              <span className="mc-graph__tip-sw" />
              {primaryLabel}
              <b>{prim[hot].toLocaleString()}</b>
            </div>
            {sec && (
              <div className="mc-graph__tip-row">
                <span className="mc-graph__tip-sw mc-graph__tip-sw--sec" />
                {secondaryLabel}
                <b>{sec[hot].toLocaleString()}</b>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
