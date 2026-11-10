import type { CabValue } from "./index.js";

type Values = Record<string, CabValue> | undefined;

/** True for a set flag, whether the game sends a boolean or 0/1. */
export function on(v: CabValue | undefined): boolean {
  return v === true || (typeof v === "number" && v !== 0);
}

/**
 * Whether the driver still has to acknowledge an AWS warning right now.
 *
 * The game's "acknowledge required" flag is the authority where a loco has
 * one. Otherwise a warning indicator counts only until it's been
 * acknowledged (the Electrostar keeps the indicator lit for a moment after).
 * The 80x's AWS_WarningState is an enum, so it's only used as a last resort,
 * and only for its "warning" value (1), not later states like "acknowledged".
 */
export function awsWarningActive(values: Values): boolean {
  if (!values) return false;
  if (values.awsAckRequired != null) return on(values.awsAckRequired);
  if (values.awsHorn != null && values.awsWarning == null) return on(values.awsHorn);
  const warning = values.awsWarning;
  if (warning == null) return false;
  if (values.awsAcknowledged != null && on(values.awsAcknowledged)) return false;
  return typeof warning === "number" ? warning === 1 : on(warning);
}

/**
 * Vigilance warning, from a warning flag where the loco has one, or from its
 * timer (e.g. the Electrostar's DSD warns when elapsed reaches TimeToWarning).
 */
export function dsdWarningActive(values: Values): boolean {
  if (!values) return false;
  if (on(values.dsdWarning)) return true;
  const elapsed = values.dsdElapsed;
  const limit = values.dsdTimeToWarning;
  return typeof elapsed === "number" && typeof limit === "number" && limit > 0 && elapsed >= limit;
}
