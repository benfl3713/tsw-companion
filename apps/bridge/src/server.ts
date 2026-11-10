import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import type { ServerMessage, Telemetry } from "@tsw/shared";
import { WebSocketServer, WebSocket } from "ws";

export const DEFAULT_PORT = 31280;

export function emptyTelemetry(): Telemetry {
  return {
    connection: { status: "waiting-for-game" },
    loco: null,
    drive: null,
    driverAid: null,
    position: null,
    track: null,
    world: null,
  };
}

/**
 * Holds the latest telemetry and fans updates out to every connected client.
 * New clients get a full snapshot, then only the sections that change.
 */
export class TelemetryServer {
  readonly state = emptyTelemetry();
  private seq = 0;
  private readonly http: Server;
  private readonly wss: WebSocketServer;

  constructor() {
    this.http = createServer((req, res) => {
      if (req.url === "/telemetry") {
        res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
        res.end(JSON.stringify(this.state));
        return;
      }
      res.writeHead(404).end();
    });

    this.wss = new WebSocketServer({ server: this.http, path: "/ws" });
    this.wss.on("connection", (ws) => {
      this.send(ws, { type: "snapshot", seq: this.seq, t: Date.now(), data: this.state });
    });
  }

  update(partial: Partial<Telemetry>) {
    Object.assign(this.state, partial);
    const message = JSON.stringify({ type: "update", seq: ++this.seq, t: Date.now(), data: partial } satisfies ServerMessage);
    for (const ws of this.wss.clients) {
      // Skip clients that can't keep up rather than queueing stale frames.
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256 * 1024) ws.send(message);
    }
  }

  private send(ws: WebSocket, message: ServerMessage) {
    ws.send(JSON.stringify(message));
  }

  listen(port = DEFAULT_PORT): Promise<void> {
    return new Promise((resolve) => this.http.listen(port, "0.0.0.0", resolve));
  }

  close() {
    this.wss.close();
    this.http.close();
  }
}

/** LAN addresses so the tablet knows where to connect. */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a!.address);
}
