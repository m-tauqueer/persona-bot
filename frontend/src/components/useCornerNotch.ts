import { useLayoutEffect, useRef } from "react";

const DEFAULT_BR = 28;

export interface NotchButton {
  cxR: number;
  cy: number;
  r: number;
}

export interface NotchOpts {
  sweep: number;
  br?: number;
}

export function useCornerNotch(btns: NotchButton[], opts: NotchOpts) {
  const ref = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(btns) + "|" + opts.sweep + "|" + (opts.br ?? DEFAULT_BR);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const BR = opts.br ?? DEFAULT_BR;
    const sweep = opts.sweep;

    const build = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (!w || !h) return;

      const B = btns
        .map((b) => ({ cx: w - b.cxR, cy: b.cy, cxR: b.cxR }))
        .sort((a, b) => a.cx - b.cx);
      const first = B[0];
      const last = B[B.length - 1];
      const R = last.cxR;
      const cy = first.cy;
      const x0 = first.cx - R - sweep;

      const p: string[] = [`M ${BR} 0`, `L ${x0} 0`];
      p.push(`C ${x0 + sweep * 0.6} 0 ${first.cx - R} ${cy - R * 0.55} ${first.cx - R} ${cy}`);
      p.push(`A ${R} ${R} 0 0 0 ${first.cx} ${cy + R}`);
      for (let i = 1; i < B.length; i++) p.push(`L ${B[i].cx} ${cy + R}`);
      const Rc = w - last.cx;
      p.push(`A ${Rc} ${Rc} 0 0 1 ${w} ${cy + R + Rc}`);
      p.push(`L ${w} ${h - BR}`);
      p.push(`A ${BR} ${BR} 0 0 1 ${w - BR} ${h}`);
      p.push(`L ${BR} ${h}`);
      p.push(`A ${BR} ${BR} 0 0 1 0 ${h - BR}`);
      p.push(`L 0 ${BR}`);
      p.push(`A ${BR} ${BR} 0 0 1 ${BR} 0`);
      p.push("Z");

      el.style.clipPath = `path('${p.join(" ")}')`;
    };

    build();
    const ro = new ResizeObserver(build);
    ro.observe(el);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(build).catch(() => {});
    }
    return () => ro.disconnect();
  }, [key]);

  return ref;
}
