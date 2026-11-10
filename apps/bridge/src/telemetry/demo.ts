import { findProfile, type Telemetry, type UpcomingLimit, type UpcomingSignal } from "@tsw/shared";
import type { UpdateListener } from "./loop.js";

// A looping 20 km synthetic route for working on the UI without the game.
const ROUTE_LENGTH = 20_000;
const MPH = 0.44704;
const SIGNALS = [1200, 2600, 4100, 5900, 7400, 9000, 10800, 12500, 14100, 15800, 17600, 19200];
const ASPECTS = ["Clear", "Clear", "Approach_2", "Approach_1", "Stop", "Clear"];
const LIMITS: { at: number; limit: number }[] = [
  { at: 0, limit: 75 * MPH },
  { at: 3000, limit: 50 * MPH },
  { at: 4500, limit: 75 * MPH },
  { at: 9500, limit: 30 * MPH },
  { at: 10600, limit: 60 * MPH },
  { at: 16000, limit: 40 * MPH },
];
const PLATFORMS = [
  { name: "Ashby Road", platform: "2", at: 6200, length: 160 },
  { name: "Millbrook", platform: "1", at: 8300, length: 220 },
  { name: "Northgate", platform: "3", at: 11200, length: 180 },
  { name: "Kingsgate", platform: "4", at: 14800, length: 280 },
  { name: "Westbury Park", platform: "1", at: 19500, length: 200 },
];

// The loop is drawn as a circle on the map.
const CENTRE = { lat: 51.5, lon: -0.45 };
const RADIUS_M = ROUTE_LENGTH / (2 * Math.PI);

function geoAt(pos: number) {
  const a = (pos / ROUTE_LENGTH) * 2 * Math.PI;
  return {
    latitude: CENTRE.lat + (RADIUS_M * Math.cos(a)) / 111_320,
    longitude: CENTRE.lon + (RADIUS_M * Math.sin(a)) / (111_320 * Math.cos((CENTRE.lat * Math.PI) / 180)),
  };
}

/** Distance from pos to target going forward around the loop. */
const ahead = (pos: number, at: number) => (at - pos + ROUTE_LENGTH) % ROUTE_LENGTH;

function limitAt(pos: number): number {
  let current = LIMITS[0]!.limit;
  for (const l of LIMITS) if (l.at <= pos) current = l.limit;
  return current;
}

/** `loco` picks the demo train, e.g. "Class805", "Class700" or "Class377", so each cab desk can be tried. */
export function runDemo(onUpdate: UpdateListener, loco = "Class805"): () => void {
  const objectClass = `RVM_DEMO_${loco}_C`;
  const profileId = findProfile(objectClass)?.id ?? "generic";
  // Start a little before the first platform so a stop (and its dwell) comes quickly.
  let pos = 5600;
  let speed = 20;
  let tick = 0;
  onUpdate({
    connection: { status: "connected", gameName: "Demo route", gameBuild: 0 },
    // Matches that loco's cab profile so its desk can be worked on too.
    loco: { objectClass, formationLength: 5 },
  });

  let brakeCylinder = 0;
  /** Seconds of dwell left while standing at a platform, else null. */
  let dwellLeft: number | null = null;
  const DWELL_SECONDS = 40;
  const timer = setInterval(() => {
    tick++;
    const dt = 1 / 30;
    // Stop at each platform for a dwell, then carry on, so the schedule and door cue have something to show.
    const nextPlatform = PLATFORMS.map((p) => ({ p, d: ahead(pos, p.at) })).sort((a, b) => a.d - b.d)[0]!;
    let accel: number;
    if (dwellLeft != null) {
      dwellLeft -= dt;
      speed = 0;
      accel = 0;
      if (dwellLeft <= 0) {
        dwellLeft = null;
        pos = (pos + 5) % ROUTE_LENGTH; // move off the stopping mark
      }
    } else {
      // Drift towards a little under the limit ahead, easing into the platform ahead.
      const limitTarget = Math.min(limitAt(pos), limitAt((pos + 400) % ROUTE_LENGTH)) * 0.95;
      // Follow a 0.5 m/s² braking curve into the platform, tightly enough to actually stop on the mark.
      const brakeTarget = Math.sqrt(2 * 0.5 * Math.max(nextPlatform.d - 1, 0));
      const braking = brakeTarget < limitTarget;
      accel = Math.max(-0.8, Math.min(0.5, ((braking ? brakeTarget : limitTarget) - speed) * (braking ? 2 : 0.3)));
      speed = Math.max(0, speed + accel * dt);
      if (nextPlatform.d < 2 && speed < 1) {
        speed = 0;
        dwellLeft = DWELL_SECONDS;
      }
      pos = (pos + speed * dt) % ROUTE_LENGTH;
    }
    const doorsOpen = dwellLeft != null && dwellLeft > 9;
    // Combined power/brake handle in percent, negative when braking, like the 805.
    const handle = Math.round(accel > 0.02 ? (accel / 0.5) * 100 : accel < -0.02 ? (accel / 0.8) * 100 : 0);
    brakeCylinder += ((handle < 0 ? (-handle / 100) * 3.2 : 0) - brakeCylinder) * Math.min(1, dt * 2);
    // An AWS warning approaching each caution aspect, cleared after 2 s.
    const awsCycle = Math.floor(tick / 30) % 20;

    onUpdate({
      drive: {
        speed,
        acceleration: accel,
        powerHandle: handle,
        trainBrakeHandle: handle < 0 ? -handle / 100 : 0,
        locoBrakeHandle: null,
        electricBrakeHandle: handle < 0 ? -handle / 100 : 0,
        brakeGauge1: 0,
        brakeGauge1Red: 0,
        brakeGauge2: 0,
        brakeGauge2Red: 0,
        ammeter: 0,
        tractiveEffort: handle > 0 ? handle * 1800 : 0,
        brakeEffort: handle < 0 ? -handle * 2200 : 0,
        engineRpm: 0,
        gearIndex: 0,
        direction: 1,
        maxPermittedSpeed: null,
        speedControlTarget: null,
        alerter: null,
        isSlipping: false,
        isTractionLocked: false,
      },
      cab: {
        profileId,
        values: {
          awsSunflower: awsCycle < 2 ? 1 : 0,
          awsWarning: awsCycle === 0 ? 1 : 0,
          // Passenger doors (Electrostar profile): open while dwelling, closed for the last few seconds.
          doorFL: doorsOpen ? 1 : 0,
          doorFR: doorsOpen ? 1 : 0,
          doorBL: doorsOpen ? 1 : 0,
          doorBR: doorsOpen ? 1 : 0,
          tpwsTrainStop: false,
          tpwsTrainStopFlashing: false,
          tpwsOverspeed: false,
          tpwsOverspeedFlashing: false,
          safetyBrakeDemand: false,
          dsdWarning: Math.floor(tick / 30) % 45 === 44,
          dsdPenalty: false,
          mainRes: 8.6 + Math.sin(tick / 200) * 0.6,
          brakePipe: 5,
          brakeCylinder,
          // 0..1 fractions, as the game's *_Percentage nodes report.
          tractionTargetPct: Math.max(0, handle) / 100,
          brakeTargetPct: Math.max(0, -handle) / 100,
          powerNotch: 4,
          reverserNotch: 2,
          engineRunning: false,
          pantographUp: true,
          lineSupply: true,
          powerMode: 1,
          draSet: false,
          brakeHoldSpeedReached: speed < 0.5,
          tractionLocked: false,
          displayPowered: true,
        },
      },
    });

    if (tick % 3 !== 0) return; // lookahead at 10 Hz, like the real tier
    const signals: UpcomingSignal[] = SIGNALS.map((at, i) => ({
      aspect: ASPECTS[(i + Math.floor(tick / 300)) % ASPECTS.length]!,
      distance: ahead(pos, at),
      position: null,
    }))
      .filter((s) => s.distance <= 10_000)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 4);
    const limits: UpcomingLimit[] = LIMITS.map((l) => ({
      limit: l.limit,
      distance: ahead(pos, l.at),
      position: null,
      type: "TrackRuleSpeedLimit",
    }))
      .filter((l) => l.distance > 0 && l.distance <= 10_000)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 4);

    onUpdate({
      driverAid: {
        speedLimit: limitAt(pos),
        speedLimitSource: "TrackSpeedLimit",
        trackMaxSpeed: limitAt(pos),
        serviceMaxSpeed: null,
        formationMaxSpeed: 75 * MPH,
        gradient: Math.round(Math.sin(pos / 2500) * 10) / 10,
        signals,
        limits,
      },
      position: { ...geoAt(pos), cameraMode: "FirstPerson_Driving", serviceName: "1D99" },
      track: {
        markers: PLATFORMS.map((p) => ({
          name: `${p.name} ${p.platform}`,
          type: "Platform",
          distance: ahead(pos, p.at),
          platformLength: p.length,
        })).sort((a, b) => a.distance - b.distance),
        // Every platform is a calling point, like a stopping service.
        stops: PLATFORMS.map((p) => ({
          name: p.name,
          platform: p.platform,
          distance: ahead(pos, p.at),
          platformLength: p.length,
          type: "Platform",
          calling: true,
        })).sort((a, b) => a.distance - b.distance),
        heights: [],
      },
      // A dwell at each platform: the timer counts up, like the game's, and the doors cue off it.
      objective:
        dwellLeft != null
          ? {
              index: 3,
              kind: "Wait",
              waitTime: DWELL_SECONDS,
              currentWaitTime: DWELL_SECONDS - dwellLeft,
              waitRemaining: dwellLeft,
              waitForDoorOpen: false,
              waitForDoorClosed: false,
              scheduledTime: null,
              scheduledIsArrival: false,
            }
          : null,
      world: {
        localTimeIso: new Date().toISOString(),
        gmtOffset: 0,
        temperature: 12,
        precipitation: 0,
        fogDensity: 0,
      },
    } satisfies Partial<Telemetry>);
  }, 1000 / 30);

  return () => clearInterval(timer);
}
