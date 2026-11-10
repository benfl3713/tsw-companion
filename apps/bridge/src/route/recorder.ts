import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PositionState, RecordedFeature, Telemetry } from "@tsw/shared";

// Records where signals and limit changes are by driving past them. The
// lookahead says how far ahead each item is; we turn that into a point on an
// odometer integrated from speed, and when the train reaches it we take the
// train's own lat/lon. No calibration between game XYZ and map is needed.

const MERGE_RADIUS_M = 25;
/** Lookahead items within this distance of each other (along the line) are the same item. */
const PENDING_MERGE_M = 30;
/** Signals facing more than this apart are different signals. */
const MAX_BEARING_DIFF = 60;
const MIN_HEADING_STEP_M = 8;

interface Pending {
  kind: RecordedFeature["kind"];
  /** Odometer reading where the train will reach it. */
  at: number;
  limit?: number;
  limitType?: string;
}

export function metresBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const k = 111_320;
  const dx = (b.longitude - a.longitude) * k * Math.cos((a.latitude * Math.PI) / 180);
  const dy = (b.latitude - a.latitude) * k;
  return Math.hypot(dx, dy);
}

function bearingBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const dx = (b.longitude - a.longitude) * Math.cos((a.latitude * Math.PI) / 180);
  const dy = b.latitude - a.latitude;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

function bearingDiff(a: number, b: number) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export class RouteRecorder {
  private features: RecordedFeature[] = [];
  private pending: Pending[] = [];
  private odometer = 0;
  private lastDriveAt: number | null = null;
  private lastSpeed = 0;
  private position: PositionState | null = null;
  private headingFrom: PositionState | null = null;
  private heading: number | null = null;
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly file: string | null,
    /** Called with features added or changed. */
    private readonly onChange: (changed: RecordedFeature[]) => void,
    private readonly now: () => number = () => performance.now(),
  ) {
    if (file && existsSync(file)) {
      try {
        this.features = JSON.parse(readFileSync(file, "utf8")) as RecordedFeature[];
      } catch {
        // A corrupt file shouldn't stop the bridge; start fresh.
        this.features = [];
      }
    }
  }

  all(): RecordedFeature[] {
    return this.features;
  }

  /** Feed every telemetry update through here. */
  observe(update: Partial<Telemetry>) {
    if (update.loco !== undefined && update.loco === null) this.reset();
    if (update.position !== undefined) this.observePosition(update.position);
    if (update.drive !== undefined) this.observeDrive(update.drive?.speed ?? null, update.drive?.direction ?? null);
    if (update.driverAid) this.observeLookahead(update.driverAid);
  }

  private reset() {
    this.pending = [];
    this.lastDriveAt = null;
    this.headingFrom = null;
    this.heading = null;
  }

  private observePosition(p: PositionState | null) {
    this.position = p;
    if (!p) return;
    if (!this.headingFrom) {
      this.headingFrom = p;
    } else if (metresBetween(this.headingFrom, p) >= MIN_HEADING_STEP_M) {
      this.heading = bearingBetween(this.headingFrom, p);
      this.headingFrom = p;
    }
  }

  private observeDrive(speed: number | null, direction: number | null) {
    const t = this.now();
    if (speed == null) {
      this.lastDriveAt = null;
      return;
    }
    // Reversing makes the pending distances meaningless.
    if (direction != null && direction < 0) this.pending = [];
    if (this.lastDriveAt != null) {
      const dt = Math.min((t - this.lastDriveAt) / 1000, 0.5);
      this.odometer += ((Math.abs(speed) + this.lastSpeed) / 2) * dt;
    }
    this.lastDriveAt = t;
    this.lastSpeed = Math.abs(speed);

    const reached = this.pending.filter((p) => p.at <= this.odometer);
    if (reached.length === 0) return;
    this.pending = this.pending.filter((p) => p.at > this.odometer);
    if (!this.position || this.heading == null) return;
    const changed = reached.map((p) => this.record(p, this.position!, this.heading!));
    this.onChange(changed);
    this.scheduleSave();
  }

  private observeLookahead(aid: NonNullable<Telemetry["driverAid"]>) {
    const items: Pending[] = [
      ...aid.signals.map((s) => ({ kind: "signal" as const, at: this.odometer + s.distance })),
      ...aid.limits
        .filter((l) => l.limit != null)
        .map((l) => ({ kind: "limit" as const, at: this.odometer + l.distance, limit: l.limit!, limitType: l.type })),
    ];
    const confirmed = new Set<Pending>();
    for (const item of items) {
      const existing = this.pending.find(
        (p) => p.kind === item.kind && Math.abs(p.at - item.at) < PENDING_MERGE_M && p.limit === item.limit,
      );
      // Closer readings are more accurate, so the latest estimate wins.
      if (existing) {
        existing.at = item.at;
        confirmed.add(existing);
      } else {
        this.pending.push(item);
        confirmed.add(item);
      }
    }
    // An item the game has stopped reporting, though it's still within the range
    // it reports, is no longer on our path (e.g. a different route at a junction).
    // Items about to be reached are kept: the game drops them as the cab passes.
    const reach = { signal: -Infinity, limit: -Infinity };
    for (const item of items) reach[item.kind] = Math.max(reach[item.kind], item.at);
    this.pending = this.pending.filter(
      (p) => confirmed.has(p) || p.at - this.odometer < PENDING_MERGE_M || p.at > reach[p.kind],
    );
  }

  private record(p: Pending, at: PositionState, bearing: number): RecordedFeature {
    const match = this.features.find(
      (f) =>
        f.kind === p.kind &&
        metresBetween(f, at) < MERGE_RADIUS_M &&
        bearingDiff(f.bearing, bearing) < MAX_BEARING_DIFF &&
        (p.kind !== "limit" || Math.abs((f.limit ?? 0) - (p.limit ?? 0)) < 0.5),
    );
    const lastSeen = new Date().toISOString();
    if (match) {
      // Running average tightens the position over repeated passes.
      const n = match.seen;
      match.latitude = (match.latitude * n + at.latitude) / (n + 1);
      match.longitude = (match.longitude * n + at.longitude) / (n + 1);
      match.seen = n + 1;
      match.lastSeen = lastSeen;
      return match;
    }
    const feature: RecordedFeature = {
      id: `${p.kind}-${at.latitude.toFixed(5)}-${at.longitude.toFixed(5)}-${Math.round(bearing)}`,
      kind: p.kind,
      latitude: at.latitude,
      longitude: at.longitude,
      bearing,
      ...(p.kind === "limit" ? { limit: p.limit, limitType: p.limitType } : {}),
      seen: 1,
      lastSeen,
    };
    this.features.push(feature);
    return feature;
  }

  private scheduleSave() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, 2000);
  }

  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.features));
  }
}
