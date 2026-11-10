import { useRef, useState } from "react";
import type { DriveState, Telemetry } from "@tsw/shared";
import {
  aspectColour,
  Bar,
  CurrentLimit,
  Gradient,
  LimitSign,
  NextLimit,
  NextSignal,
  NextStop,
} from "./components/Indicators";
import { RouteMap } from "./components/RouteMap";
import { dialMax, Speedometer } from "./components/Speedometer";
import { UpcomingStrip } from "./components/UpcomingStrip";
import { useTelemetry, type StoreState } from "./telemetry";
import { formatDistance, limitIn, toUnit, UNIT_LABEL, useSpeedUnit } from "./units";

type View = "drive" | "map";
const VIEW_KEY = "tsw.view";

function useView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "map" ? "map" : "drive";
    } catch {
      return "drive";
    }
  });
  return [
    view,
    (v) => {
      setView(v);
      try {
        localStorage.setItem(VIEW_KEY, v);
      } catch {
        // Not persisted; fine.
      }
    },
  ];
}

// Numeric HUD values shown as bars once a loco has used them.
const CONTROLS: { key: keyof DriveState; label: string; percent?: boolean }[] = [
  { key: "powerHandle", label: "Power" },
  { key: "electricBrakeHandle", label: "Dynamic brake" },
  { key: "trainBrakeHandle", label: "Train brake", percent: true },
  { key: "locoBrakeHandle", label: "Loco brake", percent: true },
  { key: "brakeGauge1", label: "Brake gauge 1" },
  { key: "brakeGauge2", label: "Brake gauge 2" },
  { key: "ammeter", label: "Ammeter" },
  { key: "tractiveEffort", label: "Tractive effort" },
  { key: "engineRpm", label: "Engine RPM" },
];

/**
 * Not every loco implements every HUD value; unimplemented ones read 0
 * forever. Show a control only once it has moved, and scale its bar to the
 * largest value seen (handles that report notches rather than 0–1).
 */
function useSeenRanges(objectClass: string | undefined, drive: DriveState | null) {
  const ref = useRef<{ loco?: string; max: Partial<Record<keyof DriveState, number>> }>({ max: {} });
  if (ref.current.loco !== objectClass) ref.current = { loco: objectClass, max: {} };
  if (drive) {
    for (const { key } of CONTROLS) {
      const v = drive[key];
      if (typeof v === "number" && v !== 0) {
        ref.current.max[key] = Math.max(ref.current.max[key] ?? 0, Math.abs(v), 1);
      }
    }
  }
  return ref.current.max;
}

function StatusScreen({ state }: { state: StoreState }) {
  const status = state.data.connection.status;
  let title = "Connecting to bridge…";
  let detail = "Make sure the bridge is running on the gaming PC (npm start).";
  if (state.link === "open") {
    if (status === "no-key") {
      title = "API not enabled";
      detail = "Add -HTTPAPI to Train Sim World 7's Steam launch options and start the game.";
    } else if (status === "waiting-for-game") {
      title = "Waiting for Train Sim World…";
      detail = "Start the game; this screen updates automatically.";
    } else if (status === "no-train") {
      title = "Not in a cab";
      detail = "Load a service or free roam and take control of a train.";
    }
  }
  return (
    <div className="status-screen">
      <div className="spinner" aria-hidden />
      <h1>{title}</h1>
      <p>{detail}</p>
    </div>
  );
}

function formatClock(iso: string | undefined) {
  // LocalTimeISO8601 is already in route-local time; just take HH:MM:SS.
  return iso?.match(/T(\d\d:\d\d:\d\d)/)?.[1] ?? "--:--:--";
}

function prettyLoco(objectClass: string) {
  // RVM_SEH_SE_Class465-9_DMOS_A_C -> Class465-9 DMOS A
  const parts = objectClass.replace(/_C$/, "").split("_");
  const i = parts.findIndex((p) => /^(class|br|db)/i.test(p));
  return (i >= 0 ? parts.slice(i) : parts.slice(-2)).join(" ");
}

export function App() {
  const state = useTelemetry();
  const [unit, toggleUnit] = useSpeedUnit();
  const [view, setView] = useView();
  const t: Telemetry = state.data;
  const ranges = useSeenRanges(t.loco?.objectClass, t.drive);

  const header = (
    <header className="topbar">
      <span className={`dot ${state.link === "open" && t.connection.status === "connected" ? "ok" : "bad"}`} />
      <span className="loco">{t.loco ? prettyLoco(t.loco.objectClass) : "TSW Companion"}</span>
      {t.position?.serviceName && <span className="muted">{t.position.serviceName}</span>}
      <span className="spacer" />
      <div className="segmented" role="tablist">
        {(["drive", "map"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
            {v === "drive" ? "Drive" : "Map"}
          </button>
        ))}
      </div>
      <span className="clock">{formatClock(t.world?.localTimeIso)}</span>
      <span className="muted small" title="Drive updates per second">
        {state.driveHz} Hz
      </span>
      <button className="unit-toggle" onClick={toggleUnit}>
        {UNIT_LABEL[unit]}
      </button>
    </header>
  );

  if (state.link !== "open" || t.connection.status !== "connected" || !t.drive) {
    return (
      <div className="app">
        {header}
        <StatusScreen state={state} />
      </div>
    );
  }

  const d = t.drive;
  const aid = t.driverAid;
  const limit = limitIn(aid?.speedLimit, unit);
  const nextStop = t.track?.markers.find((m) => m.type === "Platform" && m.distance > 0);
  const maxSpeed = aid?.formationMaxSpeed ?? (d.maxPermittedSpeed || null) ?? aid?.trackMaxSpeed ?? null;
  const target = d.speedControlTarget ? Math.round(toUnit(d.speedControlTarget, unit)) : null;

  const signal = aid?.signals[0];
  const nextLimit = aid?.limits[0];

  return (
    <div className="app">
      {header}
      {d.alerter ? <div className="alert vigilance">VIGILANCE: acknowledge</div> : null}
      {d.isSlipping ? <div className="alert slip">WHEELSLIP</div> : null}

      {/* The map stays mounted so its trail and tiles survive switching views. */}
      <main className={`map-view ${view === "map" ? "" : "hidden"}`}>
        <div className="map-col">
          <RouteMap position={t.position} trailKey={t.loco?.objectClass} visible={view === "map"} />
          <div className="map-hud card">
            <div className="col">
              <span className={`hud-speed ${limit != null && toUnit(d.speed ?? 0, unit) > limit + 0.5 ? "over" : ""}`}>
                {Math.round(toUnit(d.speed ?? 0, unit))}
              </span>
              <span className="muted small">{UNIT_LABEL[unit]}</span>
            </div>
            <LimitSign value={limit} size="small" />
            {signal && (
              <div className="row">
                <div className={`signal-head ${aspectColour(signal.aspect)}`} aria-hidden>
                  <i />
                  <i />
                </div>
                <span className="hud-distance">{formatDistance(signal.distance, unit)}</span>
              </div>
            )}
            {nextLimit && (
              <div className="row">
                <LimitSign value={limitIn(nextLimit.limit, unit)} size="small" />
                <span className="hud-distance">{formatDistance(nextLimit.distance, unit)}</span>
              </div>
            )}
          </div>
        </div>
        {view === "map" && <UpcomingStrip driverAid={aid} track={t.track} unit={unit} />}
      </main>

      <main className={`panel ${view === "drive" ? "" : "hidden"}`}>
        <section className="speedo-wrap">
          <Speedometer unit={unit} max={dialMax(maxSpeed, unit)} limit={limit} target={target} />
          <div className="speedo-meta">
            <span>
              Accel <b>{(d.acceleration ?? 0).toFixed(2)}</b> m/s²
            </span>
            {d.direction != null && <span>{d.direction > 0 ? "Forward" : d.direction < 0 ? "Reverse" : "Neutral"}</span>}
            {d.isTractionLocked && <span className="warn">Traction locked</span>}
          </div>
        </section>

        <section className="side">
          <div className="grid2">
            <CurrentLimit limit={aid?.speedLimit ?? null} unit={unit} />
            <NextLimit next={aid?.limits[0]} unit={unit} />
            <NextSignal next={aid?.signals[0]} unit={unit} />
            {nextStop ? (
              <NextStop name={nextStop.name} distance={nextStop.distance} unit={unit} />
            ) : (
              <Gradient gradient={aid?.gradient ?? 0} />
            )}
          </div>
          {nextStop && <Gradient gradient={aid?.gradient ?? 0} />}

          <section className="card controls">
            <h2>Controls</h2>
            {CONTROLS.filter(({ key }) => ranges[key] !== undefined).map(({ key, label, percent }) => {
              const v = (d[key] as number | null) ?? 0;
              const max = ranges[key]!;
              const display = percent && max <= 1 ? `${Math.round(v * 100)}%` : v.toFixed(max <= 1 ? 2 : 1);
              return <Bar key={key} label={label} value={Math.abs(v)} max={max} display={display} />;
            })}
            {CONTROLS.every(({ key }) => ranges[key] === undefined) && (
              <span className="muted small">Controls appear here once you move them.</span>
            )}
          </section>
        </section>

        {view === "drive" && <UpcomingStrip driverAid={aid} track={t.track} unit={unit} />}
      </main>
    </div>
  );
}
