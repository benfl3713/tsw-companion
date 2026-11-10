import { useEffect, useState } from "react";

export type SpeedUnit = "mph" | "kmh";

const FACTOR: Record<SpeedUnit, number> = { mph: 2.2369363, kmh: 3.6 };
export const UNIT_LABEL: Record<SpeedUnit, string> = { mph: "mph", kmh: "km/h" };

export function toUnit(ms: number, unit: SpeedUnit): number {
  return ms * FACTOR[unit];
}

/** Speed limits are set in whole units, so round away float noise (40 mph = 17.8816 m/s). */
export function limitIn(ms: number | null | undefined, unit: SpeedUnit): number | null {
  return ms == null ? null : Math.round(toUnit(ms, unit));
}

export function formatDistance(m: number, unit: SpeedUnit): string {
  if (unit === "mph") {
    const miles = m / 1609.344;
    return miles >= 0.25 ? `${miles.toFixed(miles >= 10 ? 0 : 1)} mi` : `${Math.round(m * 1.0936133)} yd`;
  }
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`;
}

const STORAGE_KEY = "tsw.speedUnit";

function readStored(): SpeedUnit {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "mph" || v === "kmh") return v;
  } catch {
    // Private mode etc.; fall through to the default.
  }
  return "mph";
}

export function useSpeedUnit(): [SpeedUnit, () => void] {
  const [unit, setUnit] = useState<SpeedUnit>(readStored);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, unit);
    } catch {
      // Not persisted; fine.
    }
  }, [unit]);
  return [unit, () => setUnit((u) => (u === "mph" ? "kmh" : "mph"))];
}
