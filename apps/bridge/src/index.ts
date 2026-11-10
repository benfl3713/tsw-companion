// Bridge entry point: streams TSW telemetry to companion clients over WebSocket.
//
//   npm start -- [--port 31280] [--key <key>] [--url http://localhost:31270]

import { parseArgs } from "node:util";
import { DEFAULT_BASE_URL } from "./tsw/client.js";
import { TelemetryLoop } from "./telemetry/loop.js";
import { DEFAULT_PORT, lanAddresses, TelemetryServer } from "./server.js";

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
for (const ip of lanAddresses()) console.log(`  ws://${ip}:${port}/ws   (http://${ip}:${port}/telemetry)`);

const loop = new TelemetryLoop((update) => server.update(update), { key: args.key, baseUrl: args.url });

const shutdown = () => {
  loop.stop();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await loop.run();
