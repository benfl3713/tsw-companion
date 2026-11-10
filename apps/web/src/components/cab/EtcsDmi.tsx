import { useEffect, useRef } from "react";
import { adviseBraking, brakeTargets, DEFAULT_BRAKE_OPTIONS, type DriverAidState, type TrackState } from "@tsw/shared";
import { HIDDEN_ASPECT, useSettings } from "../../settings";
import { store } from "../../telemetry";
import { formatDistance, limitIn, toUnit, type SpeedUnit } from "../../units";

// ETCS Driver Machine Interface in the layout of ERA ERTMS/ETCS DMI spec
// (640×480, areas A–G). Class 700 and 80x use this as their speedometer.
// Without ETCS in the game the "planning area" is filled from TSW's own
// lookahead, which a real non-ETCS DMI would leave blank (Settings can hide it).

const C = {
  bg: "#031122",
  shadow: "#08182f",
  grey: "#c3c3c3",
  mediumGrey: "#969696",
  darkGrey: "#555555",
  white: "#ffffff",
  yellow: "#dfdf00",
  orange: "#ea9100",
  red: "#bf0002",
  paspDark: "#21314a",
  paspLight: "#294a6b",
};

// Speed dial (area B): 280×300 at (54,15); 0 at 7 o'clock, max at 5 o'clock.
const B = { x: 54, y: 15, w: 280, h: 300 };
const CX = B.x + 140;
const CY = B.y + 150;
const DIAL_START = -144;
const DIAL_SWEEP = 288;
const R_TICKS = 125;
const R_CSG = 137;

function polar(deg: number, r: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function arc(from: number, to: number, r: number) {
  const a = polar(from, r);
  const b = polar(to, r);
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

/** ETCS dials come in fixed ranges. */
function dialRange(maxDisplay: number, unit: SpeedUnit) {
  const ranges = unit === "mph" ? [100, 140, 180, 250] : [140, 180, 250, 400];
  return ranges.find((r) => r >= maxDisplay) ?? ranges[ranges.length - 1]!;
}

// Planning area (D): 246×300 at (334,15). Log distance scale, 0 at the bottom.
const D = { x: 334, y: 15, w: 246, h: 300 };
const D_TOP = D.y + 15;
const D_BOTTOM = D.y + D.h - 15;
const PLAN_LINES = [0, 25, 50, 75, 100, 200, 300, 400, 500, 1000, 2000, 3000, 4000];

function planY(distance: number, range: number) {
  // Linear for the first 100 m, log beyond (as the ERA planning scale).
  const first = (D_BOTTOM - D_TOP) * 0.25;
  if (distance <= 100) return D_BOTTOM - (Math.max(0, distance) / 100) * first;
  const rest = Math.log10(distance / 100) / Math.log10(range / 100);
  return D_BOTTOM - first - Math.min(1, rest) * (D_BOTTOM - D_TOP - first);
}

interface Props {
  unit: SpeedUnit;
  driverAid: DriverAidState | null;
  track: TrackState | null;
  /** m/s; drawn as the speed-set marker when active. */
  speedSet: number | null;
  maxSpeed: number | null;
  clockIso: string | undefined;
  message: string | null;
}

export function EtcsDmi({ unit, driverAid, track, speedSet, maxSpeed, clockIso, message }: Props) {
  const { settings } = useSettings();
  const needle = useRef<SVGGElement>(null);
  const needlePath = useRef<SVGPathElement>(null);
  const hub = useRef<SVGCircleElement>(null);
  const digits = useRef<SVGTextElement>(null);
  const shown = useRef(0);

  const top = dialRange(maxSpeed ? toUnit(maxSpeed, unit) : unit === "mph" ? 125 : 200, unit);
  const angle = (v: number) => DIAL_START + (Math.min(Math.max(v, 0), top) / top) * DIAL_SWEEP;
  const permitted = limitIn(driverAid?.speedLimit, unit);

  const options = { ...DEFAULT_BRAKE_OPTIONS, comfortDecel: settings.comfortDecel, urgentDecel: settings.urgentDecel };
  const speedNow = store.speedAt(performance.now());
  const advice = adviseBraking(speedNow, brakeTargets(driverAid, options), options);
  const target = advice.target;
  const targetSpeed = target ? Math.round(toUnit(target.targetSpeed, unit)) : null;
  // Supervision status picks the needle colour, as on a real DMI.
  const status: "normal" | "indication" | "overspeed" | "intervention" =
    advice.level === "urgent" ? "intervention" : advice.level === "brake" ? "overspeed" : advice.level === "approach" ? "indication" : "normal";
  const statusColour = { normal: C.grey, indication: C.yellow, overspeed: C.orange, intervention: C.red }[status];

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const v = toUnit(store.speedAt(now), unit);
      shown.current += (v - shown.current) * Math.min(1, dt / 0.04);
      const s = shown.current;
      const over = permitted != null && s > permitted + 0.5;
      const colour = over ? C.orange : statusColour;
      needle.current?.setAttribute("transform", `rotate(${angle(s)} ${CX} ${CY})`);
      needlePath.current?.setAttribute("fill", colour);
      hub.current?.setAttribute("fill", colour);
      if (digits.current) digits.current.textContent = String(Math.round(s));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [unit, top, permitted, statusColour]);

  // Dial ticks: long every 20 (labelled), short every 10 (every 5 below 100 on small dials).
  const ticks = [];
  for (let v = 0; v <= top; v += top <= 140 ? 5 : 10) {
    const long = v % 20 === 0;
    const mid = v % 10 === 0;
    const a = polar(angle(v), R_TICKS - (long ? 15 : mid ? 10 : 6));
    const b = polar(angle(v), R_TICKS);
    ticks.push(<line key={v} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={C.white} strokeWidth={long ? 2 : 1} />);
    if (long) {
      const p = polar(angle(v), R_TICKS - 30);
      ticks.push(
        <text key={`l${v}`} x={p.x} y={p.y} fill={C.white} fontSize={15} textAnchor="middle" dominantBaseline="central">
          {v}
        </text>,
      );
    }
  }

  // Distance to target (area A3) and planning area profile.
  const planRange = 4000;
  const limits = driverAid?.limits ?? [];
  const steps: { from: number; to: number; limit: number | null }[] = [];
  let from = 0;
  let current = driverAid?.speedLimit ?? null;
  for (const l of limits) {
    if (l.distance > planRange) break;
    steps.push({ from, to: l.distance, limit: current });
    from = l.distance;
    current = l.limit;
  }
  steps.push({ from, to: planRange, limit: current });
  const refLimit = Math.max(...steps.map((s) => s.limit ?? 0), 1);

  // Gradient profile from the track heights ahead.
  const heights = track?.heights ?? [];
  const gradients: { from: number; to: number; pct: number }[] = [];
  for (let i = 1; i < heights.length; i++) {
    const a = heights[i - 1]!;
    const b = heights[i]!;
    const len = b.distance - a.distance;
    if (len > 5 && a.distance < planRange) {
      gradients.push({ from: Math.max(0, a.distance), to: Math.min(planRange, b.distance), pct: ((b.height - a.height) / len) * 100 });
    }
  }

  const targetDistance = target && targetSpeed != null ? target.distance : null;
  const barMax = 1000;
  // The bar only appears inside its 1000 m scale; further out it's digits only.
  const barH = targetDistance != null && targetDistance <= barMax ? (targetDistance / barMax) * 180 : 0;

  const clock = clockIso?.match(/T(\d\d:\d\d:\d\d)/)?.[1] ?? "--:--:--";
  const showPlanning = settings.dmiPlanning;

  return (
    <svg className="dmi" viewBox="0 0 640 480" role="img" aria-label="ETCS driver display" fontFamily="Arial, Helvetica, sans-serif">
      <rect width={640} height={480} fill={C.bg} />

      {/* A: distance to target */}
      <rect x={0} y={15} width={54} height={300} fill={C.bg} stroke={C.shadow} />
      {targetDistance != null && (
        <>
          <text x={50} y={88} fill={C.grey} fontSize={13} textAnchor="end">
            {formatDistance(targetDistance, unit)}
          </text>
          <rect x={29} y={290 - barH} width={10} height={barH} fill={C.grey} />
        </>
      )}
      {[0, 250, 500, 750, 1000].map((d) => (
        <line key={d} x1={14} x2={d % 500 === 0 ? 26 : 20} y1={290 - (d / barMax) * 180} y2={290 - (d / barMax) * 180} stroke={C.grey} />
      ))}

      {/* B: speed dial */}
      <rect x={B.x} y={B.y} width={B.w} height={B.h} fill={C.bg} stroke={C.shadow} />
      {permitted != null && (
        <>
          {/* Permitted speed: grey band to the limit, with the hook at it. */}
          <path d={arc(DIAL_START, angle(permitted), R_CSG)} stroke={C.darkGrey} strokeWidth={8} fill="none" />
          <path d={arc(angle(permitted) - 1.5, angle(permitted), R_CSG + 2)} stroke={C.grey} strokeWidth={16} fill="none" />
        </>
      )}
      {targetSpeed != null && status !== "normal" && (
        // Target speed in yellow/orange: from the target speed to the permitted speed.
        <path d={arc(angle(targetSpeed), angle(permitted ?? targetSpeed), R_CSG)} stroke={statusColour} strokeWidth={8} fill="none" />
      )}
      {speedSet != null && (
        <g transform={`rotate(${angle(toUnit(speedSet, unit))} ${CX} ${CY})`}>
          <path d={`M ${CX} ${CY - R_CSG - 9} l -6 -10 h 12 z`} fill={C.white} />
        </g>
      )}
      {ticks}
      <g ref={needle}>
        <path ref={needlePath} d={`M ${CX - 4} ${CY - 22} L ${CX} ${CY - R_TICKS + 4} L ${CX + 4} ${CY - 22} z`} fill={C.grey} />
      </g>
      <circle ref={hub} cx={CX} cy={CY} r={25} fill={C.grey} />
      <text ref={digits} x={CX} y={CY + 1} fill="#000" fontSize={22} fontWeight="bold" textAnchor="middle" dominantBaseline="central">
        0
      </text>
      <text x={CX} y={CY + 60} fill={C.mediumGrey} fontSize={12} textAnchor="middle">
        {unit === "mph" ? "mph" : "km/h"}
      </text>

      {/* C: level and mode */}
      <rect x={54} y={315} width={280} height={50} fill={C.bg} stroke={C.shadow} />
      <rect x={60} y={322} width={70} height={36} fill="none" stroke={C.mediumGrey} />
      <text x={95} y={340} fill={C.grey} fontSize={13} textAnchor="middle" dominantBaseline="central">
        NTC
      </text>
      <rect x={136} y={322} width={90} height={36} fill="none" stroke={C.mediumGrey} />
      <text x={181} y={340} fill={C.grey} fontSize={12} textAnchor="middle" dominantBaseline="central">
        AWS/TPWS
      </text>

      {/* D: planning area */}
      <rect x={D.x} y={D.y} width={D.w} height={D.h} fill={C.bg} stroke={C.shadow} />
      {showPlanning && (
        <>
          {PLAN_LINES.map((d) => (
            <g key={d}>
              <line
                x1={D.x + 40}
                x2={D.x + D.w - 6}
                y1={planY(d, planRange)}
                y2={planY(d, planRange)}
                stroke={d === 0 || d === 100 || d === 1000 || d === 4000 ? C.mediumGrey : C.darkGrey}
              />
              {[0, 500, 1000, 2000, 4000].includes(d) && (
                <text x={D.x + 36} y={planY(d, planRange) + 4} fill={C.mediumGrey} fontSize={10} textAnchor="end">
                  {formatDistance(d, unit)}
                </text>
              )}
            </g>
          ))}
          {/* Gradient column */}
          {gradients
            .filter((g) => Math.abs(g.pct) >= 0.1)
            .map((g, i) => (
              <g key={`g${i}`}>
                <rect
                  x={D.x + 44}
                  width={16}
                  y={planY(g.to, planRange)}
                  height={Math.max(2, planY(g.from, planRange) - planY(g.to, planRange))}
                  fill={g.pct > 0 ? C.grey : C.darkGrey}
                />
                <text
                  x={D.x + 52}
                  y={(planY(g.from, planRange) + planY(g.to, planRange)) / 2 + 4}
                  fill={g.pct > 0 ? "#000" : C.white}
                  fontSize={10}
                  textAnchor="middle"
                >
                  {g.pct > 0 ? "+" : "−"}
                </text>
              </g>
            ))}
          {/* Permitted speed profile: width relative to the highest limit ahead */}
          {steps.map((s, i) => {
            const y1 = planY(s.to, planRange);
            const y2 = planY(s.from, planRange);
            const w = ((s.limit ?? 0) / refLimit) * 150;
            return (
              <g key={`p${i}`}>
                <rect x={D.x + 66} y={y1} width={Math.min(w, 75)} height={Math.max(0, y2 - y1)} fill={C.paspLight} />
                {w > 75 && <rect x={D.x + 141} y={y1} width={w - 75} height={Math.max(0, y2 - y1)} fill={C.paspDark} />}
              </g>
            );
          })}
          {/* Speed changes: yellow down / white up, with the new value */}
          {limits
            .filter((l) => l.distance <= planRange && l.limit != null)
            .map((l, i) => {
              const y = planY(l.distance, planRange);
              const prev = i === 0 ? (driverAid?.speedLimit ?? 0) : (limits[i - 1]!.limit ?? 0);
              const down = (l.limit ?? 0) < prev;
              return (
                <g key={`s${i}`}>
                  <path
                    d={down ? `M ${D.x + 222} ${y - 8} l 6 8 l 6 -8 z` : `M ${D.x + 222} ${y + 8} l 6 -8 l 6 8 z`}
                    fill={down ? C.yellow : C.white}
                  />
                  <text x={D.x + 218} y={y + 4} fill={down ? C.yellow : C.white} fontSize={12} textAnchor="end">
                    {limitIn(l.limit, unit)}
                  </text>
                </g>
              );
            })}
          {/* Signals ahead (not part of ETCS; TSW's lookahead): red ones, or all of them
              as plain markers when aspects are hidden in Settings. */}
          {(driverAid?.signals ?? [])
            .filter((s) => s.distance <= planRange && (s.aspect === HIDDEN_ASPECT || /stop|danger/i.test(s.aspect)))
            .map((s, i) => (
              <circle
                key={`r${i}`}
                cx={D.x + 200}
                cy={planY(s.distance, planRange)}
                r={s.aspect === HIDDEN_ASPECT ? 4 : 5}
                fill={s.aspect === HIDDEN_ASPECT ? C.mediumGrey : C.red}
              />
            ))}
        </>
      )}

      {/* E: text messages */}
      <rect x={54} y={365} width={280} height={100} fill={C.bg} stroke={C.shadow} />
      {message && (
        <text x={60} y={385} fill={C.yellow} fontSize={13}>
          {message}
        </text>
      )}

      {/* G: below planning, with the clock in G13 */}
      <rect x={334} y={315} width={246} height={150} fill={C.bg} stroke={C.shadow} />
      <text x={574} y={455} fill={C.grey} fontSize={14} textAnchor="end">
        {clock}
      </text>

      {/* F: soft keys (decorative) */}
      {["Main", "Override", "Data view", "Spec", "Settings"].map((label, i) => (
        <g key={label}>
          <rect x={582} y={15 + i * 52} width={56} height={48} fill={C.bg} stroke={C.shadow} strokeWidth={2} />
          <text x={610} y={39 + i * 52} fill={C.mediumGrey} fontSize={10} textAnchor="middle" dominantBaseline="central">
            {label}
          </text>
        </g>
      ))}
    </svg>
  );
}
