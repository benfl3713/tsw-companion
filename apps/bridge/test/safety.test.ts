import { describe, expect, it } from "vitest";
import { awsWarningActive, dsdWarningActive } from "@tsw/shared";

describe("awsWarningActive", () => {
  it("follows the game's acknowledge-required flag when the loco has one", () => {
    expect(awsWarningActive({ awsAckRequired: true, awsWarning: 1 })).toBe(true);
    // Acknowledged: required drops, even if the warning state is still non-zero.
    expect(awsWarningActive({ awsAckRequired: false, awsWarning: 2 })).toBe(false);
    expect(awsWarningActive({ awsAckRequired: 0, awsWarning: 1 })).toBe(false);
  });

  it("doesn't treat later enum states as a warning (80x AWS_WarningState)", () => {
    expect(awsWarningActive({ awsWarning: 0 })).toBe(false);
    expect(awsWarningActive({ awsWarning: 1 })).toBe(true);
    expect(awsWarningActive({ awsWarning: 2 })).toBe(false);
    expect(awsWarningActive({ awsWarning: 3 })).toBe(false);
  });

  it("clears an indicator once it's acknowledged (Electrostar)", () => {
    expect(awsWarningActive({ awsWarning: true, awsAcknowledged: false })).toBe(true);
    expect(awsWarningActive({ awsWarning: true, awsAcknowledged: true })).toBe(false);
    expect(awsWarningActive({ awsWarning: false, awsAcknowledged: false })).toBe(false);
  });

  it("uses the horn when it's all there is", () => {
    expect(awsWarningActive({ awsHorn: true })).toBe(true);
    expect(awsWarningActive({ awsHorn: false })).toBe(false);
  });

  it("is quiet for locos without AWS", () => {
    expect(awsWarningActive(undefined)).toBe(false);
    expect(awsWarningActive({})).toBe(false);
  });
});

describe("dsdWarningActive", () => {
  it("warns when the vigilance timer runs out", () => {
    expect(dsdWarningActive({ dsdElapsed: 59, dsdTimeToWarning: 60 })).toBe(false);
    expect(dsdWarningActive({ dsdElapsed: 60, dsdTimeToWarning: 60 })).toBe(true);
    expect(dsdWarningActive({ dsdWarning: true })).toBe(true);
  });
});
