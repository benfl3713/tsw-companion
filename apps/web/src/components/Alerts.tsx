import {
  adviseBraking,
  brakeTargets,
  DEFAULT_BRAKE_OPTIONS,
  doorCue,
  doorsClosedFrom,
  formatCountdown,
  type Telemetry,
} from "@tsw/shared";
import { useAlertSound } from "../audio";
import { useSettings } from "../settings";
import { awsWarningActive, dsdWarningActive } from "@tsw/shared";
import { formatDistance, limitIn, toUnit, UNIT_LABEL, type SpeedUnit } from "../units";

const flag = (v: unknown) => v === true || (typeof v === "number" && v !== 0);

/**
 * Warnings that need the driver's attention, shown under the top bar in every
 * view, with matching sounds when sound is on. Each can be turned off in Settings.
 */
export function Alerts({ t, unit, sound }: { t: Telemetry; unit: SpeedUnit; sound: boolean }) {
  const { settings } = useSettings();
  const show = settings.alerts;
  const audible = (key: keyof typeof show) => sound && show[key] && settings.sounds[key];

  const d = t.drive;
  const speed = d?.speed ?? 0;
  const limit = t.driverAid?.speedLimit ?? null;
  const overBy = limit != null ? toUnit(speed, unit) - limitIn(limit, unit)! : 0;
  // Always at least 0.5 over, so needle wobble at the limit doesn't nag.
  const overspeed = show.overspeed && overBy >= Math.max(0.5, settings.overspeedTolerance);

  const options = { ...DEFAULT_BRAKE_OPTIONS, comfortDecel: settings.comfortDecel, urgentDecel: settings.urgentDecel };
  const advice = show.braking ? adviseBraking(speed, brakeTargets(t.driverAid, options), options) : null;
  const level = advice?.level === "approach" && settings.brakingAdvice !== "countdown" ? "none" : (advice?.level ?? "none");
  const target = advice?.target;
  const targetLabel = target
    ? target.kind === "signal"
      ? "red signal"
      : `${Math.round(toUnit(target.targetSpeed, unit))} ${UNIT_LABEL[unit]}`
    : "";

  const cab = t.cab?.values;
  const aws = show.aws && awsWarningActive(cab);
  const dsd = show.vigilance && (dsdWarningActive(cab) || flag(d?.alerter));
  const brakeDemand = show.brakeDemand && (flag(cab?.safetyBrakeDemand) || flag(cab?.dsdPenalty));
  const slipping = show.wheelslip && d?.isSlipping;

  useAlertSound(audible("braking"), level === "approach", "approach");
  useAlertSound(audible("braking"), level === "brake", "brake");
  useAlertSound(audible("braking"), level === "urgent", "urgent", 1200);
  useAlertSound(audible("overspeed"), overspeed, "overspeed", 2000);
  useAlertSound(audible("aws"), aws, "aws", 1000);
  useAlertSound(audible("vigilance"), dsd, "dsd", 700);
  useAlertSound(audible("brakeDemand"), brakeDemand, "urgent", 1500);

  // At a station: counts the dwell down, then asks for the doors to be closed and locked.
  const cue = show.doors
    ? doorCue({
        speed,
        objective: t.objective,
        doorsClosed: doorsClosedFrom(cab),
        leadSeconds: settings.doorLeadSeconds,
      })
    : null;
  const doorsToClose = cue?.stage === "close" || (cue?.stage === "ready" && cue.message.startsWith("Close"));
  useAlertSound(audible("doors"), doorsToClose, "doors", 6000);
  useAlertSound(audible("doors"), cue?.stage === "ready" && !doorsToClose, "doors");

  return (
    <>
      {cue?.stage === "open" && <div className="alert advice approach">{cue.message}</div>}
      {doorsToClose && cue && (
        <div className="alert advice brake">
          {cue.message.toUpperCase()}
          {cue.secondsLeft != null && cue.secondsLeft > 0.5 && <> · depart in {formatCountdown(cue.secondsLeft)}</>}
        </div>
      )}
      {cue?.stage === "ready" && !doorsToClose && <div className="alert advice ready">{cue.message.toUpperCase()}</div>}
      {aws && <div className="alert vigilance">AWS: acknowledge</div>}
      {dsd && <div className="alert vigilance">VIGILANCE: acknowledge</div>}
      {brakeDemand && <div className="alert vigilance">BRAKE DEMAND</div>}
      {slipping && <div className="alert slip">WHEELSLIP</div>}
      {overspeed && (
        <div className="alert overspeed">
          OVERSPEED +{Math.round(overBy)} {UNIT_LABEL[unit]}
        </div>
      )}
      {level === "approach" && target && (
        <div className="alert advice approach">
          Brake in {formatDistance(advice!.brakeIn, unit)} for {targetLabel}
        </div>
      )}
      {level === "brake" && target && (
        <div className="alert advice brake">
          BRAKE for {targetLabel} in {formatDistance(target.distance, unit)}
        </div>
      )}
      {level === "urgent" && target && (
        <div className="alert advice urgent">
          BRAKE HARD for {targetLabel}
          {/* Past the stopping margin the rate needed is unbounded, so say so rather than show "Infinity". */}
          {Number.isFinite(advice!.requiredDecel) ? `: ${advice!.requiredDecel.toFixed(2)} m/s² needed` : ": stop now"}
        </div>
      )}
    </>
  );
}
