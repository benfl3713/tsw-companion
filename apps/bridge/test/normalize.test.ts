import { describe, expect, it } from "vitest";
import { findProfile, resolveProfile, type DriverAidData, type DriverAidPlayerInfo, type DriverAidTrackData } from "@tsw/shared";
import samples from "./fixtures/tsw7-class66-depot.json" with { type: "json" };
import {
  clean,
  firstBoolean,
  firstNumber,
  normalizeDriverAid,
  normalizePlayerInfo,
  normalizeTrackData,
  readField,
} from "../src/telemetry/normalize.js";
import { entriesByPath } from "../src/tsw/subscription.js";

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

describe("readField", () => {
  // Response shapes observed on the Class 805.
  const values = new Map<string, Record<string, unknown>>([
    ["HUD_GetPowerHandle", { Power: -38, IsActive: true, IsNegative: true }],
    ["HUD_GetLocomotiveBrakeHandle", { HandlePosition: 0, IsActive: false }],
    ["HUD_GetBrakeGauge_1", { "WhiteNeedle (Pa)": 120000, "RedNeedle (Pa)": 850000 }],
    ["BP_AWS_TPWS_Service.GetAWS_SunflowerState", { CurrentState: 1 }],
  ]);

  it("reads a named field", () => {
    expect(readField(values, { path: "HUD_GetBrakeGauge_1", field: "RedNeedle (Pa)" })).toBe(850000);
    expect(readField(values, { path: "HUD_GetPowerHandle", field: "Power", activeField: "IsActive" })).toBe(-38);
  });

  it("returns null for controls the loco doesn't have", () => {
    expect(readField(values, { path: "HUD_GetLocomotiveBrakeHandle", field: "HandlePosition", activeField: "IsActive" })).toBeNull();
    expect(readField(values, { path: "Missing" })).toBeNull();
  });

  it("falls back through alternative paths", () => {
    const spec = { path: ["AWS_TPWS_Service.GetAWS_SunflowerState", "BP_AWS_TPWS_Service.GetAWS_SunflowerState"], field: "CurrentState" };
    expect(readField(values, spec)).toBe(1);
  });
});

describe("entriesByPath", () => {
  it("decodes the URL-encoded paths the game echoes back", () => {
    const values = entriesByPath({
      RequestedSubscriptionID: 1,
      Entries: [
        { Path: "CurrentDrivableActor/Simulation/MR%20%28AirPipe%29.Pressure_BAR_G", NodeValid: true, Values: { Pressure_BAR_G: 7.6 } },
        { Path: "DriverAid.Data", NodeValid: false },
      ],
    });
    expect(values.get("CurrentDrivableActor/Simulation/MR (AirPipe).Pressure_BAR_G")).toEqual({ Pressure_BAR_G: 7.6 });
    expect(values.has("DriverAid.Data")).toBe(true);
    expect(values.get("DriverAid.Data")).toBeUndefined();
  });
});

describe("resolveProfile", () => {
  const profile = findProfile("RVM_PBD_LNER_Class801_01_DPTS_C")!;

  it("finds loco-specific service nodes by suffix", () => {
    const resolved = resolveProfile(profile, ["Simulation", "PBD_LNER_Class801_AWS_TPWS_Service", "BP_DVD_Service"]);
    expect(resolved.fields.awsSunflower?.path).toBe(
      "CurrentDrivableActor/PBD_LNER_Class801_AWS_TPWS_Service.Function.GetAWS_SunflowerState",
    );
    expect(resolved.fields.dsdWarning?.path).toBe(
      "CurrentDrivableActor/BP_DVD_Service.Function.WarningDevices_GetIsWarningVisualState",
    );
    // Plain paths are untouched.
    expect(resolved.fields.mainRes?.path).toBe("CurrentDrivableActor/Simulation/MR (AirPipe).Pressure_BAR_G");
  });

  it("drops fields whose component the loco lacks", () => {
    const resolved = resolveProfile(profile, ["Simulation"]);
    expect(resolved.fields.awsSunflower).toBeUndefined();
    expect(resolved.fields.mainRes).toBeDefined();
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
