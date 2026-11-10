import { describe, expect, it } from "vitest";
import type { DriverAidData, DriverAidPlayerInfo, DriverAidTrackData } from "@tsw/shared";
import samples from "./fixtures/tsw7-class66-depot.json" with { type: "json" };
import {
  clean,
  firstBoolean,
  firstNumber,
  normalizeDriverAid,
  normalizePlayerInfo,
  normalizeTrackData,
} from "../src/telemetry/normalize.js";

describe("clean", () => {
  it("treats FLT_MAX as missing", () => {
    expect(clean(3.4028234663852886e38)).toBeNull();
    expect(clean(12.5)).toBe(12.5);
    expect(clean("12")).toBeNull();
  });
});

describe("HUD values", () => {
  it("reads the single value whatever its key", () => {
    expect(firstNumber(samples["CurrentDrivableActor.Function.HUD_GetSpeed"].Values)).toBeCloseTo(1.8295, 3);
    expect(firstNumber(samples["CurrentDrivableActor.Function.HUD_GetAcceleration"].Values)).toBeCloseTo(0.363, 3);
    expect(firstNumber(undefined)).toBeNull();
    expect(firstBoolean({ "Is Slipping": true })).toBe(true);
    expect(firstBoolean({ Value: 0 })).toBe(false);
  });
});

describe("DriverAid.Data", () => {
  const aid = normalizeDriverAid(samples["DriverAid.Data"].Values as DriverAidData);

  it("keeps the current limit and drops FLT_MAX limits", () => {
    expect(aid.speedLimit).toBeCloseTo(11.11, 2); // 40 km/h
    expect(aid.serviceMaxSpeed).toBeNull();
    expect(aid.formationMaxSpeed).toBeNull();
  });

  it("handles empty lookahead (depot)", () => {
    expect(aid.signals).toEqual([]);
    expect(aid.limits).toEqual([]);
  });

  it("converts lookahead distances from cm and drops zero positions", () => {
    const withAhead = normalizeDriverAid({
      ...(samples["DriverAid.Data"].Values as DriverAidData),
      nextSignals: [{ value: "Clear", distanceToNextSignal: 24309.77, nextSignalPosition: { x: 0, y: 0, z: 0 } }],
      nextSpeedLimits: [
        {
          value: { value: 11.11 },
          distanceToNextSpeedLimit: 26766.5,
          nextSpeedLimitPosition: { x: -27253, y: -4349, z: 42210 },
          restrictionType: "TrackRuleSpeedLimit",
        },
      ],
    });
    expect(withAhead.signals[0]).toEqual({ aspect: "Clear", distance: expect.closeTo(243.1, 1), position: null });
    expect(withAhead.limits[0]?.distance).toBeCloseTo(267.7, 1);
    expect(withAhead.limits[0]?.position).not.toBeNull();
  });
});

describe("DriverAid.PlayerInfo", () => {
  it("maps position and hides the 'None' service", () => {
    const pos = normalizePlayerInfo(samples["DriverAid.PlayerInfo"].Values as DriverAidPlayerInfo);
    expect(pos.latitude).toBeCloseTo(51.1172, 4);
    expect(pos.longitude).toBeCloseTo(6.2237, 4);
    expect(pos.serviceName).toBeNull();
  });
});

describe("DriverAid.TrackData", () => {
  it("converts markers and heights to metres", () => {
    const track = normalizeTrackData(samples["DriverAid.TrackData"].Values as DriverAidTrackData);
    expect(track.markers[0]).toEqual({
      name: "Central Depot Track 16",
      type: "Siding",
      distance: expect.closeTo(58.33, 2),
      platformLength: expect.closeTo(90.0, 1),
    });
    expect(track.heights[1]?.distance).toBeCloseTo(58.71, 2);
  });
});
