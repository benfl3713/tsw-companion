import { useRef } from "react";
import type { CabValue, DriveState } from "@tsw/shared";
import { Speedometer } from "../Speedometer";
import type { SpeedUnit } from "../../units";
import { Gauge } from "./Gauge";
import { SafetyPanel } from "./SafetyPanel";

const PA_PER_BAR = 100_000;
const bar = (pa: number | null) => (pa == null ? null : pa / PA_PER_BAR);

/** Largest absolute value seen per key for this loco; gauges stay hidden until they move. */
function useSeen(objectClass: string, drive: DriveState) {
  const ref = useRef<{ loco: string; max: Record<string, number> }>({ loco: objectClass, max: {} });
  if (ref.current.loco !== objectClass) ref.current = { loco: objectClass, max: {} };
  for (const key of ["brakeGauge1", "brakeGauge1Red", "brakeGauge2", "brakeGauge2Red", "ammeter", "engineRpm"] as const) {
    const v = drive[key];
    if (typeof v === "number" && v !== 0) ref.current.max[key] = Math.max(ref.current.max[key] ?? 0, Math.abs(v));
  }
  return ref.current.max;
}

/** Rounds a gauge's top up to a tidy number. */
function niceMax(seen: number, steps: number[]) {
  return steps.find((s) => s >= seen * 1.1) ?? steps[steps.length - 1]!;
}

interface Props {
  objectClass: string;
  drive: DriveState;
  values: Record<string, CabValue> | undefined;
  unit: SpeedUnit;
  dialMax: number;
  limit: number | null;
  target: number | null;
}

/**
 * Analogue cab instruments: speedometer, duplex brake gauges and ammeter.
 * Uses the universal HUD values, so it works for any loco without a profile.
 */
export function AnalogueEmu({ objectClass, drive, values, unit, dialMax, limit, target }: Props) {
  const seen = useSeen(objectClass, drive);
  const gauge1 = seen.brakeGauge1 || seen.brakeGauge1Red;
  const gauge2 = seen.brakeGauge2 || seen.brakeGauge2Red;

  return (
    <div className="analogue">
      <div className="analogue-speedo">
        <Speedometer unit={unit} max={dialMax} limit={limit} target={target} />
      </div>
      <div className="analogue-gauges">
        {gauge1 ? (
          <Gauge
            label="Brake 1"
            unit="bar"
            max={niceMax(bar(gauge1)!, [2, 4, 5, 10, 12])}
            majorStep={niceMax(bar(gauge1)!, [2, 4, 5, 10, 12]) > 5 ? 2 : 1}
            needles={[
              { value: bar(drive.brakeGauge1), colour: "white" },
              { value: bar(drive.brakeGauge1Red), colour: "red" },
            ]}
          />
        ) : null}
        {gauge2 ? (
          <Gauge
            label="Brake 2"
            unit="bar"
            max={niceMax(bar(gauge2)!, [2, 4, 5, 10, 12])}
            majorStep={niceMax(bar(gauge2)!, [2, 4, 5, 10, 12]) > 5 ? 2 : 1}
            needles={[
              { value: bar(drive.brakeGauge2), colour: "white" },
              { value: bar(drive.brakeGauge2Red), colour: "red" },
            ]}
          />
        ) : null}
        {seen.ammeter ? (
          <Gauge
            label="Amps"
            unit="A"
            min={-niceMax(seen.ammeter, [500, 1000, 2000, 4000])}
            max={niceMax(seen.ammeter, [500, 1000, 2000, 4000])}
            majorStep={niceMax(seen.ammeter, [500, 1000, 2000, 4000]) / 2}
            needles={[{ value: drive.ammeter, colour: "white" }]}
            digits={0}
          />
        ) : null}
        {seen.engineRpm ? (
          <Gauge
            label="Engine"
            unit="rpm"
            max={niceMax(seen.engineRpm, [1000, 2000, 3000])}
            majorStep={500}
            needles={[{ value: drive.engineRpm, colour: "white" }]}
            digits={0}
          />
        ) : null}
        {!gauge1 && !gauge2 && !seen.ammeter && !seen.engineRpm && (
          <p className="muted small">Gauges appear once the loco reports them (apply a brake or take power).</p>
        )}
        <SafetyPanel values={values} />
      </div>
    </div>
  );
}
