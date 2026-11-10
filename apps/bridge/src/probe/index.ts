// Phase 1 probe: checks the TSW API is reachable, dumps what it exposes for
// the current loco, tests subscriptions, and measures how fast we can read.
//
//   npm run probe -- [--key <key>] [--url http://localhost:31270] [--depth 3] [--seconds 5] [--no-list]

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_BASE_URL, findApiKey, TswApiError, TswClient } from "../tsw/client.js";
import { crawl, flatten } from "../tsw/discovery.js";

const { values: args } = parseArgs({
  options: {
    key: { type: "string" },
    url: { type: "string", default: DEFAULT_BASE_URL },
    depth: { type: "string", default: "3" },
    seconds: { type: "string", default: "5" },
    "no-list": { type: "boolean", default: false },
  },
});

// Paths the companion will rely on. Each is fetched once and saved raw.
const KEY_PATHS = [
  "CurrentDrivableActor.Function.HUD_GetSpeed",
  "CurrentDrivableActor.Function.HUD_GetAcceleration",
  "CurrentDrivableActor.ObjectClass",
  "DriverAid.Data",
  "DriverAid.PlayerInfo",
  "DriverAid.TrackData",
  "TimeOfDay.Data",
  "WeatherManager.Data",
  "CurrentFormation.FormationLength",
];

// The fast-tier set we'd like to read in one go.
const FAST_PATHS = ["CurrentDrivableActor.Function.HUD_GetSpeed", "DriverAid.Data", "DriverAid.PlayerInfo"];

const SUBSCRIPTION_ID = 4242;

const ok = (msg: string) => console.log(`  ✔ ${msg}`);
const warn = (msg: string) => console.log(`  ⚠ ${msg}`);
const fail = (msg: string) => console.log(`  ✘ ${msg}`);
const section = (title: string) => console.log(`\n== ${title} ==`);

async function benchmark(label: string, seconds: number, op: () => Promise<unknown>, concurrency = 1) {
  const latencies: number[] = [];
  let errors = 0;
  const end = performance.now() + seconds * 1000;
  const worker = async () => {
    while (performance.now() < end) {
      const t = performance.now();
      try {
        await op();
        latencies.push(performance.now() - t);
      } catch {
        errors++;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  latencies.sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? NaN;
  const result = {
    label,
    concurrency,
    requests: latencies.length,
    errors,
    hz: +(latencies.length / seconds).toFixed(1),
    p50ms: +pct(0.5).toFixed(2),
    p95ms: +pct(0.95).toFixed(2),
    maxms: +(latencies.at(-1) ?? NaN).toFixed(2),
  };
  console.log(
    `  ${label.padEnd(38)} ${String(result.hz).padStart(7)} Hz   p50 ${result.p50ms} ms   p95 ${result.p95ms} ms   errors ${errors}`,
  );
  return result;
}

async function main() {
  const seconds = Number(args.seconds);
  const report: Record<string, unknown> = { startedAt: new Date().toISOString() };

  section("API key");
  const found = findApiKey(args.key);
  if (!found) {
    fail("No CommAPIKey.txt found.");
    console.log(
      "    In Steam: Train Sim World 7 > Properties > Launch Options, add  -HTTPAPI\n" +
        "    then start the game once. The key appears in\n" +
        "    Documents\\My Games\\TrainSimWorld7\\Saved\\Config\\CommAPIKey.txt",
    );
    process.exitCode = 1;
    return;
  }
  ok(`Using key from ${found.source}`);
  const client = new TswClient(found.key, args.url);

  section("Connection");
  try {
    const info = await client.info();
    report.info = info;
    ok(`${info.Meta.GameName} build ${info.Meta.GameBuildNumber}, API v${info.Meta.APIVersion}`);
    console.log(`    routes: ${info.HttpRoutes.map((r) => `${r.Verb} ${r.Path}`).join(", ")}`);
  } catch (err) {
    const e = err as TswApiError;
    fail(e.message);
    if (e.status === 403 || e.status === 401) console.log("    The key was rejected. Restart the game to regenerate it, or pass --key.");
    else console.log("    Is the game running with -HTTPAPI? The API only listens while TSW is open.");
    process.exitCode = 1;
    return;
  }

  const outDir = resolve("dumps", report.startedAt!.toString().replace(/[:.]/g, "-"));
  mkdirSync(outDir, { recursive: true });

  section("Key paths");
  const samples: Record<string, unknown> = {};
  for (const path of KEY_PATHS) {
    try {
      const res = await client.get(path);
      samples[path] = res;
      if (res.Result === "Success") ok(path);
      else warn(`${path} -> Result: ${res.Result}`);
    } catch (err) {
      samples[path] = { error: (err as Error).message, body: (err as TswApiError).body };
      fail(`${path}: ${(err as Error).message}`);
    }
  }
  writeFileSync(join(outDir, "samples.json"), JSON.stringify(samples, null, 2));
  const objectClass = (samples["CurrentDrivableActor.ObjectClass"] as { Values?: Record<string, unknown> })?.Values;
  if (objectClass) console.log(`    current loco: ${JSON.stringify(objectClass)}`);
  else warn("No drivable actor. Load into a cab for the full picture, then re-run.");

  if (!args["no-list"]) {
    section(`Node tree (depth ${args.depth})`);
    const roots = await client.list().catch(() => undefined);
    writeFileSync(join(outDir, "list-root.json"), JSON.stringify(roots, null, 2));
    console.log(`    root nodes: ${(roots?.Nodes ?? []).map((n) => n.Name ?? n.NodeName).join(", ") || "(none)"}`);
    const tree = await crawl(client, "CurrentDrivableActor", Number(args.depth));
    writeFileSync(join(outDir, "current-drivable-actor.json"), JSON.stringify(tree, null, 2));
    const lines = flatten(tree);
    writeFileSync(join(outDir, "current-drivable-actor.txt"), lines.join("\n"));
    ok(`${lines.length} endpoints under CurrentDrivableActor`);
  }

  section("Subscriptions");
  let subscriptionWorks = false;
  try {
    await client.unsubscribe(SUBSCRIPTION_ID).catch(() => {});
    for (const path of FAST_PATHS) await client.subscribe(path, SUBSCRIPTION_ID);
    const first = await client.readSubscription(SUBSCRIPTION_ID);
    writeFileSync(join(outDir, "subscription-read.json"), JSON.stringify(first, null, 2));
    const entries = (first as { Entries?: unknown[] })?.Entries;
    const text = JSON.stringify(first);
    subscriptionWorks = Array.isArray(entries) ? entries.length > 0 : text.includes("Values");
    if (subscriptionWorks) ok(`Subscription returned data (${text.length} bytes)`);
    else warn(`Subscription read returned no values; raw saved to subscription-read.json`);
  } catch (err) {
    fail(`Subscription failed: ${(err as Error).message}`);
  }
  report.subscriptionWorks = subscriptionWorks;

  section(`Read rate (${seconds}s each)`);
  const bench = [];
  bench.push(await benchmark("GET speed, sequential", seconds, () => client.get(FAST_PATHS[0]!)));
  bench.push(await benchmark("GET DriverAid.Data, sequential", seconds, () => client.get("DriverAid.Data")));
  bench.push(
    await benchmark("GET fast set (3 paths in parallel)", seconds, () => Promise.all(FAST_PATHS.map((p) => client.get(p)))),
  );
  bench.push(await benchmark("GET speed, 4 in flight", seconds, () => client.get(FAST_PATHS[0]!), 4));
  if (subscriptionWorks) {
    bench.push(await benchmark("Subscription read (3 paths)", seconds, () => client.readSubscription(SUBSCRIPTION_ID)));
  }
  report.benchmarks = bench;
  await client.unsubscribe(SUBSCRIPTION_ID).catch(() => {});

  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  section("Done");
  console.log(`  Dumps written to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
