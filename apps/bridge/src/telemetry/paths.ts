import type { DriveState } from "@tsw/shared";

const HUD = "CurrentDrivableActor.Function.HUD_";

/**
 * Universal HUD functions present on every loco. Not every loco implements
 * every one; missing ones come back NodeValid=false and stay null.
 */
export const DRIVE_PATHS = {
  speed: `${HUD}GetSpeed`,
  acceleration: `${HUD}GetAcceleration`,
  powerHandle: `${HUD}GetPowerHandle`,
  trainBrakeHandle: `${HUD}GetTrainBrakeHandle`,
  locoBrakeHandle: `${HUD}GetLocomotiveBrakeHandle`,
  electricBrakeHandle: `${HUD}GetElectricBrakeHandle`,
  brakeGauge1: `${HUD}GetBrakeGauge_1`,
  brakeGauge2: `${HUD}GetBrakeGauge_2`,
  ammeter: `${HUD}GetAmmeter`,
  tractiveEffort: `${HUD}GetTractiveEffort`,
  engineRpm: `${HUD}GetEngineRPM`,
  gearIndex: `${HUD}GetGearIndex`,
  direction: `${HUD}GetDirection`,
  maxPermittedSpeed: `${HUD}GetMaxPermittedSpeed`,
  speedControlTarget: `${HUD}GetSpeedControlTarget`,
  alerter: `${HUD}GetAlerter`,
  isSlipping: `${HUD}GetIsSlipping`,
  isTractionLocked: `${HUD}GetIsTractionLocked`,
} as const satisfies Record<keyof DriveState, string>;

export const BOOLEAN_DRIVE_KEYS = new Set<keyof DriveState>(["isSlipping", "isTractionLocked"]);

export const PATHS = {
  objectClass: "CurrentDrivableActor.ObjectClass",
  formationLength: "CurrentFormation.FormationLength",
  driverAid: "DriverAid.Data",
  playerInfo: "DriverAid.PlayerInfo",
  trackData: "DriverAid.TrackData",
  timeOfDay: "TimeOfDay.Data",
  weather: "WeatherManager.Data",
} as const;
