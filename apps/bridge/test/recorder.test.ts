import { describe, expect, it } from "vitest";
import type { DriverAidState, DriveState, RecordedFeature, Telemetry } from "@tsw/shared";
import { metresBetween, pruneRepeatedLimits, RouteRecorder } from "../src/route/recorder.js";

const M_PER_DEG_LAT = 111_320;

/** Drives a train north at constant speed, feeding the recorder like the bridge does. */
function simulate(
  opts: { speed: number; seconds: number; lookahead: (pos: number) => Partial<DriverAidState> },
  existing?: { rec: RouteRecorder; clock: { now: number } },
) {
  const clock = existing?.clock ?? { now: 0 };
  const changed: RecordedFeature[] = [];
  const rec = existing?.rec ?? new RouteRecorder(null, (c) => changed.push(...c), () => clock.now);
  const start = clock.now;
  let now = 0;
  rec.observe({ loco: null }); // a fresh run, like reloading a service
  const drive = (speed: number) => ({ speed, direction: 1 }) as DriveState;
  const aid = (pos: number): DriverAidState => ({
    speedLimit: 30,
    speedLimitSource: "TrackSpeedLimit",
    trackMaxSpeed: 30,
    serviceMaxSpeed: null,
    formationMaxSpeed: null,
    gradient: 0,
    signals: [],
    limits: [],
    ...opts.lookahead(pos),
  });

  for (let tick = 0; tick <= opts.seconds * 30; tick++) {
    now = (tick * 1000) / 30;
    clock.now = start + now;
    const pos = opts.speed * (now / 1000);
    const update: Partial<Telemetry> = { drive: drive(opts.speed) };
    if (tick % 3 === 0) {
      update.driverAid = aid(pos);
      update.position = { latitude: 51 + pos / M_PER_DEG_LAT, longitude: -1, cameraMode: "", serviceName: null };
    }
    rec.observe(update);
  }
  return { rec, changed, clock };
}

const at = (metres: number) => ({ latitude: 51 + metres / M_PER_DEG_LAT, longitude: -1 });

describe("RouteRecorder", () => {
  it("records a signal where the train passes it, heading north", () => {
    const { rec } = simulate({
      speed: 20,
      seconds: 30,
      lookahead: (pos) => (pos < 400 ? { signals: [{ aspect: "Clear", distance: 400 - pos, position: null }] } : {}),
    });
    const [signal] = rec.all();
    expect(rec.all()).toHaveLength(1);
    expect(signal!.kind).toBe("signal");
    expect(metresBetween(signal!, at(400))).toBeLessThan(8);
    expect(signal!.bearing).toBeCloseTo(0, 0);
  });

  it("records limit changes with their value", () => {
    const { rec } = simulate({
      speed: 25,
      seconds: 20,
      lookahead: (pos) =>
        pos < 300 ? { limits: [{ limit: 17.88, distance: 300 - pos, position: null, type: "TrackRuleSpeedLimit" }] } : {},
    });
    expect(rec.all()).toEqual([expect.objectContaining({ kind: "limit", limit: 17.88, limitType: "TrackRuleSpeedLimit" })]);
    expect(metresBetween(rec.all()[0]!, at(300))).toBeLessThan(8);
  });

  it("drops items that leave the lookahead early (different route)", () => {
    const { rec } = simulate({
      speed: 20,
      seconds: 30,
      lookahead: (pos) => ({
        signals: [
          ...(pos < 150 ? [{ aspect: "Clear", distance: 500 - pos, position: null }] : []),
          { aspect: "Clear", distance: 2000 - pos, position: null },
        ],
      }),
    });
    expect(rec.all()).toHaveLength(0);
  });

  it("prunes repeated same-value limits recorded before filtering", () => {
    const limitAt = (m: number, mph: number): RecordedFeature => ({
      id: `l${m}`,
      kind: "limit",
      ...at(m),
      bearing: 0,
      limit: mph * 0.44704,
      seen: 1,
      lastSeen: "",
    });
    const pruned = pruneRepeatedLimits([
      limitAt(0, 20),
      limitAt(40, 20),
      limitAt(80, 20),
      limitAt(120, 20),
      limitAt(300, 40),
      limitAt(400, 20), // a real change back to 20 after the 40
    ]);
    expect(pruned.map((f) => f.id)).toEqual(["l0", "l300", "l400"]);
  });

  it("merges repeat passes instead of duplicating", () => {
    const signalAt400 = (pos: number) =>
      pos < 400 ? { signals: [{ aspect: "Clear", distance: 400 - pos, position: null }] } : {};
    const first = simulate({ speed: 20, seconds: 30, lookahead: signalAt400 });
    simulate({ speed: 15, seconds: 40, lookahead: signalAt400 }, first);
    expect(first.rec.all()).toHaveLength(1);
    expect(first.rec.all()[0]!.seen).toBe(2);
    expect(metresBetween(first.rec.all()[0]!, at(400))).toBeLessThan(8);
  });
});
