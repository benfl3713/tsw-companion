import type { ReactNode } from "react";
import type { CabValue, DriveState, Telemetry } from "@tsw/shared";
import { toUnit, UNIT_LABEL, type SpeedUnit } from "../../units";
import { SafetyPanel } from "./SafetyPanel";

export const num = (v: CabValue | undefined) => (typeof v === "number" ? v : null);
export const flag = (v: CabValue | undefined) => v === true || (typeof v === "number" && v !== 0);

/**
 * Controller position. Notched controllers (e.g. the 801) report whole notch
 * numbers; continuous ones report percent, negative when braking.
 */
export function handleLabel(handle: number | null): string {
  if (handle == null || Math.abs(handle) < 0.5) return "Coast";
  const prefix = handle > 0 ? "P" : "B";
  const v = Math.abs(handle);
  return Number.isInteger(v) && v <= 10 ? `${prefix}${v}` : `${prefix} ${Math.round(v)}%`;
}

export interface TileSpec {
  label: string;
  state: "on" | "off" | "warn";
}

/** What every loco's desk gets. */
export interface CabDeskProps {
  t: Telemetry;
  drive: DriveState;
  unit: SpeedUnit;
  /** Top of the train's speed range, m/s. */
  maxSpeed: number | null;
  /** Highest-priority driver message, for display text areas. */
  message: string | null;
}

function PressureBar({ label, bar, max }: { label: string; bar: number | null; max: number }) {
  const pct = bar == null ? 0 : Math.max(0, Math.min(1, bar / max)) * 100;
  return (
    <div className="at-pressure">
      <span className="at-pressure-label">{label}</span>
      <div className="at-pressure-track">
        <div className="at-pressure-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="at-pressure-value">{bar == null ? "--" : bar.toFixed(1)}</span>
    </div>
  );
}

/** Traction up, brake down, as one centred bar. */
function DemandBar({ traction, brake }: { traction: number; brake: number }) {
  return (
    <div className="at-demand" role="img" aria-label={`Traction ${traction}%, brake ${brake}%`}>
      <span className="at-demand-label">TE</span>
      <div className="at-demand-track">
        <div className="at-demand-half up">
          <div className="at-demand-fill traction" style={{ height: `${Math.min(100, traction)}%` }} />
        </div>
        <div className="at-demand-zero" />
        <div className="at-demand-half down">
          <div className="at-demand-fill brake" style={{ height: `${Math.min(100, brake)}%` }} />
        </div>
      </div>
      <span className="at-demand-label">BE</span>
      <span className="at-demand-value">{traction > 0 ? `${Math.round(traction)}%` : brake > 0 ? `-${Math.round(brake)}%` : "0%"}</span>
    </div>
  );
}

interface Props {
  drive: DriveState;
  values: Record<string, CabValue> | undefined;
  unit: SpeedUnit;
  formationLength: number | null;
  clockIso: string | undefined;
  /** CSS theme class for the manufacturer's look. */
  theme: string;
  tiles: TileSpec[];
  /** Optional line under the status bar, e.g. the PIS destination. */
  banner?: ReactNode;
}

/**
 * Train management screen (the one beside the speedometer display on
 * modern units): status bar, status tiles, demand and pressures.
 */
export function TmsDisplay({ drive, values, unit, formationLength, clockIso, theme, tiles, banner }: Props) {
  const v = values ?? {};
  // Combined handles report power positive and brake negative in percent.
  const handle = drive.powerHandle ?? 0;
  // The simulation's "*_Percentage" nodes are 0..1 fractions despite the name (seen on the 700).
  const fractionPct = (x: CabValue | undefined) => (num(x) == null ? null : num(x)! * 100);
  // Fall back to the handle only when it's a percentage, not a notch number.
  const handlePct = Math.abs(handle) > 10 || !Number.isInteger(handle) ? handle : 0;
  const traction = fractionPct(v.tractionTargetPct) ?? Math.max(0, handlePct);
  const brake = fractionPct(v.brakeTargetPct) ?? Math.max(0, -handlePct);
  const achieved = fractionPct(v.tractionPct);
  // Vehicles without a given air pipe (e.g. a driving trailer) report nothing; skip those rows.
  const pressures = (
    [
      ["MR", v.mainRes, 10],
      ["BP", v.brakePipe, 10],
      ["BC", v.brakeCylinder, 5],
    ] as const
  ).filter(([, value]) => num(value) != null);
  const speedSet = drive.speedControlTarget;

  return (
    <div className={`at-screen tms ${theme}`}>
      <div className="tms-bar">
        <span className="tms-formation" aria-label={`${formationLength ?? "?"} vehicles`}>
          {Array.from({ length: Math.min(formationLength ?? 1, 12) }, (_, i) => (
            <i key={i} className={i === 0 ? "lead" : ""} />
          ))}
        </span>
        <span className="tms-driver" title="Driver keyed in">
          ◉ {drive.direction != null && drive.direction !== 0 ? (drive.direction > 0 ? "F" : "R") : "N"}
        </span>
        {speedSet != null && speedSet > 0 && (
          <span className="tms-speedset">
            Set {Math.round(toUnit(speedSet, unit))} {UNIT_LABEL[unit]}
          </span>
        )}
        <span className="tms-handle">{handleLabel(drive.powerHandle)}</span>
        <span className="tms-clock">{clockIso?.match(/T(\d\d:\d\d)/)?.[1] ?? "--:--"}</span>
      </div>
      {banner}
      <div className="at-tiles">
        {tiles.map((t) => (
          <div key={t.label} className={`at-tile ${t.state}`}>
            {t.label}
          </div>
        ))}
      </div>

      <div className="at-mid">
        <DemandBar traction={traction} brake={brake} />
        <div className="at-pressures">
          <h3>Pressures (bar)</h3>
          {pressures.map(([label, value, max]) => (
            <PressureBar key={label} label={label} bar={num(value)} max={max} />
          ))}
          {achieved != null && <div className="at-effort">Tractive effort achieved {Math.round(achieved)}%</div>}
          {drive.tractiveEffort != null && drive.tractiveEffort > 1.5 && (
            <div className="at-effort">Tractive effort {(drive.tractiveEffort / 1000).toFixed(0)} kN</div>
          )}
          {drive.brakeEffort != null && drive.brakeEffort > 1.5 && (
            <div className="at-effort">Brake effort {(drive.brakeEffort / 1000).toFixed(0)} kN</div>
          )}
        </div>
      </div>

      <SafetyPanel values={values} />
    </div>
  );
}
