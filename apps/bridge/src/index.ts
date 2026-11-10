// Bridge entry point: streams TSW telemetry to companion clients over WebSocket.
//
//   npm start -- [--port 31280] [--key <key>] [--url http://localhost:31270] [--demo]

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import qrcode from "qrcode-terminal";
import type { Telemetry } from "@tsw/shared";
import { RouteRecorder } from "./route/recorder.js";
import { DEFAULT_BASE_URL } from "./tsw/client.js";
import { runDemo } from "./telemetry/demo.js";
import { TelemetryLoop } from "./telemetry/loop.js";
import { DEFAULT_PORT, lanAddresses, TelemetryServer, WEB_DIST } from "./server.js";

const { values: args } = parseArgs({
  options: {
    port: { type: "string", default: String(DEFAULT_PORT) },
    key: { type: "string" },
    url: { type: "string", default: DEFAULT_BASE_URL },
    demo: { type: "boolean", default: false },
    loco: { type: "string", default: "Class805" },
  },
});

const port = Number(args.port);
const server = new TelemetryServer();
await server.listen(port);

console.log(`TSW Companion bridge listening on port ${port}`);
const urls = lanAddresses().map((ip) => `http://${ip}:${port}/`);
for (const url of urls) console.log(`  ${url}`);
if (!existsSync(join(WEB_DIST, "index.html"))) {
  console.log("  (web app not built yet: npm run build -w @tsw/web)");
} else if (urls.length) {
  // Prefer a typical home-LAN address over virtual adapters (WSL, Hyper-V).
  const best = urls.find((u) => /\/\/192\.168\./.test(u)) ?? urls[0]!;
  console.log(`\nScan to open on your tablet (${best}):`);
  qrcode.generate(best, { small: true });
}

// Signals and limits learnt by driving. The demo keeps its own file so its
// made-up route never mixes with real recordings.
const recordFile = fileURLToPath(new URL(`../data/${args.demo ? "recorded-demo" : "recorded"}.json`, import.meta.url));
const recorder = new RouteRecorder(recordFile, (changed) => server.broadcastRecorded(changed));
server.recorded = () => recorder.all();
console.log(`\nRecorded signals and limits: ${recorder.all().length} (${recordFile})`);

const publish = (update: Partial<Telemetry>) => {
  server.update(update);
  recorder.observe(update);
};

const shutdown = () => {
  loop?.stop();
  recorder.save();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

let loop: TelemetryLoop | undefined;
if (args.demo) {
  console.log("Demo mode: streaming a synthetic route, not the game.");
  runDemo(publish, args.loco);
} else {
  loop = new TelemetryLoop(publish, { key: args.key, baseUrl: args.url });
  await loop.run();
}
