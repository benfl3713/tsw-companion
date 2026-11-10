import { describe, expect, it } from "vitest";
import { adviseBraking, brakeTargets, type DriverAidState } from "@tsw/shared";
import { parseObjectiveIndex } from "../src/telemetry/normalize.js";

const MPH = 0.44704;

function aid(partial: Partial<DriverAidState>): DriverAidState {
  return {
    speedLimit: 75 * MPH,
    speedLimitSource: "TrackSpeedLimit",
    trackMaxSpeed: 75 * MPH,
    serviceMaxSpeed: null,
    formationMaxSpeed: null,
    gradient: 0,
    signals: [],
    limits: [],
    ...partial,
  };
}

describe("brakeTargets", () => {
  it("takes limit changes and stop signals, stopping short of the signal", () => {
    const targets = brakeTargets(
      aid({
        limits: [{ limit: 50 * MPH, distance: 2000, position: null, type: "TrackRuleSpeedLimit" }],
        signals: [
          { aspect: "Clear", distance: 800, position: null },
          { aspect: "Stop", distance: 1500, position: null },
        ],
      }),
    );
    expect(targets).toEqual([
      { kind: "limit", distance: 2000, targetSpeed: 50 * MPH },
      { kind: "signal", distance: 1480, targetSpeed: 0 },
    ]);
  });
});

describe("adviseBraking", () => {
  const v = 75 * MPH; // 33.5 m/s

  it("ignores raises and targets already met", () => {
    expect(adviseBraking(v, [{ kind: "limit", distance: 500, targetSpeed: 90 * MPH }]).level).toBe("none");
  });

  it("stays quiet when the brake point is far off", () => {
    const advice = adviseBraking(v, [{ kind: "signal", distance: 5000, targetSpeed: 0 }]);
    expect(advice.level).toBe("none");
    // 33.5² / (2 × 0.45) ≈ 1249 m of braking.
    expect(advice.brakeIn).toBeCloseTo(5000 - 1249, -1);
  });

  it("counts down shortly before the brake point", () => {
    expect(adviseBraking(v, [{ kind: "signal", distance: 1500, targetSpeed: 0 }]).level).toBe("approach");
  });

  it("says brake once past the comfortable brake point", () => {
    expect(adviseBraking(v, [{ kind: "signal", distance: 1000, targetSpeed: 0 }]).level).toBe("brake");
  });

  it("escalates when heavy braking is needed", () => {
    const advice = adviseBraking(v, [{ kind: "signal", distance: 600, targetSpeed: 0 }]);
    expect(advice.level).toBe("urgent");
    expect(advice.requiredDecel).toBeCloseTo(0.935, 2);
  });

  it("picks the target you must brake for first", () => {
    const advice = adviseBraking(v, [
      { kind: "signal", distance: 3000, targetSpeed: 0 },
      { kind: "limit", distance: 900, targetSpeed: 40 * MPH },
    ]);
    expect(advice.target?.kind).toBe("limit");
  });
});

describe("parseObjectiveIndex", () => {
  it("reads the active objective, or none", () => {
    expect(parseObjectiveIndex({ Current: "2" })).toBe(2);
    expect(parseObjectiveIndex({})).toBeNull();
    expect(parseObjectiveIndex({ Current: "" })).toBeNull();
  });
});
