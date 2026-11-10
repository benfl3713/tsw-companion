import { useState } from "react";
import type { CabValue, DriveState } from "@tsw/shared";
import { toUnit, UNIT_LABEL } from "../../units";
import { Gauge } from "./Gauge";
import { AwsIndicator, SafetyPanel } from "./SafetyPanel";
import { flag, num, type CabDeskProps } from "./TmsDisplay";

// Class 375/377/379/387 (Bombardier Electrostar) desk: analogue speedometer,
// brake gauge, AWS sunflower and TPWS panel, with the MITRAC train
// management screen on the IDU to the driver's left. Pages follow the
// Electrostar's: Driver's Menu, Door Status, Traction Status.

const PA_PER_BAR = 100_000;

/** The 377's 9-position controller, by notch index. */
const NOTCH_NAMES_9 = ["EB", "B3", "B2", "B1", "OFF", "P1", "P2", "P3", "P4"];

/**
 * Controller position. Uses the controller's own notch index where the
 * profile reads it (verified on the 377), else infers from the HUD handle,
 * which reports notch numbers or a percentage.
 */
export function controllerNotch(handle: number | null, values: Record<string, CabValue>): string {
  const index = num(values.controllerNotch);
  if (index != null && num(values.controllerNotchCount) === NOTCH_NAMES_9.length) return NOTCH_NAMES_9[index] ?? "OFF";
  if (flag(values.emergencyBrake)) return "EB";
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

const DOORS = [
  ["doorFL", "Front left"],
  ["doorFR", "Front right"],
  ["doorBL", "Rear left"],
  ["doorBR", "Rear right"],
] as const;

function Mitrac({ drive, values, formationLength, clockIso, notch }: {
  drive: DriveState;
  values: Record<string, CabValue>;
  formationLength: number | null;
  clockIso: string | undefined;
  notch: string;
}) {
  const [page, setPage] = useState<Page>("driver");
  const cars = Math.min(formationLength ?? 4, 12);
  const doorValues = DOORS.map(([key]) => num(values[key]));
  const doorsKnown = doorValues.some((d) => d != null);
  const doorsOpen = doorValues.some((d) => d != null && d > 0.01);
  // Traction demand from the notch: P1–P4 = 25–100 %, B1–B3 = 33–100 % brake.
  const step = Number(notch.slice(1));
  const powerPct = notch.startsWith("P") ? step * 25 : 0;
  const brakePct = notch === "EB" ? 100 : notch.startsWith("B") ? Math.round((step / 3) * 100) : 0;

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
                  <td>Doors</td>
                  <td className={doorsOpen ? "warn-dark" : "ok"}>{!doorsKnown ? "—" : doorsOpen ? "Open" : "Closed"}</td>
                </tr>
                <tr>
                  <td>Driver reminder (DRA)</td>
                  <td className={flag(values.draSet) ? "warn-dark" : ""}>{values.draSet == null ? "—" : flag(values.draSet) ? "Set" : "Off"}</td>
                </tr>
                <tr>
                  <td>Traction</td>
                  <td className={flag(values.tractionLocked) ? "warn-dark" : "ok"}>
                    {flag(values.tractionLocked) ? "Interlocked" : "Available"}
                  </td>
                </tr>
              </tbody>
            </table>
            <AnalogueClock iso={clockIso} />
          </div>
        )}
        {page === "doors" && (
          <div className="mitrac-doors">
            <div className="mitrac-car wide">
              <span>Car 1 (this vehicle)</span>
              <div className="mitrac-door-grid">
                {DOORS.map(([key, label], i) => (
                  <div key={key} className="mitrac-door">
                    <i className={(doorValues[i] ?? 0) > 0.01 ? "open" : ""} />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="mitrac-note">
              {!doorsKnown
                ? "Door states not reported by this unit."
                : doorsOpen
                  ? "Doors open"
                  : "All doors closed and locked"}
              {doorsKnown && cars > 1 && " · Other vehicles aren't reported by the game."}
            </p>
          </div>
        )}
        {page === "traction" && (
          <div className="mitrac-traction">
            {Array.from({ length: Math.max(1, Math.floor(cars / 2)) }, (_, i) => (
              <div key={i} className="mitrac-te">
                <span>MCM {i + 1}</span>
                <div className="mitrac-te-track">
                  <div className="mitrac-te-fill power" style={{ width: `${powerPct}%` }} />
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
            <p className="mitrac-note">
              Controller {notch} · {drive.isSlipping ? "Wheelslip!" : "No slip"}
            </p>
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
  const setPoint = flag(v.speedSetActive) ? num(v.speedSetPoint) : drive.speedControlTarget;
  const speedSet = setPoint ? toUnit(setPoint, unit) : null;
  // The simulation's gauge pressures first: the 377's HUD gauges report absolute pressure.
  const pressure = (sim: CabValue | undefined, hudPa: number | null) =>
    num(sim) ?? (hudPa == null ? null : Math.max(0, hudPa / PA_PER_BAR - 1.013));
  const notch = controllerNotch(drive.powerHandle, v);

  return (
    <div className="desk desk-electrostar">
      <Mitrac drive={drive} values={v} formationLength={t.loco?.formationLength ?? null} clockIso={t.world?.localTimeIso} notch={notch} />
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
              { value: pressure(v.mainRes, drive.brakeGauge1Red), colour: "red" },
              { value: pressure(v.brakeCylinder, drive.brakeGauge1), colour: "white" },
            ]}
            digits={null}
          />
          <div className="es-gauge-key">
            <span className="red">● MR</span> <span>● BC</span>
          </div>
          <div className="es-controls">
            <div className="es-controller" aria-label="Power brake controller">
              <span className="es-controller-label">Controller</span>
              <span className={`es-controller-notch ${notch === "EB" ? "eb" : ""}`}>{notch}</span>
            </div>
            {/* The AWS sunflower sits on the desk beside the instruments, as in the cab */}
            <AwsIndicator values={t.cab?.values} size={96} />
          </div>
        </div>
        <div className="es-safety">
          <SafetyPanel values={t.cab?.values} showAws={false} />
        </div>
      </div>
    </div>
  );
}
