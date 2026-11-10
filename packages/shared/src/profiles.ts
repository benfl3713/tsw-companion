// Loco profiles: which extra API values a loco's cab screen needs, and which
// screen draws them. Paths come from `npm run probe` dumps of that loco.

/**
 * Where to read one value. `path` may list alternatives for locos that name
 * the same component differently; the first one the game resolves wins.
 * `field` picks a key from the response's Values (default: the first value).
 */
export interface CabField {
  path: string | string[];
  field?: string;
}

export type CabScreenId = "hitachi-at300" | "analogue-emu";

export interface LocoProfile {
  id: string;
  name: string;
  /** Regex source matched against the ObjectClass. */
  match: string;
  screen: CabScreenId;
  fields: Record<string, CabField>;
}

const CDA = "CurrentDrivableActor";
const SIM = `${CDA}/Simulation`;

/** AWS/TPWS/DSD on UK stock. Component names vary between locos. */
const UK_SAFETY: Record<string, CabField> = {
  awsSunflower: {
    path: [`${CDA}/AWS_TPWS_Service.Function.GetAWS_SunflowerState`, `${CDA}/BP_AWS_TPWS_Service.Function.GetAWS_SunflowerState`],
    field: "CurrentState",
  },
  awsWarning: {
    path: [`${CDA}/AWS_TPWS_Service.Property.AWS_WarningState`, `${CDA}/BP_AWS_TPWS_Service.Property.AWS_WarningState`],
  },
  tpwsTrainStop: {
    path: [`${CDA}/AWS_TPWS_Service.Function.GetTPWS_TrainStopIndicator`, `${CDA}/BP_AWS_TPWS_Service.Function.GetTPWS_TrainStopIndicator`],
    field: "bIsOn",
  },
  tpwsTrainStopFlashing: {
    path: [`${CDA}/AWS_TPWS_Service.Function.GetTPWS_TrainStopIndicator`, `${CDA}/BP_AWS_TPWS_Service.Function.GetTPWS_TrainStopIndicator`],
    field: "bIsFlashing",
  },
  tpwsOverspeed: {
    path: [`${CDA}/AWS_TPWS_Service.Function.GetTPWS_OverspeedIndicator`, `${CDA}/BP_AWS_TPWS_Service.Function.GetTPWS_OverspeedIndicator`],
    field: "bIsOn",
  },
  tpwsOverspeedFlashing: {
    path: [`${CDA}/AWS_TPWS_Service.Function.GetTPWS_OverspeedIndicator`, `${CDA}/BP_AWS_TPWS_Service.Function.GetTPWS_OverspeedIndicator`],
    field: "bIsFlashing",
  },
  safetyBrakeDemand: {
    path: [`${CDA}/AWS_TPWS_Service.Function.GetBrakeDemandActive`, `${CDA}/BP_AWS_TPWS_Service.Function.GetBrakeDemandActive`],
  },
  dsdWarning: { path: `${CDA}/BP_DVD_Service.Function.WarningDevices_GetIsWarningVisualState` },
  dsdPenalty: { path: `${CDA}/BP_DVD_Service.Function.WarningDevices_GetPenaltyBrakeState` },
};

export const PROFILES: LocoProfile[] = [
  {
    id: "class805",
    name: "Class 805 Evero",
    match: "Class80[05]",
    screen: "hitachi-at300",
    fields: {
      ...UK_SAFETY,
      mainRes: { path: `${SIM}/MR (AirPipe).Pressure_BAR_G` },
      brakePipe: { path: `${SIM}/BP (AirPipe).Pressure_BAR_G` },
      brakeCylinder: { path: `${SIM}/BrakeCylinder_1_1.Pressure_BAR_G` },
      tractionTargetPct: { path: `${SIM}/HUD_TE_Target_Percentage.Result` },
      brakeTargetPct: { path: `${SIM}/HUD_Brake_Target_Percentage.Result` },
      powerNotch: { path: `${CDA}/PowerHandle(IrregularLever).Function.GetCurrentNotchIndex`, field: "ReturnValue" },
      reverserNotch: { path: `${CDA}/Reverser(IrregularLever).Function.GetCurrentNotchIndex`, field: "ReturnValue" },
      engineRunning: { path: `${CDA}.Property.bIsEngineRunning` },
      trainLinePowered: { path: `${CDA}.Property.bTrainLinePowered` },
      powerMode: { path: `${CDA}.Property.expectedPowerMode` },
      draSet: { path: `${CDA}.Property.bIsDRA_Set` },
      brakeHoldSpeedReached: { path: `${CDA}.Property.bBrakeHoldSpeedReached` },
      tractionLocked: { path: `${CDA}/TractionLockManager.Property.bIsLocked` },
      displayPowered: { path: `${CDA}/DD_Service.Property.Powered` },
    },
  },
  {
    id: "class465",
    name: "Class 465 Networker",
    match: "Class465",
    screen: "analogue-emu",
    fields: { ...UK_SAFETY },
  },
  // Anything else: analogue gauges plus AWS/TPWS/DSD where the loco has them
  // (missing paths just read null). Must stay last.
  {
    id: "generic",
    name: "Generic",
    match: ".",
    screen: "analogue-emu",
    fields: { ...UK_SAFETY },
  },
];

export function findProfile(objectClass: string | null | undefined): LocoProfile | undefined {
  if (!objectClass) return undefined;
  return PROFILES.find((p) => new RegExp(p.match, "i").test(objectClass));
}

/** Every distinct API path a profile reads. */
export function profilePaths(profile: LocoProfile): string[] {
  const paths = new Set<string>();
  for (const f of Object.values(profile.fields)) for (const p of [f.path].flat()) paths.add(p);
  return [...paths];
}
