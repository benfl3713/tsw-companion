import { useRef, useState } from "react";
import { PROFILES, type DriveState, type Telemetry } from "@tsw/shared";
import { AnalogueEmu } from "./components/cab/AnalogueEmu";
import { DesiroCity } from "./components/cab/DesiroCity";
import { Electrostar } from "./components/cab/Electrostar";
import { HitachiAt300 } from "./components/cab/HitachiAt300";
import { Alerts } from "./components/Alerts";
import { useSound } from "./audio";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  aspectColour,
  Bar,
  CurrentLimit,
  Gradient,
  LimitSign,
  NextLimit,
  NextSignal,
  NextStop,
  ServiceCard,
} from "./components/Indicators";
import { RouteMap } from "./components/RouteMap";
import { dialMax, Speedometer } from "./components/Speedometer";
import { UpcomingStrip } from "./components/UpcomingStrip";
import { useTelemetry, type StoreState } from "./telemetry";
import { formatDistance, limitIn, toUnit, UNIT_LABEL, useSpeedUnit } from "./units";

const VIEWS = ["drive", "cab", "map"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = { drive: "Drive", cab: "Cab", map: "Map" };
const VIEW_KEY = "tsw.view";

function useView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return (VIEWS as readonly string[]).includes(v ?? "") ? (v as View) : "drive";
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

type ControlKind = "handle" | "fraction" | "pressure" | "amps" | "force" | "rpm";

// HUD values shown as bars. Handles are null when the loco lacks them;
// gauges read 0 when absent, so those appear once they've moved.
const CONTROLS: { key: keyof DriveState; label: string; kind: ControlKind }[] = [
  { key: "powerHandle", label: "Power handle", kind: "handle" },
  { key: "electricBrakeHandle", label: "Dynamic brake", kind: "fraction" },
  { key: "trainBrakeHandle", label: "Train brake", kind: "fraction" },
  { key: "locoBrakeHandle", label: "Loco brake", kind: "fraction" },
  { key: "brakeGauge1", label: "Brake gauge 1", kind: "pressure" },
  { key: "brakeGauge2", label: "Brake gauge 2", kind: "pressure" },
  { key: "ammeter", label: "Ammeter", kind: "amps" },
  { key: "tractiveEffort", label: "Tractive effort", kind: "force" },
  { key: "engineRpm", label: "Engine", kind: "rpm" },
];

function formatControl(kind: ControlKind, v: number, max: number): string {
  switch (kind) {
    case "handle":
      // Combined handles go -100..100 (%); others report notches or 0..1.
      return max > 10 ? `${Math.round(v)}%` : v.toFixed(max <= 1 ? 2 : 0);
    case "fraction":
      return `${Math.round(v * 100)}%`;
    case "pressure":
      return `${(v / 100_000).toFixed(1)} bar`;
    case "amps":
      return `${Math.round(v)} A`;
    case "force":
      // Some locos (e.g. Class 700) report a 0..1 fraction here instead of newtons.
      return max <= 1.5 ? `${Math.round(v * 100)}%` : `${Math.round(v / 1000)} kN`;
    case "rpm":
      return `${Math.round(v)} rpm`;
  }
}

/**
 * Largest absolute value seen per control for this loco, used to scale bars
 * (handles may report notches, percent or 0..1) and to reveal gauges.
 */
function useSeenRanges(objectClass: string | undefined, drive: DriveState | null) {
  const ref = useRef<{ loco?: string; max: Partial<Record<keyof DriveState, number>> }>({ max: {} });
  if (ref.current.loco !== objectClass) ref.current = { loco: objectClass, max: {} };
  if (drive) {
    for (const { key } of CONTROLS) {
      const v = drive[key];
      if (typeof v === "number" && v !== 0) {
        ref.current.max[key] = Math.max(ref.current.max[key] ?? 0, Math.abs(v));
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
  const [sound, toggleSound] = useSound();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const t: Telemetry = state.data;
  const ranges = useSeenRanges(t.loco?.objectClass, t.drive);

  const header = (
    <header className="topbar">
      <span className={`dot ${state.link === "open" && t.connection.status === "connected" ? "ok" : "bad"}`} />
      <span className="loco">{t.loco ? prettyLoco(t.loco.objectClass) : "TSW Companion"}</span>
      {t.position?.serviceName && <span className="muted">{t.position.serviceName}</span>}
      <span className="spacer" />
      <div className="segmented" role="tablist">
        {VIEWS.map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>
      <span className="clock">{formatClock(t.world?.localTimeIso)}</span>
      <span className="muted small" title="Drive updates per second">
        {state.driveHz} Hz
      </span>
      <button className={`unit-toggle ${sound ? "" : "off"}`} onClick={toggleSound} title="Alert sounds">
        {sound ? "Sound on" : "Sound off"}
      </button>
      <button className="unit-toggle" onClick={toggleUnit}>
        {UNIT_LABEL[unit]}
      </button>
      <button className="unit-toggle icon" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
        ⚙
      </button>
      {settingsOpen && (
        <SettingsPanel unit={unit} sound={sound} onToggleSound={toggleSound} onClose={() => setSettingsOpen(false)} />
      )}
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
  const dial = dialMax(maxSpeed, unit);
  const visibleControls = CONTROLS.filter(({ key, kind }) =>
    kind === "handle" || kind === "fraction" ? d[key] != null : ranges[key] !== undefined,
  );
  const profile = PROFILES.find((p) => p.id === t.cab?.profileId);
  // Text for the ETCS display's message area, most urgent first.
  const cabValues = t.cab?.values;
  const cabMessage =
    cabValues?.awsWarning
      ? "AWS: acknowledge"
      : cabValues?.dsdWarning || d.alerter
        ? "Vigilance: acknowledge"
        : cabValues?.safetyBrakeDemand
          ? "Brake demand"
          : limit != null && toUnit(d.speed ?? 0, unit) > limit + 1
            ? "Overspeed"
            : null;

  return (
    <div className="app">
      {header}
      <div className="alerts">
        <Alerts t={t} unit={unit} sound={sound} />
      </div>

      {/* Cab: the loco's own desk displays, full screen, nothing generic. */}
      {view === "cab" && (
        <main className="cab-view">
          {profile?.screen === "hitachi-at300" ? (
            <HitachiAt300 t={t} drive={d} unit={unit} maxSpeed={maxSpeed} message={cabMessage} />
          ) : profile?.screen === "desiro-city" ? (
            <DesiroCity t={t} drive={d} unit={unit} maxSpeed={maxSpeed} message={cabMessage} />
          ) : profile?.screen === "electrostar" ? (
            <Electrostar t={t} drive={d} unit={unit} maxSpeed={maxSpeed} message={cabMessage} />
          ) : (
            <AnalogueEmu
              objectClass={t.loco?.objectClass ?? ""}
              drive={d}
              values={t.cab?.values}
              unit={unit}
              dialMax={dial}
              limit={limit}
              target={target}
            />
          )}
        </main>
      )}

      {/* The map stays mounted so its trail and tiles survive switching views. */}
      <main className={`map-view ${view === "map" ? "" : "hidden"}`}>
        <div className="map-col">
          <RouteMap
            position={t.position}
            trailKey={t.loco?.objectClass}
            visible={view === "map"}
            recorded={state.recorded}
            unit={unit}
          />
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
          <Speedometer unit={unit} max={dial} limit={limit} target={target} />
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
          <ServiceCard serviceName={t.position?.serviceName ?? null} objective={t.objective} />


          <section className="card controls">
            <h2>Controls</h2>
            {visibleControls.map(({ key, label, kind }) => {
              const v = (d[key] as number | null) ?? 0;
              const max = Math.max(ranges[key] ?? 0, kind === "fraction" ? 1 : 0, 1e-9);
              return <Bar key={key} label={label} value={Math.abs(v)} max={max} display={formatControl(kind, v, max)} />;
            })}
            {visibleControls.length === 0 && <span className="muted small">Controls appear here once you move them.</span>}
          </section>
        </section>

        {view === "drive" && <UpcomingStrip driverAid={aid} track={t.track} unit={unit} />}
      </main>
    </div>
  );
}
