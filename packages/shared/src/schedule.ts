// Schedule helpers: arrival estimates for the stops ahead, the "close the
// doors" cue, and game-time parsing. Pure functions so they can be tested.

import type { ObjectiveState } from "./index.js";

const SECONDS_PER_DAY = 86_400;
/** .NET ticks (100 ns) from 0001-01-01; the game's times are in these. */
const TICKS_PER_SECOND = 1e7;

/**
 * Seconds of the day from whatever the game gives for a time: .NET ticks, a
 * plain number of seconds, "HH:MM:SS", an ISO date-time, or an object holding
 * one of those. Null when it can't be read (the API returns {} for times it
 * can't serialise).
 */
export function parseGameTimeOfDay(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v <= 0) return null;
    if (v > 1e15) return Math.floor(v / TICKS_PER_SECOND) % SECONDS_PER_DAY;
    if (v < 2 * SECONDS_PER_DAY) return Math.floor(v) % SECONDS_PER_DAY;
    return null;
  }
  if (typeof v === "string") {
    const m = v.match(/(?:T|^)(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) : null;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const key of ["Ticks", "ticks", "Value", "value", "Time", "time"]) {
      if (key in o) {
        const parsed = parseGameTimeOfDay(o[key]);
        if (parsed != null) return parsed;
      }
    }
  }
  return null;
}

/** "08:57" or "08:57:30" from seconds of the day. */
export function formatClock(seconds: number, withSeconds = false): string {
  const s = ((Math.round(seconds) % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return withSeconds ? `${hh}:${mm}:${String(s % 60).padStart(2, "0")}` : `${hh}:${mm}`;
}

/** "0:42" from seconds. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Seconds-of-day from the game's local ISO time, e.g. "2026-11-10T08:37:56.630+00:00". */
export function clockSeconds(localTimeIso: string | undefined | null): number | null {
  return parseGameTimeOfDay(localTimeIso ?? null);
}

// ---------------------------------------------------------------------------
// Arrival estimates
// ---------------------------------------------------------------------------

/** A stationary train this close to a stop is standing at it. */
const STANDING_AT_STOP_M = 20;

export interface EstimateInput {
  /** Current speed, m/s. */
  speed: number;
  /** Stops ahead, metres, nearest first. */
  stops: { distance: number }[];
  /** Limit changes ahead (metres, new limit in m/s); first entry nearest. */
  limits: { distance: number; limit: number | null }[];
  /** The limit the train is under now, m/s. */
  currentLimit: number | null;
  /** Seconds spent at each stop before moving off. */
  dwell?: number;
  /** Typical acceleration and service braking, m/s². */
  accel?: number;
  brake?: number;
  /** Fraction of the limit actually driven at. */
  cruiseFactor?: number;
  /** Top speed when no limit applies, m/s. */
  cap?: number;
}

/**
 * Seconds until the train reaches each stop, for a driver who accelerates to
 * about the limit, brakes for lower limits and stops at each stop for
 * `dwell` seconds. An estimate, not the timetable.
 */
export function estimateArrivals(input: EstimateInput): number[] {
  const { speed, stops, limits, currentLimit, dwell = 30, accel = 0.55, brake = 0.6, cruiseFactor = 0.95, cap = 36 } = input;
  if (stops.length === 0) return [];

  const target = (limit: number | null) => Math.max(3, Math.min(limit ?? cap, cap) * cruiseFactor);

  // Events along the route, in order: limit changes and stops.
  type Event = { at: number; kind: "limit"; limit: number | null } | { at: number; kind: "stop"; index: number };
  const events: Event[] = [
    ...limits.filter((l) => l.distance > 0).map((l): Event => ({ at: l.distance, kind: "limit", limit: l.limit })),
    ...stops.map((s, index): Event => ({ at: Math.max(0, s.distance), kind: "stop", index })),
  ].sort((a, b) => a.at - b.at || (a.kind === "limit" ? -1 : 1));

  const arrivals: number[] = new Array(stops.length).fill(0);
  let position = 0;
  let time = 0;
  let v = Math.max(0, speed);
  let limit = currentLimit;

  events.forEach((event, i) => {
    const length = event.at - position;
    // The speed we need to leave this stretch at: 0 for a stop, else the lower of this and the next limit.
    const next = events.slice(i + 1).find((e) => e.kind === "limit") as { limit: number | null } | undefined;
    const vt = target(limit);
    const ve = event.kind === "stop" ? 0 : Math.min(vt, next ? target(next.limit) : vt);
    // Already standing at the first stop: it's the dwell that's in progress, not a journey ahead.
    const standingAtStop = event.kind === "stop" && event.index === 0 && speed < 0.5 && event.at < STANDING_AT_STOP_M;
    if (length > 0.5 && !standingAtStop) time += segmentTime(length, v, vt, ve, accel, brake);
    position = event.at;
    if (event.kind === "limit") {
      limit = event.limit;
      v = ve;
    } else {
      arrivals[event.index] = time;
      if (!standingAtStop) time += dwell;
      v = 0;
    }
  });
  return arrivals;
}

/** Time to cover `length` m starting at v0, cruising at vt, finishing at ve. */
function segmentTime(length: number, v0: number, vt: number, ve: number, a: number, b: number): number {
  let time = 0;
  let distance = length;
  let v = v0;
  // Over the target already: slow down to it first.
  if (v > vt) {
    time += (v - vt) / b;
    distance -= (v * v - vt * vt) / (2 * b);
    v = vt;
  }
  const up = (vt * vt - v * v) / (2 * a);
  const down = (vt * vt - ve * ve) / (2 * b);
  if (distance >= up + down) {
    return time + (vt - v) / a + (distance - up - down) / vt + (vt - ve) / b;
  }
  // Too short to reach the target speed: accelerate to a peak then brake.
  const peakSq = (2 * Math.max(distance, 0) + (v * v) / a + (ve * ve) / b) / (1 / a + 1 / b);
  const peak = Math.sqrt(Math.max(peakSq, 0));
  if (peak < Math.max(v, ve)) return time + Math.max(distance, 0) / Math.max((v + ve) / 2, 1);
  return time + (peak - v) / a + (peak - ve) / b;
}

// ---------------------------------------------------------------------------
// Door cue
// ---------------------------------------------------------------------------

export type DoorStage = "none" | "open" | "dwell" | "close" | "ready";

export interface DoorCue {
  stage: DoorStage;
  /** Seconds until departure, where known. */
  secondsLeft: number | null;
  message: string;
}

export interface DoorCueInput {
  /** m/s. */
  speed: number;
  objective: ObjectiveState | null;
  /** All doors on the driving vehicle closed, if the loco reports them. */
  doorsClosed: boolean | null;
  /** Start asking for the doors to be closed this many seconds before departure. */
  leadSeconds: number;
}

/**
 * When to close and lock the doors at a station: counts the dwell down and
 * moves from "dwell" to "close" to "ready" as departure approaches. Quiet
 * while moving or when the game gives no dwell for this stop.
 */
export function doorCue({ speed, objective, doorsClosed, leadSeconds }: DoorCueInput): DoorCue {
  const none: DoorCue = { stage: "none", secondsLeft: null, message: "" };
  if (speed > 0.5 || !objective) return none;

  if (objective.waitForDoorOpen) return { stage: "open", secondsLeft: null, message: "Open the doors" };

  const left = objective.waitRemaining;
  if (left != null && objective.waitTime != null && objective.waitTime > 0) {
    if (left <= 0.5) {
      return {
        stage: "ready",
        secondsLeft: 0,
        message: doorsClosed === false ? "Close and lock the doors: ready to depart" : "Doors locked: ready to depart",
      };
    }
    if (left <= leadSeconds) {
      return doorsClosed === true
        ? { stage: "ready", secondsLeft: left, message: "Doors closed" }
        : { stage: "close", secondsLeft: left, message: "Close the doors" };
    }
    return { stage: "dwell", secondsLeft: left, message: "Dwell" };
  }

  if (objective.waitForDoorClosed) return { stage: "close", secondsLeft: null, message: "Close the doors" };
  return none;
}

const DOOR_KEYS = ["doorFL", "doorFR", "doorBL", "doorBR"] as const;

/**
 * Whether every passenger door the loco reports is closed, or null when it
 * reports none (only some profiles read door positions, and only for the
 * driving vehicle).
 */
export function doorsClosedFrom(values: Record<string, number | boolean | string | null> | undefined): boolean | null {
  if (!values) return null;
  const doors = DOOR_KEYS.map((k) => values[k]).filter((v): v is number => typeof v === "number");
  return doors.length === 0 ? null : doors.every((d) => d <= 0.01);
}

// ---------------------------------------------------------------------------
// Dwell timer direction
// ---------------------------------------------------------------------------

/**
 * The game's CurrentWaitTime may count up from 0 or down from WaitTime. Watches
 * successive readings to tell which, then reports the seconds left.
 */
export class DwellTimer {
  private index: number | null = null;
  private last: number | null = null;
  private direction: "up" | "down" | null = null;

  /** Seconds left, or null until the direction is known. */
  remaining(index: number, waitTime: number | null, current: number | null): number | null {
    if (index !== this.index) {
      this.index = index;
      this.last = null;
      this.direction = null;
    }
    if (waitTime == null || waitTime <= 0 || current == null) return null;
    if (this.last != null && Math.abs(current - this.last) > 1e-6) {
      this.direction = current < this.last ? "down" : "up";
    }
    this.last = current;
    if (this.direction === "down") return Math.max(0, current);
    if (this.direction === "up") return Math.max(0, waitTime - current);
    // Not seen moving yet, so it could be an up-counter at 0 or a finished down-counter:
    // say nothing rather than guess.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stops: station list + platform markers
// ---------------------------------------------------------------------------

/** "Clapham Junction 15" -> { name: "Clapham Junction", platform: "15" }. */
export function splitPlatform(label: string): { name: string; platform: string | null } {
  const m = label.trim().match(/^(.*?)\s+(?:platform\s+)?(\d{1,2}[A-Za-z]?)$/i);
  return m && m[1] ? { name: m[1], platform: m[2]!.toUpperCase() } : { name: label.trim(), platform: null };
}
