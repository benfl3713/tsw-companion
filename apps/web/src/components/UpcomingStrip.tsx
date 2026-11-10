import { useEffect, useRef, useState } from "react";
import type { DriverAidState, TrackState } from "@tsw/shared";
import { store } from "../telemetry";
import { formatDistance, limitIn, UNIT_LABEL, type SpeedUnit } from "../units";
import { aspectColour } from "./Indicators";

const RANGES = [2000, 5000, 10000] as const;
type Range = (typeof RANGES)[number];
const RANGE_KEY = "tsw.stripRange";

const WIDTH = 220;
const TOP_PAD = 16;
const BOTTOM_PAD = 52;
const TRACK_X = 110;

function readRange(): Range {
  try {
    const v = Number(localStorage.getItem(RANGE_KEY));
    if ((RANGES as readonly number[]).includes(v)) return v as Range;
  } catch {
    // Not available; use the default.
  }
  return 5000;
}

/** Re-renders this component every animation frame and returns the frame time. */
function useFrameTime(): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    let id = requestAnimationFrame(function loop(t) {
      setNow(t);
      id = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return now;
}

function useHeight<T extends Element>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(400);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => entry && setHeight(entry.contentRect.height));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, height];
}

interface Props {
  driverAid: DriverAidState | null;
  track: TrackState | null;
  unit: SpeedUnit;
}

/**
 * HUD-style track ahead: the train sits at the bottom and signals, limit
 * changes and platforms come down towards it. The scale is logarithmic so the
 * next few hundred metres get most of the room.
 */
export function UpcomingStrip({ driverAid, track, unit }: Props) {
  const [range, setRange] = useState<Range>(readRange);
  const [wrap, height] = useHeight<HTMLDivElement>();
  const now = useFrameTime();
  const travelled = store.travelledSinceLookahead(now);
  const currentLimit = limitIn(driverAid?.speedLimit, unit);

  const cycleRange = () => {
    const next = RANGES[(RANGES.indexOf(range) + 1) % RANGES.length]!;
    setRange(next);
    try {
      localStorage.setItem(RANGE_KEY, String(next));
    } catch {
      // Not persisted; fine.
    }
  };

  const span = Math.max(height - TOP_PAD - BOTTOM_PAD, 50);
  const bottom = TOP_PAD + span;
  const k = range / 25;
  const scale = Math.log1p(range / k);
  const y = (d: number) => bottom - (Math.log1p(Math.max(d, 0) / k) / scale) * span;
  const ahead = (d: number) => d - travelled;
  const inView = (d: number) => d >= 0 && d <= range;

  const signals = (driverAid?.signals ?? []).map((s) => ({ ...s, distance: ahead(s.distance) })).filter((s) => inView(s.distance));
  const limits = (driverAid?.limits ?? []).map((l) => ({ ...l, distance: ahead(l.distance) })).filter((l) => l.distance >= 0);
  const platforms = (track?.markers ?? [])
    .filter((m) => m.type === "Platform")
    .map((m) => ({ ...m, distance: ahead(m.distance) }))
    .filter((m) => m.distance + m.platformLength >= 0 && m.distance <= range);

  // Permitted speed as steps: current limit until the first change, and so on.
  const steps: { from: number; to: number; limit: number | null }[] = [];
  let from = 0;
  let current = driverAid?.speedLimit ?? null;
  for (const l of limits) {
    if (l.distance > range) break;
    steps.push({ from, to: l.distance, limit: current });
    from = l.distance;
    current = l.limit;
  }
  steps.push({ from, to: range, limit: current });
  const topLimit = Math.max(1, ...steps.map((s) => s.limit ?? 0));
  // Left gutter (x 6–34) holds the profile; limit signs sit between it and the track.
  const profileX = (limit: number | null) => 6 + ((limit ?? 0) / topLimit) * 28;

  const ticks = [100, 250, 500, 1000, 2000, 5000, 10000].filter((d) => d <= range);

  return (
    <section className="card strip">
      <div className="strip-head">
        <h2>Ahead</h2>
        <button className="unit-toggle small" onClick={cycleRange}>
          {formatDistance(range, unit)}
        </button>
      </div>
      <div className="strip-body" ref={wrap}>
        <svg width="100%" height={height} viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="xMidYMin meet">
          {ticks.map((d) => (
            <g key={d}>
              <line x1={TRACK_X - 6} x2={WIDTH} y1={y(d)} y2={y(d)} className="strip-grid" />
              <text x={WIDTH - 2} y={y(d) - 3} className="strip-tick" textAnchor="end">
                {formatDistance(d, unit)}
              </text>
            </g>
          ))}

          {/* Permitted speed profile */}
          <path
            className="strip-profile"
            d={steps
              .map((s, i) => `${i === 0 ? "M" : "L"} ${profileX(s.limit)} ${y(s.from)} L ${profileX(s.limit)} ${y(s.to)}`)
              .join(" ")}
          />

          <line x1={TRACK_X} x2={TRACK_X} y1={TOP_PAD} y2={bottom} className="strip-track" />

          {platforms.map((p) => (
            <g key={`${p.name}-${p.platformLength}`}>
              <rect
                x={TRACK_X + 4}
                width={8}
                y={y(Math.min(p.distance + p.platformLength, range))}
                height={Math.max(3, y(Math.max(p.distance, 0)) - y(Math.min(p.distance + p.platformLength, range)))}
                className="strip-platform"
              />
              <text x={TRACK_X + 16} y={y(Math.max(p.distance, 0)) - 2} className="strip-label platform">
                {p.name}
              </text>
            </g>
          ))}

          {limits
            .filter((l) => inView(l.distance))
            .map((l, i) => {
              const ly = y(l.distance);
              return (
                <g key={`l${i}`}>
                  <line x1={TRACK_X - 24} x2={TRACK_X} y1={ly} y2={ly} className="strip-limit-line" />
                  <circle cx={TRACK_X - 38} cy={ly} r={14} className="strip-limit" />
                  <text x={TRACK_X - 38} y={ly} className="strip-limit-text" textAnchor="middle" dominantBaseline="central">
                    {limitIn(l.limit, unit) ?? "–"}
                  </text>
                </g>
              );
            })}

          {signals.map((s, i) => {
            const sy = y(s.distance);
            return (
              <g key={`s${i}`} transform={`translate(${TRACK_X + 6} ${sy})`}>
                <rect x={0} y={-16} width={12} height={20} rx={3} className="strip-signal-body" />
                <circle cx={6} cy={-6} r={4} className={`strip-aspect ${aspectColour(s.aspect)}`} />
                <text x={18} y={-2} className="strip-label">
                  {formatDistance(s.distance, unit)}
                </text>
              </g>
            );
          })}

          {/* The train, with the limit it's running under as a pill beneath it */}
          <path d={`M ${TRACK_X} ${bottom - 12} l 8 14 h -16 z`} className="strip-train" />
          {currentLimit != null && (
            <g aria-label={`Current limit ${currentLimit} ${UNIT_LABEL[unit]}`}>
              <rect x={TRACK_X - 24} y={bottom + 6} width={48} height={22} rx={11} className="strip-current-pill" />
              <text x={TRACK_X} y={bottom + 17} className="strip-current-text" textAnchor="middle" dominantBaseline="central">
                {currentLimit}
              </text>
            </g>
          )}
          <text x={TRACK_X} y={bottom + 44} className="strip-tick" textAnchor="middle">
            {signals.length === 0 && limits.length === 0 ? "No signals or limits ahead" : ""}
          </text>
        </svg>
      </div>
    </section>
  );
}
