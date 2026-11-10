import {
  TSW_UNSET_THRESHOLD,
  type DriverAidData,
  type DriverAidPlayerInfo,
  type DriverAidState,
  type DriverAidTrackData,
  type PositionState,
  splitPlatform,
  type SpeedValue,
  type TrackState,
  type TrackStop,
  type Vec3,
} from "@tsw/shared";

// DriverAid and TrackData distances are Unreal units (cm). TrackData names
// this explicitly (distanceToStationCM); DriverAid is assumed to match.
const CM = 0.01;

/** FLT_MAX and non-finite values mean "no value". */
export function clean(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && Math.abs(n) < TSW_UNSET_THRESHOLD ? n : null;
}

function speed(v: SpeedValue | undefined): number | null {
  return clean(v?.value);
}

/** The API zeroes positions it doesn't know. */
function position(v: Vec3 | undefined): Vec3 | null {
  return v && (v.x !== 0 || v.y !== 0 || v.z !== 0) ? v : null;
}

/**
 * HUD functions return one value under a descriptive key that varies by
 * function, e.g. { "Speed (ms)": 1.8 }. Take the first value whatever it's called.
 */
export function firstValue(values: Record<string, unknown> | undefined): unknown {
  if (!values) return undefined;
  for (const key in values) return values[key];
  return undefined;
}

type ValuesByPath = { get(path: string): Record<string, unknown> | undefined };

/**
 * Reads one field from a subscription read. Tries each alternative path in
 * turn; a loco without the control (activeField false) reads as null.
 */
export function readField(
  values: ValuesByPath,
  spec: { path: string | string[]; field?: string; activeField?: string },
): unknown {
  for (const path of [spec.path].flat()) {
    const v = values.get(path);
    if (!v) continue;
    if (spec.activeField && v[spec.activeField] === false) return null;
    return spec.field ? v[spec.field] : firstValue(v);
  }
  return null;
}

/** Numbers stay numbers (FLT_MAX -> null); booleans and short strings pass through. */
export function cabValue(v: unknown): number | boolean | string | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return clean(v);
  if (typeof v === "string" && v.length < 200) return v;
  return null;
}

/** Objectives.Current gives e.g. { Current: "2" } or {} when nothing is active. */
export function parseObjectiveIndex(values: Record<string, unknown> | undefined): number | null {
  const v = firstValue(values);
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function firstNumber(values: Record<string, unknown> | undefined): number | null {
  const v = firstValue(values);
  if (typeof v === "boolean") return v ? 1 : 0;
  return clean(v);
}

export function firstBoolean(values: Record<string, unknown> | undefined): boolean | null {
  const v = firstValue(values);
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return null;
}

export function normalizeDriverAid(d: DriverAidData): DriverAidState {
  return {
    speedLimit: speed(d.speedLimit),
    speedLimitSource: d.currentSpeedLimitSource,
    trackMaxSpeed: speed(d.trackMaxSpeed),
    serviceMaxSpeed: speed(d.serviceMaxSpeed),
    formationMaxSpeed: speed(d.formationMaxSpeed),
    gradient: d.gradient,
    signals: (d.nextSignals ?? []).map((s) => ({
      aspect: s.value,
      distance: s.distanceToNextSignal * CM,
      position: position(s.nextSignalPosition),
    })),
    limits: onlyChanges(
      speed(d.speedLimit),
      (d.nextSpeedLimits ?? []).map((l) => ({
        limit: speed(l.value),
        distance: l.distanceToNextSpeedLimit * CM,
        position: position(l.nextSpeedLimitPosition),
        type: l.restrictionType,
      })),
    ),
  };
}

/**
 * The game lists a limit for every track section ahead, so the same value
 * repeats many times (e.g. seventeen 60 mph entries in 2 km). Keep only the
 * points where the limit actually changes from the one before.
 */
export function onlyChanges<T extends { limit: number | null }>(current: number | null, limits: T[]): T[] {
  const out: T[] = [];
  let previous = current;
  for (const l of limits) {
    // Limits are whole mph/km/h; compare loosely to ignore float noise.
    if (previous == null || l.limit == null || Math.abs(l.limit - previous) > 0.05) out.push(l);
    previous = l.limit;
  }
  return out;
}

export function normalizePlayerInfo(p: DriverAidPlayerInfo): PositionState {
  return {
    latitude: p.geoLocation.latitude,
    longitude: p.geoLocation.longitude,
    cameraMode: p.cameraMode,
    serviceName: p.currentServiceName && p.currentServiceName !== "None" ? p.currentServiceName : null,
  };
}

/**
 * On a timetabled service the game lists its calling points as `stations`
 * (just the station name, at the station) and the platforms ahead as `markers`
 * ("Clapham Junction 15", at the stopping point). In free roam only markers
 * exist. Both used to be merged into one list, which showed every stop twice.
 */
export function normalizeTrackData(t: DriverAidTrackData): TrackState {
  const stations = t.stations ?? [];
  const platforms = t.markers ?? [];
  const byDistance = <T extends { distance: number }>(list: T[]) => list.sort((a, b) => a.distance - b.distance);

  const markers = byDistance(
    platforms.map((m) => ({
      name: m.stationName || m.markerName,
      type: m.markerType,
      distance: m.distanceToStationCM * CM,
      platformLength: m.platformLength * CM,
    })),
  );

  const calling = stations.length > 0;
  const stops = byDistance(
    (calling ? stations : platforms).map((s): TrackStop => {
      const { name, platform } = calling
        ? { name: s.stationName || s.markerName, platform: null as string | null }
        : splitPlatform(s.stationName || s.markerName);
      // The stopping point is the platform marker for this station, when there is one.
      const marker = calling
        ? platforms.find((m) => {
            const split = splitPlatform(m.stationName || m.markerName);
            return split.name === name || (m.stationName || "").startsWith(`${name} `);
          })
        : s;
      const split = marker ? splitPlatform(marker.stationName || marker.markerName) : { platform };
      return {
        name,
        platform: split.platform ?? platform,
        distance: (marker ?? s).distanceToStationCM * CM,
        platformLength: (marker ?? s).platformLength * CM,
        type: s.markerType,
        calling,
      };
    }),
  );

  return {
    markers,
    stops,
    heights: (t.trackHeights ?? []).map((h) => ({
      height: h.height * CM,
      distance: h.distanceToHeight * CM,
      tunnel: h.bTunnelFound,
    })),
  };
}
