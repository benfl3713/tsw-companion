import type { ReactNode } from "react";
import type { CabValue, DriveState } from "@tsw/shared";
import { Speedometer } from "../Speedometer";
import type { SpeedUnit } from "../../units";
import { SafetyPanel } from "./SafetyPanel";

export const num = (v: CabValue | undefined) => (typeof v === "number" ? v : null);
export const flag = (v: CabValue | undefined) => v === true || (typeof v === "number" && v !== 0);

export interface TileSpec {
  label: string;
  state: "on" | "off" | "warn";
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

export interface TmsScreenProps {
  drive: DriveState;
  values: Record<string, CabValue> | undefined;
  unit: SpeedUnit;
  dialMax: number;
  limit: number | null;
  target: number | null;
}

interface Props extends TmsScreenProps {
  /** CSS theme class for the manufacturer's look. */
  theme: string;
  tiles: TileSpec[];
  /** Optional line above the tiles, e.g. the PIS destination. */
  banner?: ReactNode;
}

/**
 * Modern driver display: speedo on the left, train management on the right.
 * Built from live values; the game's own screens can't be streamed.
 */
export function TmsDisplay({ drive, values, unit, dialMax, limit, target, theme, tiles, banner }: Props) {
  const v = values ?? {};
  // Combined handles report power positive and brake negative in percent.
  const handle = drive.powerHandle ?? 0;
  // The simulation's "*_Percentage" nodes are 0..1 fractions despite the name (seen on the 700).
  const fractionPct = (x: CabValue | undefined) => (num(x) == null ? null : num(x)! * 100);
  const traction = fractionPct(v.tractionTargetPct) ?? Math.max(0, handle);
  const brake = fractionPct(v.brakeTargetPct) ?? Math.max(0, -handle);
  const achieved = fractionPct(v.tractionPct);
  // Vehicles without a given air pipe (e.g. a driving trailer) report nothing; skip those rows.
  const pressures = (
    [
      ["MR", v.mainRes, 10],
      ["BP", v.brakePipe, 10],
      ["BC", v.brakeCylinder, 5],
    ] as const
  ).filter(([, value]) => num(value) != null);

  return (
    <div className={`at-screen ${theme}`}>
      <div className="at-left">
        <Speedometer unit={unit} max={dialMax} limit={limit} target={target} />
        <div className="at-handle">
          {handle > 0 ? `P${Math.round(handle)}%` : handle < 0 ? `B${Math.round(-handle)}%` : "Coast"}
          {drive.direction != null && (
            <span className="muted"> · {drive.direction > 0 ? "Forward" : drive.direction < 0 ? "Reverse" : "Neutral"}</span>
          )}
        </div>
      </div>

      <div className="at-right">
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
    </div>
  );
}
