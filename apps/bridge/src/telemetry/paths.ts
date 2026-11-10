import type { CabField, DriveState } from "@tsw/shared";

const HUD = "CurrentDrivableActor.Function.HUD_";

export interface DriveField extends CabField {
  path: string;
  /** Values key that says whether the loco has this control; false reads as null. */
  activeField?: string;
  boolean?: boolean;
}

/**
 * Universal HUD functions present on every loco, with the field each value
 * lives in (verified on TSW7 with the Class 66, 465 and 805).
 */
export const DRIVE_FIELDS: Record<keyof DriveState, DriveField> = {
  speed: { path: `${HUD}GetSpeed`, field: "Speed (ms)" },
  acceleration: { path: `${HUD}GetAcceleration`, field: "Acceleration (ms2)" },
  powerHandle: { path: `${HUD}GetPowerHandle`, field: "Power", activeField: "IsActive" },
  trainBrakeHandle: { path: `${HUD}GetTrainBrakeHandle`, field: "HandlePosition", activeField: "IsActive" },
  locoBrakeHandle: { path: `${HUD}GetLocomotiveBrakeHandle`, field: "HandlePosition", activeField: "IsActive" },
  electricBrakeHandle: { path: `${HUD}GetElectricBrakeHandle`, field: "HandlePosition", activeField: "IsActive" },
  brakeGauge1: { path: `${HUD}GetBrakeGauge_1`, field: "WhiteNeedle (Pa)" },
  brakeGauge1Red: { path: `${HUD}GetBrakeGauge_1`, field: "RedNeedle (Pa)" },
  brakeGauge2: { path: `${HUD}GetBrakeGauge_2`, field: "WhiteNeedle (Pa)" },
  brakeGauge2Red: { path: `${HUD}GetBrakeGauge_2`, field: "RedNeedle (Pa)" },
  ammeter: { path: `${HUD}GetAmmeter`, field: "Amps" },
  tractiveEffort: { path: `${HUD}GetTractiveEffort`, field: "TractiveEffort (N)" },
  brakeEffort: { path: `${HUD}GetTractiveEffort`, field: "BrakeEffort (N)" },
  engineRpm: { path: `${HUD}GetEngineRPM`, field: "Needle1 RPM" },
  gearIndex: { path: `${HUD}GetGearIndex`, field: "Value" },
  direction: { path: `${HUD}GetDirection`, field: "Direction", activeField: "IsActive" },
  maxPermittedSpeed: { path: `${HUD}GetMaxPermittedSpeed`, field: "MaxSpeed (ms)", activeField: "IsActive" },
  speedControlTarget: { path: `${HUD}GetSpeedControlTarget`, field: "Speed (ms)", activeField: "IsActive" },
  alerter: { path: `${HUD}GetAlerter`, field: "AleterState", activeField: "IsEnabled" },
  isSlipping: { path: `${HUD}GetIsSlipping`, field: "IsSlipping", boolean: true },
  isTractionLocked: { path: `${HUD}GetIsTractionLocked`, field: "IsTractionLocked", boolean: true },
};

export const DRIVE_PATHS = [...new Set(Object.values(DRIVE_FIELDS).map((f) => f.path))];

export const PATHS = {
  objectClass: "CurrentDrivableActor.ObjectClass",
  formationLength: "CurrentFormation.FormationLength",
  driverAid: "DriverAid.Data",
  playerInfo: "DriverAid.PlayerInfo",
  trackData: "DriverAid.TrackData",
  timeOfDay: "TimeOfDay.Data",
  weather: "WeatherManager.Data",
  currentObjective: "Objectives.Current",
} as const;

/** Read per objective with plain GETs, since the index changes as the service runs. */
export const OBJECTIVE_PROPS = {
  kind: "ObjectClass",
  waitTime: "Property.WaitTime",
  currentWaitTime: "Property.CurrentWaitTime",
  waitForDoorOpen: "Property.bWaitForDoorOpen",
  waitForDoorClosed: "Property.bWaitForDoorClosed",
  hasScheduledTime: "Property.bHasScheduledCompletionTime",
  scheduledTime: "Property.ScheduledCompletionTime",
  scheduledIsArrival: "Property.bTreatCompletionTimeAsArrivalTime",
} as const;
