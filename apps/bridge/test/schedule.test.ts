import { describe, expect, it } from "vitest";
import {
  doorCue,
  DwellTimer,
  estimateArrivals,
  formatClock,
  formatCountdown,
  parseGameTimeOfDay,
  splitPlatform,
  type DriverAidTrackData,
  type ObjectiveState,
} from "@tsw/shared";
import { normalizeTrackData } from "../src/telemetry/normalize.js";

// Calling points and platforms as the game returned them on a Class 377 service (2K12).
const station = (stationName: string, cm: number, len: number) => ({
  stationName,
  distanceToStation: { x: cm, y: 0 },
  distanceToStationCM: cm,
  platformLength: len,
  markerType: "Platform",
  markerName: "",
});
const platform = (stationName: string, cm: number, len: number) => ({
  ...station(stationName, cm, len),
  markerName: `${stationName.replace(/ (\d+)$/, " Platform $1")}`,
});

const SERVICE: DriverAidTrackData = {
  lastPlayerPosition: { height: 0, distanceToHeight: 0, bTunnelFound: false },
  trackHeights: [],
  stations: [
    station("Battersea Park", 106814, 19910),
    station("Clapham Junction", 334473, 25004),
    station("Wandsworth Common", 560114, 20188),
    station("Balham", 654700, 20931),
  ],
  markers: [
    platform("Battersea Park 3", 126724, 19910),
    platform("Clapham Junction 15", 359476, 25004),
    platform("Wandsworth Common 1", 580302, 20188),
    platform("Balham 1", 675598, 20931),
  ],
};

describe("normalizeTrackData stops", () => {
  it("pairs each calling point with its platform, once each", () => {
    const track = normalizeTrackData(SERVICE);
    expect(track.stops.map((s) => [s.name, s.platform])).toEqual([
      ["Battersea Park", "3"],
      ["Clapham Junction", "15"],
      ["Wandsworth Common", "1"],
      ["Balham", "1"],
    ]);
    // Stops at the platform marker, not the station centre.
    expect(track.stops[0]!.distance).toBeCloseTo(1267.2, 0);
    expect(track.stops.every((s) => s.calling)).toBe(true);
    // Platforms are no longer mixed in with stations, so nothing appears twice.
    expect(track.markers).toHaveLength(4);
  });

  it("falls back to the platforms ahead in free roam", () => {
    const track = normalizeTrackData({ ...SERVICE, stations: [] });
    expect(track.stops.map((s) => s.name)).toEqual(["Battersea Park", "Clapham Junction", "Wandsworth Common", "Balham"]);
    expect(track.stops.every((s) => !s.calling)).toBe(true);
  });
});

describe("splitPlatform", () => {
  it("separates a platform number from the station name", () => {
    expect(splitPlatform("Clapham Junction 15")).toEqual({ name: "Clapham Junction", platform: "15" });
    expect(splitPlatform("Clapham Junction Platform 15")).toEqual({ name: "Clapham Junction", platform: "15" });
    expect(splitPlatform("Balham")).toEqual({ name: "Balham", platform: null });
    expect(splitPlatform("Platform 2B")).toEqual({ name: "Platform", platform: "2B" });
  });
});

describe("parseGameTimeOfDay", () => {
  it("reads ticks, seconds, clock strings and wrapped values", () => {
    // 10:02:50 local, as the game's LocalTime ticks.
    expect(parseGameTimeOfDay(639299017703333900)).toBe(36170);
    expect(parseGameTimeOfDay(36170)).toBe(36170);
    expect(parseGameTimeOfDay("2026-11-10T08:37:56.630+00:00")).toBe(8 * 3600 + 37 * 60 + 56);
    expect(parseGameTimeOfDay("08:52")).toBe(8 * 3600 + 52 * 60);
    expect(parseGameTimeOfDay({ Ticks: 639299017703333900 })).toBe(36170);
  });

  it("says nothing for values it can't read", () => {
    expect(parseGameTimeOfDay({})).toBeNull();
    expect(parseGameTimeOfDay(null)).toBeNull();
    expect(parseGameTimeOfDay(0)).toBeNull();
    expect(parseGameTimeOfDay("soon")).toBeNull();
  });
});

describe("clock formatting", () => {
  it("formats times and countdowns", () => {
    expect(formatClock(8 * 3600 + 57 * 60 + 30)).toBe("08:57");
    expect(formatClock(8 * 3600 + 57 * 60 + 30, true)).toBe("08:57:30");
    expect(formatClock(86_400 + 60)).toBe("00:01");
    expect(formatCountdown(42)).toBe("0:42");
    expect(formatCountdown(125.4)).toBe("2:05");
    expect(formatCountdown(-3)).toBe("0:00");
  });
});

describe("estimateArrivals", () => {
  const base = { limits: [], currentLimit: 25, dwell: 30 };

  it("takes about a minute to cover 1.5 km at 25 m/s", () => {
    const [t] = estimateArrivals({ ...base, speed: 22, stops: [{ distance: 1500 }] });
    expect(t).toBeGreaterThan(60);
    expect(t).toBeLessThan(85);
  });

  it("takes longer from a standstill than at speed", () => {
    const moving = estimateArrivals({ ...base, speed: 22, stops: [{ distance: 1500 }] })[0]!;
    const standing = estimateArrivals({ ...base, speed: 0, stops: [{ distance: 1500 }] })[0]!;
    expect(standing).toBeGreaterThan(moving + 10);
  });

  it("adds the dwell for each stop passed", () => {
    const [a, b] = estimateArrivals({ ...base, speed: 22, stops: [{ distance: 1500 }, { distance: 3000 }] });
    const [alone] = estimateArrivals({ ...base, speed: 22, stops: [{ distance: 3000 }] });
    expect(b).toBeGreaterThan(a!);
    // Stopping at the first one costs dwell plus braking and accelerating, so it's well past the non-stop time.
    expect(b! - alone!).toBeGreaterThan(30);
  });

  it("is slower under a low limit", () => {
    const fast = estimateArrivals({ ...base, speed: 15, stops: [{ distance: 3000 }] })[0]!;
    const slow = estimateArrivals({ ...base, speed: 15, currentLimit: 11, stops: [{ distance: 3000 }] })[0]!;
    expect(slow).toBeGreaterThan(fast + 50);
  });

  it("doesn't count a dwell already in progress at the first stop", () => {
    const [here, next] = estimateArrivals({ ...base, speed: 0, stops: [{ distance: 5 }, { distance: 1500 }] });
    expect(here).toBe(0);
    const [alone] = estimateArrivals({ ...base, speed: 0, stops: [{ distance: 1500 }] });
    expect(next!).toBeCloseTo(alone!, 0);
  });

  it("gives nothing without stops", () => {
    expect(estimateArrivals({ ...base, speed: 10, stops: [] })).toEqual([]);
  });
});

describe("doorCue", () => {
  const objective = (over: Partial<ObjectiveState> = {}): ObjectiveState => ({
    index: 2,
    kind: "Wait",
    waitTime: 40,
    currentWaitTime: 5,
    waitRemaining: 35,
    waitForDoorOpen: false,
    waitForDoorClosed: false,
    scheduledTime: null,
    scheduledIsArrival: false,
    ...over,
  });
  const cue = (over: Partial<Parameters<typeof doorCue>[0]> = {}) =>
    doorCue({ speed: 0, objective: objective(), doorsClosed: null, leadSeconds: 15, ...over });

  it("counts the dwell, then asks for the doors, then says ready", () => {
    expect(cue().stage).toBe("dwell");
    expect(cue({ objective: objective({ waitRemaining: 14 }) })).toMatchObject({ stage: "close", message: "Close the doors" });
    expect(cue({ objective: objective({ waitRemaining: 0 }) }).stage).toBe("ready");
  });

  it("knows when the doors are already shut", () => {
    expect(cue({ objective: objective({ waitRemaining: 10 }), doorsClosed: true }).stage).toBe("ready");
    expect(cue({ objective: objective({ waitRemaining: 0 }), doorsClosed: false }).message).toMatch(/Close and lock/);
  });

  it("follows the game's door instructions", () => {
    expect(cue({ objective: objective({ waitTime: null, waitRemaining: null, waitForDoorOpen: true }) }).stage).toBe("open");
    expect(cue({ objective: objective({ waitTime: null, waitRemaining: null, waitForDoorClosed: true }) }).stage).toBe("close");
  });

  it("stays quiet while moving, without an objective, or before the timer is understood", () => {
    expect(cue({ speed: 5 }).stage).toBe("none");
    expect(cue({ objective: null }).stage).toBe("none");
    expect(cue({ objective: objective({ waitRemaining: null }) }).stage).toBe("none");
  });
});

describe("DwellTimer", () => {
  it("works out a timer that counts up", () => {
    const t = new DwellTimer();
    expect(t.remaining(1, 40, 0)).toBeNull(); // can't tell yet
    expect(t.remaining(1, 40, 1)).toBe(39);
    expect(t.remaining(1, 40, 11)).toBe(29);
  });

  it("works out a timer that counts down", () => {
    const t = new DwellTimer();
    expect(t.remaining(1, 40, 40)).toBeNull();
    expect(t.remaining(1, 40, 39)).toBe(39);
    expect(t.remaining(1, 40, 12)).toBe(12);
  });

  it("starts over for a new objective", () => {
    const t = new DwellTimer();
    t.remaining(1, 40, 1);
    t.remaining(1, 40, 2);
    expect(t.remaining(2, 30, 30)).toBeNull();
  });

  it("has nothing to say without a wait", () => {
    expect(new DwellTimer().remaining(1, null, null)).toBeNull();
    expect(new DwellTimer().remaining(1, 0, 0)).toBeNull();
  });
});
