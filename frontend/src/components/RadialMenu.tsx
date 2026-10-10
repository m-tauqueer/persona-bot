import { useEffect, useRef, useState } from "react";
import { MemoryIcon } from "../lib/memory-icons";
import { Close, ArrowUpRight } from "./icons";
import { navigate } from "../lib/router";

export type DialSegment = {
  icon: string;
  name: string;
  items: string[];
  to?: string;
};

const ORBIT_RADIUS = 158;
const KNOB_RADIUS = 72;

function segmentAngle(index: number, count: number) {
  return -90 + index * (360 / count);
}

function shortestStep(from: number, to: number, count: number) {
  const forward = (((to - from) % count) + count) % count;
  return forward > count / 2 ? forward - count : forward;
}

function nearestSegment(angleDeg: number, fallback: number, count: number) {
  let smallest = Infinity;
  let nearest = fallback;
  for (let i = 0; i < count; i++) {
    const delta = Math.abs(((angleDeg - segmentAngle(i, count) + 540) % 360) - 180);
    if (delta < smallest) {
      smallest = delta;
      nearest = i;
    }
  }
  return nearest;
}

export function RadialMenu({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: DialSegment[];
}) {
  const count = items.length;
  const step = count > 0 ? 360 / count : 0;
  const [active, setActive] = useState(0);
  const dialRef = useRef<HTMLDivElement>(null);
  const [rotation, setRotation] = useState(0);
  const previousActive = useRef(0);

  useEffect(() => {
    if (active >= count) {
      setActive(0);
    }
  }, [active, count]);

  useEffect(() => {
    if (count === 0) return;
    const delta = shortestStep(previousActive.current, active, count);
    previousActive.current = active;
    setRotation((current) => current + delta * step);
  }, [active, count, step]);

  useEffect(() => {
    if (!open || count === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        setActive((i) => (i - 1 + count) % count);
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        setActive((i) => (i + 1) % count);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, count]);

  if (count === 0) {
    return null;
  }

  const trackPointer = (e: React.PointerEvent) => {
    const el = dialRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const dx = e.clientX - (box.left + box.width / 2);
    const dy = e.clientY - (box.top + box.height / 2);
    if (Math.hypot(dx, dy) < KNOB_RADIUS) return;

    const next = nearestSegment((Math.atan2(dy, dx) * 180) / Math.PI, active, count);
    if (next !== active) setActive(next);
  };

  const segment = items[active] ?? items[0];

  const followSegment = () => {
    if (!segment?.to) return;
    navigate(segment.to);
    onClose();
  };

  return (
    <div className={"dial-overlay" + (open ? " is-open" : "")} onClick={onClose}>
      <button className="dial-close" onClick={onClose} aria-label="Close menu">
        <Close size={18} />
      </button>

      <div className="dial-stage" onClick={(e) => e.stopPropagation()}>
        <div className="dial" ref={dialRef} onPointerMove={trackPointer}>
          <div className="dial__ring" />
          <div className="dial__dividers" />
          <div className="dial__hi" style={{ transform: `rotate(${rotation}deg)` }} />

          {items.map((s, i) => {
            const radians = (segmentAngle(i, count) * Math.PI) / 180;
            const x = Math.cos(radians) * ORBIT_RADIUS;
            const y = Math.sin(radians) * ORBIT_RADIUS;
            return (
              <button
                key={s.name}
                className={"dial__seg" + (i === active ? " is-active" : "")}
                style={{
                  transform: `translate(${open ? x.toFixed(1) : 0}px, ${open ? y.toFixed(1) : 0}px) scale(${open ? 1 : 0})`,
                  transitionDelay: `${open ? i * 0.035 : 0}s`,
                }}
                onPointerEnter={() => setActive(i)}
                onClick={() => setActive(i)}
                aria-label={s.name}
              >
                <MemoryIcon name={s.icon} size={22} weight={1.7} />
              </button>
            );
          })}

          <div className="dial__knob" aria-hidden>
            <img src="/Logo-black.svg" alt="" width={64} height={64} />
          </div>
        </div>

        <div className="dial-flyout">
          <div className="dial-flyout__head">
            <MemoryIcon name={segment.icon} size={16} weight={1.8} />
            <span>{segment.name}</span>
          </div>
          <ul key={active} className="dial-flyout__list">
            {segment.items.map((label, i) => (
              <li
                key={label}
                className={"dial-flyout__item" + (i === 0 ? " is-active" : "")}
                style={{ animationDelay: `${0.04 + i * 0.05}s` }}
                onClick={followSegment}
              >
                <span className="dial-flyout__dot" />
                <span className="dial-flyout__txt">{label}</span>
                <ArrowUpRight size={15} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
