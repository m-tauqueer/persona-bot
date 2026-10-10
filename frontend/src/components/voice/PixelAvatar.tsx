import { useEffect, useRef } from "react";
import {
  generateGrid,
  generatePalette,
  hashSeed,
} from "../../lib/pixelAvatar";

export function PixelAvatar({
  seed,
  size,
  gridSize,
  hueSpread,
  animated,
}: {
  seed: string;
  size: number;
  gridSize: number;
  hueSpread: number;
  animated: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!ctx) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const hash = hashSeed(seed);
    const palette = generatePalette(hash, hueSpread);
    const grid = generateGrid(hash, gridSize);
    const cellSize = size / gridSize;
    const half = size / 2;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let live = animated && !motion.matches;
    let frame = 0;

    const draw = (time: number) => {
      ctx.clearRect(0, 0, size, size);
      const scale = live ? 1 + Math.sin(time * 0.0008) * 0.03 : 1;
      ctx.save();
      ctx.translate(half, half);
      ctx.scale(scale, scale);
      ctx.translate(-half, -half);
      ctx.beginPath();
      ctx.arc(half, half, half, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#08080f";
      ctx.fillRect(0, 0, size, size);
      const breathe = live ? Math.sin(time * 0.001) * 10 : 0;
      for (let y = 0; y < gridSize; y += 1) {
        const row = grid[y];
        if (!row) {
          continue;
        }
        for (let x = 0; x < gridSize; x += 1) {
          const cell = row[x];
          if (!cell) {
            continue;
          }
          const color = palette[cell.colorIndex];
          if (!color) {
            continue;
          }
          const [hue, sat, light] = color;
          const pulse = live
            ? Math.sin(time * 0.002 + cell.phase) * 22
            : 0;
          const wave = live
            ? Math.sin(time * 0.0015 + (x + y) / 3) * 15
            : 0;
          const sparkleWave = live
            ? Math.sin(time * 0.004 + cell.sparklePhase)
            : 0;
          const sparkle =
            sparkleWave > 0.92
              ? ((sparkleWave - 0.92) / 0.08) * 25
              : 0;
          const finalLight = Math.min(
            90,
            Math.max(20, (light + pulse + breathe + wave + sparkle) * cell.brightness),
          );
          ctx.fillStyle = `hsl(${hue}, ${Math.min(100, sat + 5)}%, ${finalLight}%)`;
          ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
      }
      ctx.restore();
      if (live) {
        frame = requestAnimationFrame(draw);
      }
    };

    const onMotion = () => {
      cancelAnimationFrame(frame);
      live = animated && !motion.matches;
      if (live) {
        frame = requestAnimationFrame(draw);
      } else {
        draw(0);
      }
    };

    motion.addEventListener("change", onMotion);
    if (live) {
      frame = requestAnimationFrame(draw);
    } else {
      draw(0);
    }

    return () => {
      cancelAnimationFrame(frame);
      motion.removeEventListener("change", onMotion);
    };
  }, [animated, gridSize, hueSpread, seed, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      aria-hidden="true"
      className="voice-pick__avatar"
      style={{ width: size, height: size }}
    />
  );
}