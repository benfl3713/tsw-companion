import type { CabValue, DriveState } from "@tsw/shared";
import { Speedometer } from "../Speedometer";
import type { SpeedUnit } from "../../units";
import { SafetyPanel } from "./SafetyPanel";

const num = (v: CabValue | undefined) => (typeof v === "number" ? v : null);
const flag = (v: CabValue | undefined) => v === true || (typeof v === "number" && v !== 0);

function Tile({ label, state }: { label: string; state: "on" | "off" | "warn" }) {
  return <div className={`at-tile ${state}`}>{label}</div>;
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
  dialMax: number;
  limit: number | null;
  target: number | null;
}

/**
 * Driver display in the style of Hitachi AT300 units (Class 80x): speedo on
 * the left, train management on the right. Built from live values; the game's
 * own screens can't be streamed.
 */
export function HitachiAt300({ drive, values, unit, dialMax, limit, target }: Props) {
  const v = values ?? {};
  // The combined handle reports power positive and brake negative in percent.
  const handle = drive.powerHandle ?? 0;
  const traction = num(v.tractionTargetPct) ?? Math.max(0, handle);
  const brake = num(v.brakeTargetPct) ?? Math.max(0, -handle);
  const dieselMode = flag(v.engineRunning);

  if (v.displayPowered === false) {
    return <div className="at-screen at-off">Display not powered</div>;
  }

  return (
    <div className="at-screen">
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
        <div className="at-tiles">
          <Tile label={dieselMode ? "Diesel" : "Electric"} state="on" />
          <Tile label="Line powered" state={flag(v.trainLinePowered) ? "on" : "off"} />
          <Tile label="Traction lock" state={flag(v.tractionLocked) || drive.isTractionLocked ? "warn" : "off"} />
          <Tile label="DRA" state={flag(v.draSet) ? "warn" : "off"} />
          <Tile label="Brake hold" state={flag(v.brakeHoldSpeedReached) ? "on" : "off"} />
          <Tile label="Wheelslip" state={drive.isSlipping ? "warn" : "off"} />
        </div>

        <div className="at-mid">
          <DemandBar traction={traction} brake={brake} />
          <div className="at-pressures">
            <h3>Pressures (bar)</h3>
            <PressureBar label="MR" bar={num(v.mainRes)} max={10} />
            <PressureBar label="BP" bar={num(v.brakePipe)} max={10} />
            <PressureBar label="BC" bar={num(v.brakeCylinder)} max={5} />
            {drive.tractiveEffort != null && drive.tractiveEffort > 1 && (
              <div className="at-effort">Tractive effort {(drive.tractiveEffort / 1000).toFixed(0)} kN</div>
            )}
            {drive.brakeEffort != null && drive.brakeEffort > 1 && (
              <div className="at-effort">Brake effort {(drive.brakeEffort / 1000).toFixed(0)} kN</div>
            )}
          </div>
        </div>

        <SafetyPanel values={values} />
      </div>
    </div>
  );
}
