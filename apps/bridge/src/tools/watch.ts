// Connects to a running bridge and prints a live one-line readout plus the
// rate of drive updates. Handy for checking latency without the web app.
//
//   npm run watch -- [ws://localhost:31280/ws]

import type { ServerMessage, Telemetry } from "@tsw/shared";
import { WebSocket } from "ws";
import { emptyTelemetry } from "../server.js";

const url = process.argv[2] ?? "ws://localhost:31280/ws";
const state: Telemetry = emptyTelemetry();
let driveUpdates = 0;
let rate = 0;

const ws = new WebSocket(url);
ws.on("open", () => console.log(`Connected to ${url}`));
ws.on("close", () => {
  console.log("\nBridge closed the connection.");
  process.exit(1);
});
ws.on("error", (err) => console.error(`Cannot connect to ${url}: ${err.message}`));
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString()) as ServerMessage;
  Object.assign(state, msg.data);
  if (msg.type === "update" && msg.data.drive) driveUpdates++;
});

setInterval(() => {
  rate = driveUpdates;
  driveUpdates = 0;
}, 1000);

const kmh = (ms: number | null | undefined) => (ms == null ? "--" : (ms * 3.6).toFixed(1));

setInterval(() => {
  const d = state.drive;
  const aid = state.driverAid;
  const sig = aid?.signals[0];
  const lim = aid?.limits[0];
  const line = [
    `[${state.connection.status}]`,
    state.loco?.objectClass ?? "-",
    `${kmh(d?.speed)} km/h`,
    `limit ${kmh(aid?.speedLimit)}`,
    lim ? `next ${kmh(lim.limit)} in ${lim.distance.toFixed(0)} m` : "",
    sig ? `signal ${sig.aspect} in ${sig.distance.toFixed(0)} m` : "",
    `${rate} Hz`,
  ]
    .filter(Boolean)
    .join("  ");
  process.stdout.write(`\r${line.padEnd(140)}`);
}, 100);
