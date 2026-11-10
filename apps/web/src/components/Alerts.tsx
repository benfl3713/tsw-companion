import { adviseBraking, brakeTargets, type Telemetry } from "@tsw/shared";
import { useAlertSound } from "../audio";
import { formatDistance, limitIn, toUnit, UNIT_LABEL, type SpeedUnit } from "../units";

const flag = (v: unknown) => v === true || (typeof v === "number" && v !== 0);

/**
 * Warnings that need the driver's attention, shown under the top bar in every
 * view, with matching sounds when sound is on.
 */
export function Alerts({ t, unit, sound }: { t: Telemetry; unit: SpeedUnit; sound: boolean }) {
  const d = t.drive;
  const speed = d?.speed ?? 0;
  const limit = t.driverAid?.speedLimit ?? null;
  // A little tolerance so needle wobble at the limit doesn't nag.
  const overBy = limit != null ? toUnit(speed, unit) - limitIn(limit, unit)! : 0;
  const overspeed = overBy >= 1;

  const advice = adviseBraking(speed, brakeTargets(t.driverAid));
  const target = advice.target;
  const targetLabel = target
    ? target.kind === "signal"
      ? "red signal"
      : `${Math.round(toUnit(target.targetSpeed, unit))} ${UNIT_LABEL[unit]}`
    : "";

  const cab = t.cab?.values;
  const aws = flag(cab?.awsWarning);
  const dsd = flag(cab?.dsdWarning) || flag(d?.alerter);
  const brakeDemand = flag(cab?.safetyBrakeDemand) || flag(cab?.dsdPenalty);

  useAlertSound(sound, advice.level === "approach", "approach");
  useAlertSound(sound, advice.level === "brake", "brake");
  useAlertSound(sound, advice.level === "urgent", "urgent", 1200);
  useAlertSound(sound, overspeed, "overspeed", 2000);
  useAlertSound(sound, aws, "aws", 1000);
  useAlertSound(sound, dsd, "dsd", 700);

  return (
    <>
      {aws && <div className="alert vigilance">AWS: acknowledge</div>}
      {dsd && <div className="alert vigilance">VIGILANCE: acknowledge</div>}
      {brakeDemand && <div className="alert vigilance">BRAKE DEMAND</div>}
      {d?.isSlipping && <div className="alert slip">WHEELSLIP</div>}
      {overspeed && (
        <div className="alert overspeed">
          OVERSPEED +{Math.round(overBy)} {UNIT_LABEL[unit]}
        </div>
      )}
      {advice.level === "approach" && target && (
        <div className="alert advice approach">
          Brake in {formatDistance(advice.brakeIn, unit)} for {targetLabel}
        </div>
      )}
      {advice.level === "brake" && target && (
        <div className="alert advice brake">
          BRAKE for {targetLabel} in {formatDistance(target.distance, unit)}
        </div>
      )}
      {advice.level === "urgent" && target && (
        <div className="alert advice urgent">
          BRAKE HARD for {targetLabel}: {advice.requiredDecel.toFixed(2)} m/s² needed
        </div>
      )}
    </>
  );
}
