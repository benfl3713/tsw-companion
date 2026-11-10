import { useSyncExternalStore } from "react";
import type { RecordedFeature, ServerMessage, Telemetry } from "@tsw/shared";

export type LinkStatus = "connecting" | "open" | "closed";

export interface StoreState {
  link: LinkStatus;
  data: Telemetry;
  /** Drive updates received in the last second. */
  driveHz: number;
  /** Signals and limits the bridge has learnt by driving. */
  recorded: RecordedFeature[];
}

const EMPTY: Telemetry = {
  connection: { status: "waiting-for-game" },
  loco: null,
  drive: null,
  driverAid: null,
  position: null,
  track: null,
  world: null,
  cab: null,
  objective: null,
};

/** Don't extrapolate further than this past the last sample. */
const MAX_EXTRAPOLATION_S = 0.1;

/**
 * Holds one WebSocket to the bridge (reconnecting forever) and exposes the
 * latest telemetry to React. The speed sample is also kept outside React so
 * the speedo can animate at display rate without re-rendering.
 */
class TelemetryStore {
  private state: StoreState = { link: "connecting", data: EMPTY, driveHz: 0, recorded: [] };
  private listeners = new Set<() => void>();
  private driveCount = 0;
  private lastSpeed = { speed: 0, acceleration: 0, at: 0 };
  /** Metres travelled, integrated from speed samples; only differences matter. */
  private odometer = 0;
  /** Odometer reading when the current lookahead (driverAid/track) arrived. */
  private lookaheadOdometer = 0;
  private retryMs = 500;

  constructor(private readonly url: string) {
    this.connect();
    setInterval(() => {
      if (this.state.driveHz !== this.driveCount) this.set({ driveHz: this.driveCount });
      this.driveCount = 0;
    }, 1000);
  }

  private connect() {
    const ws = new WebSocket(this.url);
    this.set({ link: "connecting" });
    ws.onopen = () => {
      this.retryMs = 500;
      this.set({ link: "open" });
    };
    ws.onclose = () => {
      this.set({ link: "closed", data: EMPTY });
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 5000);
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as ServerMessage;
      if (msg.type === "recorded") {
        const byId = new Map(msg.replace ? [] : this.state.recorded.map((f) => [f.id, f]));
        for (const f of msg.features) byId.set(f.id, f);
        this.set({ recorded: [...byId.values()] });
        return;
      }
      const data = msg.type === "snapshot" ? msg.data : { ...this.state.data, ...msg.data };
      if (msg.data.drive) {
        const now = performance.now();
        this.odometer = this.odometerAt(now);
        this.driveCount++;
        this.lastSpeed = {
          speed: msg.data.drive.speed ?? 0,
          acceleration: msg.data.drive.acceleration ?? 0,
          at: now,
        };
      }
      if (msg.data.driverAid || msg.data.track) this.lookaheadOdometer = this.odometerAt(performance.now());
      this.set({ data });
    };
  }

  private set(patch: Partial<StoreState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  /** Speed in m/s right now, nudged forward by acceleration since the last sample. */
  speedAt(now: number): number {
    const dt = Math.min((now - this.lastSpeed.at) / 1000, MAX_EXTRAPOLATION_S);
    return Math.max(0, this.lastSpeed.speed + this.lastSpeed.acceleration * dt);
  }

  private odometerAt(now: number): number {
    if (!this.lastSpeed.at) return this.odometer;
    // Trapezoid between the last sample and the extrapolated speed now.
    // Cap so a paused game or stalled link doesn't keep "moving" the train.
    const dt = Math.min(Math.max(0, (now - this.lastSpeed.at) / 1000), 0.25);
    return this.odometer + ((this.lastSpeed.speed + this.speedAt(now)) / 2) * dt;
  }

  /**
   * Metres travelled since the lookahead was sampled. Subtract from upcoming
   * distances so items glide between 10 Hz updates instead of jumping.
   */
  travelledSinceLookahead(now: number): number {
    return Math.max(0, this.odometerAt(now) - this.lookaheadOdometer);
  }
}

const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
export const store = new TelemetryStore(wsUrl);

export function useTelemetry(): StoreState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
