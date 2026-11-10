// Bridge entry point: streams TSW telemetry to companion clients over WebSocket.
//
//   npm start -- [--port 31280] [--key <key>] [--url http://localhost:31270]

import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import qrcode from "qrcode-terminal";
import { DEFAULT_BASE_URL } from "./tsw/client.js";
import { TelemetryLoop } from "./telemetry/loop.js";
import { DEFAULT_PORT, lanAddresses, TelemetryServer, WEB_DIST } from "./server.js";

const { values: args } = parseArgs({
  options: {
    port: { type: "string", default: String(DEFAULT_PORT) },
    key: { type: "string" },
    url: { type: "string", default: DEFAULT_BASE_URL },
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

const loop = new TelemetryLoop((update) => server.update(update), { key: args.key, baseUrl: args.url });

const shutdown = () => {
  loop.stop();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await loop.run();
