// Shapes of the TSW External Interface API responses, as observed on TSW5/6.
// TSW7 may differ; the probe in apps/bridge dumps real responses to check.

export interface TswInfo {
  Meta: {
    Worker: string;
    GameName: string;
    GameBuildNumber: number;
    APIVersion: number;
    GameInstanceID: string;
  };
  HttpRoutes: { Verb: string; Path: string; Description: string }[];
}

/** Root /list uses NodeName/NodePath for children; /list/<node> uses Name. */
export interface TswListNode {
  Name?: string;
  NodeName?: string;
  NodePath?: string;
  Nodes?: TswListNode[];
  CollapsedChildren?: number;
}

export interface TswListResponse {
  Result: string;
  NodePath: string;
  NodeName: string;
  Nodes?: TswListNode[];
  Endpoints?: { Name: string; Writable: boolean }[];
}

export interface TswSubscriptionRead {
  RequestedSubscriptionID: number;
  Entries?: { Path: string; NodeValid: boolean; Values?: Record<string, unknown> }[];
}

export interface TswGetResponse<T = Record<string, unknown>> {
  Result: string;
  Values: T;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Speeds are m/s wrapped in { value }. FLT_MAX (~3.4e38) means "no limit". */
export interface SpeedValue {
  value: number;
}

export interface DriverAidData {
  signalSeen: boolean;
  speedLimitSeen: boolean;
  distanceToSignal: number;
  distanceToNextSpeedLimit: number;
  gradient: number;
  signalAspectClass: string;
  bSignalIsPermissive: boolean;
  speedLimit: SpeedValue;
  nextSpeedLimit: SpeedValue;
  currentSpeedLimitSource: string;
  trackMaxSpeed: SpeedValue;
  serviceMaxSpeed: SpeedValue;
  formationMaxSpeed: SpeedValue;
  nextSignalPosition: Vec3;
  nextSpeedLimitPosition: Vec3;
  nextSpeedLimits: {
    value: SpeedValue;
    distanceToNextSpeedLimit: number;
    nextSpeedLimitPosition: Vec3;
    restrictionType: string;
  }[];
  nextSignals: {
    value: string;
    distanceToNextSignal: number;
    nextSignalPosition: Vec3;
  }[];
}

export interface DriverAidPlayerInfo {
  geoLocation: { longitude: number; latitude: number };
  currentTile: { x: number; y: number };
  playerProfileName: string;
  cameraMode: string;
  currentServiceName?: string;
}

export interface DriverAidTrackData {
  lastPlayerPosition: TrackHeight;
  trackHeights: TrackHeight[];
  stations: TrackMarker[];
  markers: TrackMarker[];
}

/** Heights and distances are in cm. */
export interface TrackHeight {
  height: number;
  distanceToHeight: number;
  bTunnelFound: boolean;
}

export interface TrackMarker {
  stationName: string;
  distanceToStation: { x: number; y: number };
  distanceToStationCM: number;
  platformLength: number;
  markerType: string;
  markerName: string;
}

/** Values above this are treated as "unset" (the API uses FLT_MAX). */
export const TSW_UNSET_THRESHOLD = 1e30;

// ---------------------------------------------------------------------------
// Companion telemetry: what the bridge sends to clients. SI units throughout
// (m, m/s, m/s²); clients convert for display. null = not available.
// ---------------------------------------------------------------------------

export interface Telemetry {
  connection: ConnectionState;
  loco: LocoInfo | null;
  drive: DriveState | null;
  driverAid: DriverAidState | null;
  position: PositionState | null;
  track: TrackState | null;
  world: WorldState | null;
  /** Extra values for the current loco's cab screen, if it has a profile. */
  cab: CabState | null;
}

export type CabValue = number | boolean | string | null;

export interface CabState {
  profileId: string;
  values: Record<string, CabValue>;
}

export * from "./profiles.js";

export type ConnectionStatus = "no-key" | "waiting-for-game" | "connected" | "no-train";

export interface ConnectionState {
  status: ConnectionStatus;
  gameName?: string;
  gameBuild?: number;
  message?: string;
}

export interface LocoInfo {
  objectClass: string;
  formationLength: number | null;
}

/**
 * Fast tier: the universal HUD_* functions every loco exposes. A control the
 * loco doesn't have (its IsActive flag is false) reads null.
 */
export interface DriveState {
  speed: number | null;
  acceleration: number | null;
  /** Combined handles report negative values when braking (e.g. -38 = 38% brake). */
  powerHandle: number | null;
  trainBrakeHandle: number | null;
  locoBrakeHandle: number | null;
  electricBrakeHandle: number | null;
  /** Brake gauges in Pa: white needle and red needle. */
  brakeGauge1: number | null;
  brakeGauge1Red: number | null;
  brakeGauge2: number | null;
  brakeGauge2Red: number | null;
  /** Amps. */
  ammeter: number | null;
  /** Newtons on most locos; a 0..1 fraction on some (e.g. Class 700). */
  tractiveEffort: number | null;
  brakeEffort: number | null;
  engineRpm: number | null;
  gearIndex: number | null;
  direction: number | null;
  maxPermittedSpeed: number | null;
  speedControlTarget: number | null;
  alerter: number | null;
  isSlipping: boolean | null;
  isTractionLocked: boolean | null;
}

export interface UpcomingSignal {
  aspect: string;
  distance: number;
  position: Vec3 | null;
}

export interface UpcomingLimit {
  limit: number | null;
  distance: number;
  position: Vec3 | null;
  type: string;
}

export interface DriverAidState {
  speedLimit: number | null;
  speedLimitSource: string;
  trackMaxSpeed: number | null;
  serviceMaxSpeed: number | null;
  formationMaxSpeed: number | null;
  gradient: number;
  signals: UpcomingSignal[];
  limits: UpcomingLimit[];
}

export interface PositionState {
  latitude: number;
  longitude: number;
  cameraMode: string;
  serviceName: string | null;
}

export interface TrackState {
  markers: { name: string; type: string; distance: number; platformLength: number }[];
  heights: { height: number; distance: number; tunnel: boolean }[];
}

export interface WorldState {
  localTimeIso: string;
  gmtOffset: number;
  temperature: number | null;
  precipitation: number | null;
  fogDensity: number | null;
}

// WebSocket protocol, bridge -> client.
export type TelemetrySection = keyof Telemetry;

export type ServerMessage =
  | { type: "snapshot"; seq: number; t: number; data: Telemetry }
  | { type: "update"; seq: number; t: number; data: Partial<Telemetry> };
