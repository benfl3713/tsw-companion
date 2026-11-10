import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { RecordedFeature, ServerMessage, Telemetry } from "@tsw/shared";
import { WebSocketServer, WebSocket } from "ws";

export const DEFAULT_PORT = 31280;

/** Built web app (npm run build -w @tsw/web). */
export const WEB_DIST = resolve(fileURLToPath(new URL("../../web/dist", import.meta.url)));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

async function serveStatic(urlPath: string, res: ServerResponse) {
  const rel = normalize(decodeURIComponent(urlPath.split("?")[0] ?? "/")).replace(/^[\\/]+/, "");
  let file = join(WEB_DIST, rel || "index.html");
  if (!file.startsWith(WEB_DIST + sep) && file !== WEB_DIST) {
    res.writeHead(403).end();
    return;
  }
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    // Unknown paths fall back to the app shell.
    file = join(WEB_DIST, "index.html");
    try {
      body = await readFile(file);
    } catch {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("Web app not built yet. Run: npm run build -w @tsw/web");
      return;
    }
  }
  const hashed = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(body);
}

export function emptyTelemetry(): Telemetry {
  return {
    connection: { status: "waiting-for-game" },
    loco: null,
    drive: null,
    driverAid: null,
    position: null,
    track: null,
    world: null,
    cab: null,
    objective: null,
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
  /** Supplies recorded signals/limits for new clients. */
  recorded: () => RecordedFeature[] = () => [];

  constructor() {
    this.http = createServer((req, res) => {
      if (req.url === "/telemetry") {
        res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
        res.end(JSON.stringify(this.state));
        return;
      }
      void serveStatic(req.url ?? "/", res);
    });

    this.wss = new WebSocketServer({ server: this.http, path: "/ws" });
    this.wss.on("connection", (ws) => {
      this.send(ws, { type: "snapshot", seq: this.seq, t: Date.now(), data: this.state });
      this.send(ws, { type: "recorded", replace: true, features: this.recorded() });
    });
  }

  /** Sends newly recorded or updated features to every client. */
  broadcastRecorded(features: RecordedFeature[]) {
    const message = JSON.stringify({ type: "recorded", replace: false, features } satisfies ServerMessage);
    for (const ws of this.wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(message);
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
