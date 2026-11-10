// Braking advice: how hard you'd need to brake for the next lower speed
// limit or red signal, and when to start. Pure functions so both the web app
// and tests can use them.

import type { DriverAidState } from "./index.js";

export interface BrakeTarget {
  kind: "limit" | "signal";
  /** Metres to the point where the speed must be reached. */
  distance: number;
  /** m/s. */
  targetSpeed: number;
}

export type BrakeLevel = "none" | "approach" | "brake" | "urgent";

export interface BrakeAdvice {
  level: BrakeLevel;
  target: BrakeTarget | null;
  /** m/s² needed to meet the target from here. */
  requiredDecel: number;
  /** Metres until braking at the comfortable rate must start (negative = already late). */
  brakeIn: number;
}

export interface BrakeOptions {
  /** Normal service braking rate, m/s². */
  comfortDecel: number;
  /** Above this you're into heavy braking, m/s². */
  urgentDecel: number;
  /** How far ahead (seconds at current speed) to start showing the countdown. */
  lookaheadSeconds: number;
  /** Stop this far short of a red signal, metres. */
  signalMargin: number;
}

export const DEFAULT_BRAKE_OPTIONS: BrakeOptions = {
  comfortDecel: 0.45,
  urgentDecel: 0.8,
  lookaheadSeconds: 12,
  signalMargin: 20,
};

/** Treat any stop/danger aspect as "be stopped before it". */
export function isStopAspect(aspect: string): boolean {
  return /stop|danger/i.test(aspect);
}

export function brakeTargets(aid: DriverAidState | null, options = DEFAULT_BRAKE_OPTIONS): BrakeTarget[] {
  if (!aid) return [];
  const targets: BrakeTarget[] = [];
  for (const l of aid.limits) {
    if (l.limit != null) targets.push({ kind: "limit", distance: l.distance, targetSpeed: l.limit });
  }
  for (const s of aid.signals) {
    if (isStopAspect(s.aspect)) {
      targets.push({ kind: "signal", distance: Math.max(0, s.distance - options.signalMargin), targetSpeed: 0 });
    }
  }
  return targets;
}

/** The most demanding target ahead, and what to do about it. */
export function adviseBraking(speed: number, targets: BrakeTarget[], options = DEFAULT_BRAKE_OPTIONS): BrakeAdvice {
  let worst: BrakeAdvice = { level: "none", target: null, requiredDecel: 0, brakeIn: Infinity };
  for (const t of targets) {
    if (t.targetSpeed >= speed) continue;
    const dv2 = speed * speed - t.targetSpeed * t.targetSpeed;
    const requiredDecel = t.distance > 0.5 ? dv2 / (2 * t.distance) : Infinity;
    const brakeIn = t.distance - dv2 / (2 * options.comfortDecel);
    if (brakeIn < worst.brakeIn) worst = { level: "none", target: t, requiredDecel, brakeIn };
  }
  if (!worst.target) return worst;

  if (worst.requiredDecel >= options.urgentDecel) worst.level = "urgent";
  else if (worst.brakeIn <= 0) worst.level = "brake";
  else if (worst.brakeIn <= speed * options.lookaheadSeconds) worst.level = "approach";
  return worst;
}
