import { useEffect, useRef, useState } from "react";
import { clockSeconds, type Telemetry } from "@tsw/shared";

/** A stop the train made: where, and when it arrived and left (game clock, seconds of the day). */
export interface StopRecord {
  name: string;
  platform: string | null;
  arrived: number;
  departed: number | null;
}

export interface StopHistory {
  /** Stops already made this service, oldest first. */
  called: StopRecord[];
  /** The stop the train is standing at now, if any. */
  here: StopRecord | null;
}

/** How near a stop's stopping point the train must be to count as stopped there. */
const AT_STOP_M = 80;
const STANDING_MS = 0.3;
const MOVING_MS = 1.5;
const MAX_KEPT = 40;

const storageKey = (service: string | null) => `tsw.stops.${service ?? "free-roam"}`;

function load(service: string | null): StopRecord[] {
  try {
    const raw = sessionStorage.getItem(storageKey(service));
    return raw ? (JSON.parse(raw) as StopRecord[]) : [];
  } catch {
    return [];
  }
}

/**
 * Notes each stop the train makes, so the schedule can show where you've been
 * and when. A stop counts once the train is standing at a platform's stopping
 * point and is closed when it moves off. Kept for the browser session, per service.
 */
export function useStopHistory(t: Telemetry): StopHistory {
  const service = t.position?.serviceName ?? null;
  const [called, setCalled] = useState<StopRecord[]>(() => load(service));
  const [here, setHere] = useState<StopRecord | null>(null);
  const open = useRef<StopRecord | null>(null);
  const lastService = useRef(service);

  // A new service starts a fresh list.
  useEffect(() => {
    if (lastService.current === service) return;
    lastService.current = service;
    open.current = null;
    setHere(null);
    setCalled(load(service));
  }, [service]);

  const speed = t.drive?.speed ?? null;
  const clock = clockSeconds(t.world?.localTimeIso);
  const stops = t.track?.stops;

  useEffect(() => {
    if (speed == null || clock == null) return;
    const standingAt = stops?.find((s) => Math.abs(s.distance) < AT_STOP_M);
    if (!open.current && speed < STANDING_MS && standingAt) {
      open.current = { name: standingAt.name, platform: standingAt.platform, arrived: clock, departed: null };
      setHere(open.current);
    } else if (open.current && speed > MOVING_MS) {
      const done = { ...open.current, departed: clock };
      open.current = null;
      setHere(null);
      setCalled((prev) => {
        const next = [...prev, done].slice(-MAX_KEPT);
        try {
          sessionStorage.setItem(storageKey(service), JSON.stringify(next));
        } catch {
          // Not persisted; fine.
        }
        return next;
      });
    }
  }, [speed, clock, stops, service]);

  return { called, here };
}
