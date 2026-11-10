import { useEffect, useRef } from "react";
import { store } from "../telemetry";
import { toUnit, UNIT_LABEL, type SpeedUnit } from "../units";

const START_DEG = -135;
const SWEEP_DEG = 270;
const R = 100;

function polar(deg: number, r: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
}

function arc(fromDeg: number, toDeg: number, r: number) {
  const a = polar(fromDeg, r);
  const b = polar(toDeg, r);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

/** Picks a dial top that fits the train with a round number. */
export function dialMax(maxSpeedMs: number | null, unit: SpeedUnit): number {
  const top = maxSpeedMs ? toUnit(maxSpeedMs, unit) * 1.05 : unit === "mph" ? 100 : 160;
  const step = unit === "mph" ? 20 : 40;
  return Math.max(step * 3, Math.ceil(top / step) * step);
}

interface Props {
  unit: SpeedUnit;
  max: number;
  /** Current limit in display units. */
  limit: number | null;
  /** Cruise / speed control target in display units, if active. */
  target: number | null;
}

/**
 * Dial with a needle driven by requestAnimationFrame straight from the
 * store, so it moves at display rate between 30 Hz samples.
 */
export function Speedometer({ unit, max, limit, target }: Props) {
  const needle = useRef<SVGGElement>(null);
  const readout = useRef<SVGTextElement>(null);
  const root = useRef<SVGSVGElement>(null);
  const shown = useRef(0);

  const angleFor = (v: number) => START_DEG + (Math.min(Math.max(v, 0), max) / max) * SWEEP_DEG;

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const target = toUnit(store.speedAt(now), unit);
      // Light smoothing so 30 Hz steps don't show; ~40 ms time constant.
      shown.current += (target - shown.current) * Math.min(1, dt / 0.04);
      const v = shown.current;
      needle.current?.setAttribute("transform", `rotate(${angleFor(v)})`);
      if (readout.current) readout.current.textContent = String(Math.round(v));
      root.current?.classList.toggle("overspeed", limit != null && v > limit + 0.5);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [unit, max, limit]);

  const majorStep = max <= 100 ? 10 : 20;
  const ticks = [];
  for (let v = 0; v <= max; v += majorStep / 2) {
    const major = v % majorStep === 0;
    const deg = angleFor(v);
    const a = polar(deg, R - (major ? 14 : 8));
    const b = polar(deg, R - 2);
    ticks.push(<line key={`t${v}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={major ? "tick major" : "tick"} />);
    if (major) {
      const p = polar(deg, R - 28);
      ticks.push(
        <text key={`l${v}`} x={p.x} y={p.y} className="tick-label" textAnchor="middle" dominantBaseline="central">
          {v}
        </text>,
      );
    }
  }

  return (
    <svg ref={root} className="speedo" viewBox="-115 -115 230 210" role="img" aria-label="Speedometer">
      <path d={arc(START_DEG, START_DEG + SWEEP_DEG, R)} className="dial-track" />
      {limit != null && limit < max && (
        <path d={arc(angleFor(limit), START_DEG + SWEEP_DEG, R)} className="dial-over" />
      )}
      {ticks}
      {limit != null && (
        <g transform={`rotate(${angleFor(limit)})`}>
          <path d={`M 0 ${-R - 4} l -6 -10 h 12 z`} className="limit-marker" />
        </g>
      )}
      {target != null && target > 0 && (
        <g transform={`rotate(${angleFor(target)})`}>
          <rect x={-2} y={-R + 3} width={4} height={14} className="target-marker" />
        </g>
      )}
      <g ref={needle}>
        <path d={`M -3 12 L 0 ${-R + 10} L 3 12 z`} className="needle" />
      </g>
      <circle r={9} className="hub" />
      <text ref={readout} y={52} className="readout" textAnchor="middle">
        0
      </text>
      <text y={72} className="readout-unit" textAnchor="middle">
        {UNIT_LABEL[unit]}
      </text>
    </svg>
  );
}
