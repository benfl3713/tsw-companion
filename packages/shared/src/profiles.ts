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

export type CabScreenId = "hitachi-at300" | "desiro-city" | "electrostar" | "analogue-emu";

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

/**
 * Component nodes whose names vary per loco (e.g. "AWS_TPWS_Service",
 * "BP_AWS_TPWS_Service", "PBD_LNER_Class801_AWS_TPWS_Service"). Paths can use
 * `{AWS}` / `{DVD}`; the bridge finds the loco's actual node by suffix when it
 * subscribes.
 */
export const NODE_ALIASES: Record<string, RegExp> = {
  AWS: /AWS_TPWS_Service$/i,
  DVD: /DVD_Service$/i,
};

/** AWS/TPWS/DSD on UK stock. */
const UK_SAFETY: Record<string, CabField> = {
  awsSunflower: { path: `${CDA}/{AWS}.Function.GetAWS_SunflowerState`, field: "CurrentState" },
  // AWS_WarningState is an enum (not a boolean), so it only backs up the explicit
  // "driver must acknowledge" / "acknowledged" signals below.
  awsWarning: { path: `${CDA}/{AWS}.Property.AWS_WarningState` },
  awsAckRequired: { path: `${CDA}/{AWS}.Function.GetAWS_AcknowledgeRequired` },
  awsAcknowledged: { path: `${CDA}/{AWS}.Function.GetIsAcknowledged` },
  awsHorn: { path: `${CDA}/{AWS}.Function.GetAWS_AudioWarningHorn` },
  tpwsTrainStop: { path: `${CDA}/{AWS}.Function.GetTPWS_TrainStopIndicator`, field: "bIsOn" },
  tpwsTrainStopFlashing: { path: `${CDA}/{AWS}.Function.GetTPWS_TrainStopIndicator`, field: "bIsFlashing" },
  tpwsOverspeed: { path: `${CDA}/{AWS}.Function.GetTPWS_OverspeedIndicator`, field: "bIsOn" },
  tpwsOverspeedFlashing: { path: `${CDA}/{AWS}.Function.GetTPWS_OverspeedIndicator`, field: "bIsFlashing" },
  safetyBrakeDemand: { path: `${CDA}/{AWS}.Function.GetBrakeDemandActive` },
  dsdWarning: { path: `${CDA}/{DVD}.Function.WarningDevices_GetIsWarningVisualState` },
  dsdPenalty: { path: `${CDA}/{DVD}.Function.WarningDevices_GetPenaltyBrakeState` },
};

/**
 * Swaps `{ALIAS}` placeholders for the loco's real node names. Paths whose
 * alias isn't on this loco are dropped (they'd only ever read null).
 */
export function resolveProfile(profile: LocoProfile, nodeNames: string[]): LocoProfile {
  const found: Record<string, string | undefined> = {};
  for (const [alias, pattern] of Object.entries(NODE_ALIASES)) found[alias] = nodeNames.find((n) => pattern.test(n));
  const resolvePath = (p: string) => {
    let missing = false;
    const out = p.replace(/\{(\w+)\}/g, (_, alias: string) => found[alias] ?? ((missing = true), ""));
    return missing ? null : out;
  };
  const fields: Record<string, CabField> = {};
  for (const [key, f] of Object.entries(profile.fields)) {
    const paths = [f.path].flat().map(resolvePath).filter((p): p is string => p != null);
    if (paths.length) fields[key] = { ...f, path: paths.length === 1 ? paths[0]! : paths };
  }
  return { ...profile, fields };
}

export const PROFILES: LocoProfile[] = [
  {
    id: "class805",
    // The whole Hitachi AT300 family: 800, 801, 802, 805, 807, 810.
    name: "Class 80x (Hitachi AT300)",
    match: "Class8(0[0-25-7]|10)",
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
      // The driving vehicle's own current collector (bTrainLinePowered reads false even at full power on the 801).
      pantographUp: { path: `${CDA}/CurrentCollector.Property.bDeployed` },
      lineSupply: { path: `${CDA}/CurrentCollector.Property.bHasLocalSupply` },
      powerMode: { path: `${CDA}.Property.expectedPowerMode` },
      draSet: { path: `${CDA}.Property.bIsDRA_Set` },
      brakeHoldSpeedReached: { path: `${CDA}.Property.bBrakeHoldSpeedReached` },
      tractionLocked: { path: `${CDA}/TractionLockManager.Property.bIsLocked` },
      displayPowered: { path: `${CDA}/DD_Service.Property.Powered` },
    },
  },
  {
    // Siemens Desiro City, dual voltage (25 kV AC pantograph / 750 V DC shoes).
    id: "class700",
    name: "Class 700 Desiro City",
    match: "Class70[07]",
    screen: "desiro-city",
    fields: {
      ...UK_SAFETY,
      mainRes: { path: `${SIM}/MR (AirPipe).Pressure_BAR_G` },
      brakePipe: { path: `${SIM}/BP (AirPipe).Pressure_BAR_G` },
      brakeCylinder: { path: `${SIM}/BrakeCylinder_1_1.Pressure_BAR_G` },
      tractionTargetPct: { path: `${SIM}/HUD_TE_Target_Percentage.Result` },
      tractionPct: { path: `${SIM}/HUD_TE_Percentage.Result` },
      wantAcMode: { path: `${SIM}/WantACMode.OutValue0` },
      pantographUp: { path: `${CDA}/CurrentCollector_AC.Property.bDeployed` },
      shoesDown: { path: `${CDA}/CurrentCollector_DC.Property.bDeployed` },
      acSupply: { path: `${CDA}/CurrentCollector_AC.Property.bHasLocalSupply` },
      dcSupply: { path: `${CDA}/CurrentCollector_DC.Property.bHasLocalSupply` },
      acBreakerOpen: { path: `${CDA}/CurrentCollector_AC.Property.bCircuitBreakerOpen` },
      dcBreakerOpen: { path: `${CDA}/CurrentCollector_DC.Property.bCircuitBreakerOpen` },
      regenAc: { path: `${CDA}.Property.bRegenBrake_AC` },
      regenDc: { path: `${CDA}.Property.bRegenBrake_DC` },
      powerModeChanging: { path: `${CDA}.Property.bPowerModeChanging` },
      brakeHoldSpeed: { path: `${CDA}.Property.bBrakeHoldSpeed` },
      emergencyHold: { path: `${CDA}.Property.bEmergencyHold` },
      batteryPower: { path: `${CDA}.Property.bBatteryPower` },
      tractionLocked: { path: `${CDA}/TractionLockManager.Property.bIsLocked` },
      destination: { path: `${CDA}/PIS_Manager.Property.FinalDestination` },
    },
  },
  {
    // Bombardier Electrostar family (verified on the Class 377/4). Its AWS/TPWS
    // and DSD are different components from other UK stock, so they're listed
    // here rather than taken from UK_SAFETY.
    id: "electrostar",
    name: "Class 377 Electrostar",
    match: "Class37[5-9]|Class387",
    screen: "electrostar",
    fields: {
      awsSunflower: { path: `${CDA}/AWS_TPWS.Property.AWS_SunflowerState` },
      awsWarning: { path: `${CDA}/AWS_TPWS.Function.Get_WarningIndicator` },
      awsAcknowledged: { path: `${CDA}/AWS_TPWS.Function.Get_Acknowledged` },
      awsSignalState: { path: `${CDA}/AWS_TPWS.Property.AWS_SignalState` },
      // TPWS here reports one combined brake demand, not separate train-stop/overspeed lamps.
      tpwsTrainStop: { path: `${CDA}/AWS_TPWS.Property.bIsBrakeDemand_TPWS` },
      safetyBrakeDemand: { path: `${CDA}/AWS_TPWS.Property.bIsBrakeDemand` },
      // Vigilance warns once the timer reaches TimeToWarning (60 s); IsAlerterActive only means armed.
      dsdElapsed: { path: `${CDA}/DSD.Function.GetElapsedTime` },
      dsdTimeToWarning: { path: `${CDA}/DSD.Property.TimeToWarning` },
      emergencyBrake: { path: `${CDA}.Property.bIsEmergencyBrake` },
      // HUD brake gauges read absolute pressure on this unit, so use the simulation's gauge pressures.
      mainRes: { path: `${SIM}/MR (AirPipe).Pressure_BAR_G` },
      brakeCylinder: { path: `${SIM}/BrakeCylinder_1_1.Pressure_BAR_G` },
      // 9 notches: EB, B3, B2, B1, Off, P1–P4.
      controllerNotch: { path: `${CDA}/PowerHandle.Function.GetCurrentNotchIndex`, field: "ReturnValue" },
      controllerNotchCount: { path: `${CDA}/PowerHandle.Function.GetNotchCount`, field: "ReturnValue" },
      speedSetActive: { path: `${SIM}/SpeedSetModifier.Active` },
      speedSetPoint: { path: `${SIM}/SpeedSetModifier.SetPoint` },
      doorFL: { path: `${CDA}/PassengerDoor_FL.Function.GetCurrentOutputValue`, field: "ReturnValue" },
      doorFR: { path: `${CDA}/PassengerDoor_FR.Function.GetCurrentOutputValue`, field: "ReturnValue" },
      doorBL: { path: `${CDA}/PassengerDoor_BL.Function.GetCurrentOutputValue`, field: "ReturnValue" },
      doorBR: { path: `${CDA}/PassengerDoor_BR.Function.GetCurrentOutputValue`, field: "ReturnValue" },
      draSet: { path: `${CDA}.Property.bIsDRA_Set` },
      tractionLocked: { path: `${CDA}.Property.bIsTractionLocked` },
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
