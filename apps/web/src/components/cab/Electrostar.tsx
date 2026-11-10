import { useState } from "react";
import type { CabValue, DriveState } from "@tsw/shared";
import { toUnit, UNIT_LABEL } from "../../units";
import { Gauge } from "./Gauge";
import { SafetyPanel } from "./SafetyPanel";
import { num, type CabDeskProps } from "./TmsDisplay";

// Class 375/377/379/387 (Bombardier Electrostar) desk: analogue speedometer,
// duplex brake gauge, LED AWS sunflower and TPWS panel, with the MITRAC train
// management screen on the IDU to the driver's left. Pages follow the
// Electrostar's: Driver's Menu, Door Status, Traction Status.

const PA_PER_BAR = 100_000;

/**
 * Electrostar controllers have 4 power notches and 3 brake steps plus
 * emergency. The HUD reports either notch numbers or a percentage.
 */
export function controllerNotch(handle: number | null, emergency: boolean): string {
  if (emergency) return "EB";
  if (handle == null || Math.abs(handle) < 0.5) return "OFF";
  const whole = Number.isInteger(handle);
  if (handle > 0) return `P${whole && handle <= 4 ? handle : Math.min(4, Math.ceil(handle / 25))}`;
  const q = -handle;
  return `B${whole && q <= 3 ? q : Math.min(3, Math.ceil(q / 33.4))}`;
}

function AnalogueClock({ iso }: { iso: string | undefined }) {
  const m = iso?.match(/T(\d\d):(\d\d):(\d\d)/);
  const h = m ? Number(m[1]) : 0;
  const min = m ? Number(m[2]) : 0;
  const s = m ? Number(m[3]) : 0;
  const hand = (deg: number, len: number, w: number) => (
    <line x1={0} y1={0} x2={0} y2={-len} stroke="#111" strokeWidth={w} strokeLinecap="round" transform={`rotate(${deg})`} />
  );
  return (
    <svg className="mitrac-clock" viewBox="-50 -50 100 100" role="img" aria-label="Clock">
      <circle r={47} fill="#fff" stroke="#1d3f7a" strokeWidth={3} />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1={0} y1={-40} x2={0} y2={-46} stroke="#111" strokeWidth={2} transform={`rotate(${i * 30})`} />
      ))}
      {hand((h % 12) * 30 + min / 2, 24, 4)}
      {hand(min * 6, 36, 3)}
      <line x1={0} y1={6} x2={0} y2={-40} stroke="#c00" strokeWidth={1} transform={`rotate(${s * 6})`} />
    </svg>
  );
}

type Page = "driver" | "doors" | "traction";

function Mitrac({ drive, values, formationLength, clockIso }: {
  drive: DriveState;
  values: Record<string, CabValue>;
  formationLength: number | null;
  clockIso: string | undefined;
}) {
  const [page, setPage] = useState<Page>("driver");
  const cars = Math.min(formationLength ?? 4, 12);
  const te = drive.tractiveEffort;
  // Tractive effort comes as a fraction on some units and in newtons on others.
  const tePct = te == null ? null : te <= 1.5 ? te * 100 : null;
  const handle = drive.powerHandle ?? 0;
  const brakePct = handle < 0 ? Math.min(100, -handle > 3 ? -handle : (-handle / 3) * 100) : 0;
  const dooText = values.dooEnabled == null ? "—" : values.dooEnabled ? "Enabled" : "Not enabled";

  return (
    <div className="mitrac">
      <div className="mitrac-formation">
        {Array.from({ length: cars }, (_, i) => (
          <span key={i} className={i === 0 ? "lead" : ""}>
            {i + 1}
          </span>
        ))}
      </div>
      <h3 className="mitrac-title">{page === "driver" ? "Driver's Menu" : page === "doors" ? "Door Status" : "Traction Status"}</h3>
      <div className="mitrac-body">
        {page === "driver" && (
          <div className="mitrac-driver">
            <table>
              <tbody>
                <tr>
                  <td>OTMR</td>
                  <td className="ok">OK</td>
                </tr>
                <tr>
                  <td>Door isolations</td>
                  <td className="ok">None</td>
                </tr>
                <tr>
                  <td>Traction sand</td>
                  <td className="ok">Available</td>
                </tr>
                <tr>
                  <td>Driver Only Operation</td>
                  <td>{dooText}</td>
                </tr>
              </tbody>
            </table>
            <AnalogueClock iso={clockIso} />
          </div>
        )}
        {page === "doors" && (
          <div className="mitrac-doors">
            {Array.from({ length: cars }, (_, i) => (
              <div key={i} className="mitrac-car">
                <span>Car {i + 1}</span>
                <div className="mitrac-door-row">
                  {[0, 1, 2, 3].map((d) => (
                    <i key={d} className={values.doorsOpen ? "open" : ""} />
                  ))}
                </div>
              </div>
            ))}
            <p className="mitrac-note">{values.doorsOpen == null ? "Door states not reported by this unit." : values.doorsOpen ? "Doors open" : "All doors closed and locked"}</p>
          </div>
        )}
        {page === "traction" && (
          <div className="mitrac-traction">
            {Array.from({ length: Math.max(1, Math.floor(cars / 2)) }, (_, i) => (
              <div key={i} className="mitrac-te">
                <span>MCM {i + 1}</span>
                <div className="mitrac-te-track">
                  <div className="mitrac-te-fill power" style={{ width: `${Math.max(0, Math.min(100, tePct ?? (handle > 0 ? (handle > 4 ? handle : handle * 25) : 0)))}%` }} />
                  <div className="mitrac-te-fill brake" style={{ width: `${brakePct}%` }} />
                </div>
                <span className="ok">OK</span>
              </div>
            ))}
            <div className="mitrac-te">
              <span>ACM</span>
              <span className="muted-dark">Auxiliary converters</span>
              <span className="ok">OK</span>
            </div>
          </div>
        )}
      </div>
      <nav className="mitrac-tabs">
        {(
          [
            ["driver", "Driver's Menu"],
            ["doors", "Doors"],
            ["traction", "Traction"],
          ] as const
        ).map(([p, label]) => (
          <button key={p} className={page === p ? "on" : ""} onClick={() => setPage(p)}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export function Electrostar({ t, drive, unit }: CabDeskProps) {
  const v = t.cab?.values ?? {};
  const speed = toUnit(drive.speed ?? 0, unit);
  const top = unit === "mph" ? 120 : 200;
  const speedSet = drive.speedControlTarget ? toUnit(drive.speedControlTarget, unit) : null;
  // Prefer the HUD's own gauge; some units leave it at 0, so fall back to the simulation pressures.
  const brakeBar = (pa: number | null, fallback: CabValue | undefined) =>
    pa ? pa / PA_PER_BAR : (num(fallback) ?? (pa == null ? null : 0));
  const emergency = v.safetyBrakeDemand === true || v.dsdPenalty === true;

  return (
    <div className="desk desk-electrostar">
      <Mitrac drive={drive} values={v} formationLength={t.loco?.formationLength ?? null} clockIso={t.world?.localTimeIso} />
      <div className="es-cluster">
        <div className="es-speedo">
          <Gauge
            label=""
            unit={UNIT_LABEL[unit]}
            max={top}
            majorStep={unit === "mph" ? 10 : 20}
            minorStep={unit === "mph" ? 5 : 10}
            needles={[{ value: speed, colour: "white" }]}
            markers={speedSet != null ? [{ value: speedSet, colour: "red" }] : []}
            digits={null}
          />
        </div>
        <div className="es-side">
          <Gauge
            label="Brake"
            unit="bar"
            max={10}
            majorStep={2}
            minorStep={1}
            needles={[
              { value: brakeBar(drive.brakeGauge1Red, v.mainRes), colour: "red" },
              { value: brakeBar(drive.brakeGauge1, v.brakeCylinder), colour: "white" },
            ]}
            digits={null}
          />
          <div className="es-controller" aria-label="Power brake controller">
            <span className="es-controller-label">Controller</span>
            <span className={`es-controller-notch ${emergency ? "eb" : ""}`}>{controllerNotch(drive.powerHandle, emergency)}</span>
          </div>
        </div>
        <div className="es-safety">
          <SafetyPanel values={t.cab?.values} />
        </div>
      </div>
    </div>
  );
}
