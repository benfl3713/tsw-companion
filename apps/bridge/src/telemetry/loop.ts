import { setTimeout as sleep } from "node:timers/promises";
import {
  findProfile,
  profilePaths,
  type CabValue,
  type ConnectionState,
  type DriveState,
  type DriverAidData,
  type DriverAidPlayerInfo,
  type DriverAidTrackData,
  type ObjectiveState,
  type Telemetry,
} from "@tsw/shared";
import { findApiKey, TswClient } from "../tsw/client.js";
import { SubscriptionSet, type SubscriptionValues } from "../tsw/subscription.js";
import {
  cabValue,
  clean,
  firstNumber,
  normalizeDriverAid,
  normalizePlayerInfo,
  normalizeTrackData,
  parseObjectiveIndex,
  firstValue,
  readField,
} from "./normalize.js";
import { DRIVE_FIELDS, DRIVE_PATHS, OBJECTIVE_PROPS, PATHS } from "./paths.js";

export type UpdateListener = (update: Partial<Telemetry>) => void;

interface Tier {
  name: string;
  set: SubscriptionSet;
  /** Minimum time between reads; 0 = back to back (one per game tick). */
  intervalMs: number;
  handle: (values: SubscriptionValues) => void | Promise<void>;
  reads: number;
}

// Subscription ids are global to the game, so keep ours out of the way of other apps.
const BASE_SUBSCRIPTION_ID = 7100;
const MAX_CONSECUTIVE_ERRORS = 5;

/**
 * Keeps a connection to the game alive and streams telemetry. Survives the
 * game being closed and reopened, and the player changing loco.
 */
export class TelemetryLoop {
  private stopped = false;
  private generation = 0;
  private objectClass: string | null = null;

  constructor(
    private readonly onUpdate: UpdateListener,
    private readonly options: { key?: string; baseUrl?: string; log?: (msg: string) => void } = {},
  ) {}

  private log(msg: string) {
    (this.options.log ?? console.log)(msg);
  }

  private setConnection(connection: ConnectionState) {
    this.onUpdate({ connection });
  }

  stop() {
    this.stopped = true;
  }

  async run(): Promise<void> {
    let lastStatus = "";
    while (!this.stopped) {
      const found = findApiKey(this.options.key);
      if (!found) {
        if (lastStatus !== "no-key") this.log("No API key yet. Start TSW with the -HTTPAPI launch option.");
        lastStatus = "no-key";
        this.setConnection({ status: "no-key", message: "Start TSW with the -HTTPAPI launch option" });
        await sleep(3000);
        continue;
      }

      const client = new TswClient(found.key, this.options.baseUrl);
      let info;
      try {
        info = await client.info();
      } catch {
        if (lastStatus !== "waiting") this.log("Waiting for the game...");
        lastStatus = "waiting";
        this.setConnection({ status: "waiting-for-game" });
        await sleep(2000);
        continue;
      }

      lastStatus = "connected";
      this.log(`Connected to ${info.Meta.GameName} (build ${info.Meta.GameBuildNumber})`);
      const connection: ConnectionState = {
        status: "connected",
        gameName: info.Meta.GameName,
        gameBuild: info.Meta.GameBuildNumber,
      };
      this.setConnection(connection);
      await this.stream(client, connection);
      this.onUpdate({ loco: null, drive: null, driverAid: null, position: null, track: null, cab: null, objective: null });
      this.log("Lost connection to the game.");
    }
  }

  /** Runs the tiers until the game goes away. Restarts them when the loco changes. */
  private async stream(client: TswClient, connection: ConnectionState): Promise<void> {
    while (!this.stopped) {
      const generation = ++this.generation;
      const tiers = this.createTiers(client, connection);
      for (const tier of tiers) await tier.set.create();

      const stats = setInterval(() => {
        const rates = tiers.map((t) => `${t.name} ${(t.reads / 10).toFixed(1)} Hz`).join(", ");
        for (const t of tiers) t.reads = 0;
        this.log(`[telemetry] ${rates}`);
      }, 10_000);

      // Each tier loops on its own; a loco change bumps the generation and ends them.
      const results = await Promise.all(tiers.map((t) => this.runTier(t, generation)));
      clearInterval(stats);
      await Promise.all(tiers.map((t) => t.set.dispose()));

      if (results.includes("lost")) return;
      this.log(`Loco changed to ${this.objectClass ?? "none"}; resubscribing.`);
    }
  }

  private async runTier(tier: Tier, generation: number): Promise<"lost" | "restart" | "stopped"> {
    let errors = 0;
    while (!this.stopped) {
      if (generation !== this.generation) return "restart";
      const started = performance.now();
      try {
        const values = await tier.set.read();
        if (generation !== this.generation) return "restart";
        await tier.handle(values);
        tier.reads++;
        errors = 0;
      } catch {
        if (++errors >= MAX_CONSECUTIVE_ERRORS) {
          this.generation++; // stop sibling tiers too
          return "lost";
        }
      }
      const wait = tier.intervalMs - (performance.now() - started);
      if (wait > 0) await sleep(wait);
    }
    return "stopped";
  }

  /** One GET per property, all in flight together (one game tick). Missing ones read null. */
  private async readObjective(client: TswClient, index: number): Promise<ObjectiveState> {
    const entries = await Promise.all(
      Object.entries(OBJECTIVE_PROPS).map(async ([key, prop]) => {
        const res = await client.get(`Objectives/${index}.${prop}`).catch(() => undefined);
        return [key, res?.Result === "Success" ? firstValue(res.Values) : null] as const;
      }),
    );
    const v = Object.fromEntries(entries) as Record<keyof typeof OBJECTIVE_PROPS, unknown>;
    return {
      index,
      kind: typeof v.kind === "string" ? v.kind.replace(/^ObjectiveAction_|BP_C$|_C$/g, "") : "",
      waitTime: clean(v.waitTime),
      currentWaitTime: clean(v.currentWaitTime),
      waitForDoorOpen: v.waitForDoorOpen === true,
      waitForDoorClosed: v.waitForDoorClosed === true,
    };
  }

  private createTiers(client: TswClient, connection: ConnectionState): Tier[] {
    const driveFields = Object.entries(DRIVE_FIELDS) as [keyof DriveState, (typeof DRIVE_FIELDS)[keyof DriveState]][];
    let trainPresent: boolean | null = null;
    // The cab tier depends on the loco, which we only learn from the first read.
    const profile = findProfile(this.objectClass);

    const tiers: Tier[] = [
      {
        name: "drive",
        set: new SubscriptionSet(client, BASE_SUBSCRIPTION_ID, DRIVE_PATHS),
        intervalMs: 0,
        reads: 0,
        handle: (values) => {
          if (!values.get(DRIVE_FIELDS.speed.path)) {
            this.onUpdate({ drive: null });
            return;
          }
          const drive = {} as Record<keyof DriveState, number | boolean | null>;
          for (const [key, spec] of driveFields) {
            const v = readField(values, spec);
            drive[key] = spec.boolean ? (v == null ? null : Boolean(v)) : clean(v);
          }
          this.onUpdate({ drive: drive as unknown as DriveState });
        },
      },
      {
        name: "lookahead",
        // Track data rides along here: a read costs one tick whatever its size,
        // and the upcoming strip wants platforms as fresh as signals.
        set: new SubscriptionSet(client, BASE_SUBSCRIPTION_ID + 1, [
          PATHS.objectClass,
          PATHS.driverAid,
          PATHS.playerInfo,
          PATHS.trackData,
        ]),
        intervalMs: 100,
        reads: 0,
        handle: (values) => {
          const objectClass = (values.get(PATHS.objectClass)?.ObjectClass as string | undefined) ?? null;
          if (objectClass !== this.objectClass) {
            const first = this.objectClass === null && trainPresent === null;
            this.objectClass = objectClass;
            // Subscriptions may be bound to the old actor, so rebuild them.
            if (!first) this.generation++;
          }
          // Also rebuild if this loco needs a different cab profile than the tiers were built with.
          if (findProfile(objectClass)?.id !== profile?.id) this.generation++;
          if (trainPresent !== (objectClass !== null)) {
            trainPresent = objectClass !== null;
            this.onUpdate({ connection: { ...connection, status: trainPresent ? "connected" : "no-train" } });
          }

          const aid = values.get(PATHS.driverAid) as DriverAidData | undefined;
          const player = values.get(PATHS.playerInfo) as DriverAidPlayerInfo | undefined;
          const track = values.get(PATHS.trackData) as DriverAidTrackData | undefined;
          this.onUpdate({
            driverAid: aid && objectClass ? normalizeDriverAid(aid) : null,
            position: player?.geoLocation ? normalizePlayerInfo(player) : null,
            track: track && objectClass ? normalizeTrackData(track) : null,
          });
        },
      },
      {
        name: "world",
        set: new SubscriptionSet(client, BASE_SUBSCRIPTION_ID + 2, [
          PATHS.timeOfDay,
          PATHS.weather,
          PATHS.formationLength,
          PATHS.currentObjective,
        ]),
        intervalMs: 1000,
        reads: 0,
        handle: async (values) => {
          const time = values.get(PATHS.timeOfDay);
          const weather = values.get(PATHS.weather);
          const objectiveIndex = parseObjectiveIndex(values.get(PATHS.currentObjective));
          this.onUpdate({
            objective: objectiveIndex == null ? null : await this.readObjective(client, objectiveIndex),
            loco: this.objectClass
              ? { objectClass: this.objectClass, formationLength: firstNumber(values.get(PATHS.formationLength)) }
              : null,
            world: time
              ? {
                  localTimeIso: String(time.LocalTimeISO8601),
                  gmtOffset: Number(time.GMTOffset),
                  temperature: clean(weather?.Temperature),
                  precipitation: clean(weather?.Precipitation),
                  fogDensity: clean(weather?.FogDensity),
                }
              : null,
          });
        },
      },
    ];

    if (profile) {
      const fields = Object.entries(profile.fields);
      tiers.push({
        name: `cab:${profile.id}`,
        set: new SubscriptionSet(client, BASE_SUBSCRIPTION_ID + 3, profilePaths(profile)),
        intervalMs: 0,
        reads: 0,
        handle: (values) => {
          const out: Record<string, CabValue> = {};
          for (const [key, spec] of fields) out[key] = cabValue(readField(values, spec));
          this.onUpdate({ cab: { profileId: profile.id, values: out } });
        },
      });
    } else {
      this.onUpdate({ cab: null });
    }
    return tiers;
  }
}
