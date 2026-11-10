import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TswGetResponse, TswInfo, TswListResponse, TswSubscriptionRead } from "@tsw/shared";

export const DEFAULT_BASE_URL = "http://localhost:31270";

/** Newest first, so a TSW7 key wins over a stale TSW6 one. */
const GAME_FOLDERS = ["TrainSimWorld7", "TrainSimWorld6", "TrainSimWorld5"];

export interface KeyLocation {
  key: string;
  source: string;
}

/**
 * Finds the API key. The game writes CommAPIKey.txt only after it has been
 * started with the -HTTPAPI launch option.
 */
export function findApiKey(explicit?: string): KeyLocation | undefined {
  if (explicit) return { key: explicit.trim(), source: "--key" };
  if (process.env.TSW_API_KEY) return { key: process.env.TSW_API_KEY.trim(), source: "TSW_API_KEY" };

  // OneDrive can redirect Documents, so check both.
  const documentsDirs = [join(homedir(), "Documents"), join(homedir(), "OneDrive", "Documents")];
  for (const docs of documentsDirs) {
    for (const game of GAME_FOLDERS) {
      const file = join(docs, "My Games", game, "Saved", "Config", "CommAPIKey.txt");
      if (existsSync(file)) {
        const key = readFileSync(file, "utf8").trim();
        if (key) return { key, source: file };
      }
    }
  }
  return undefined;
}

export class TswApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
  }
}

/** Keeps '/' separators but escapes anything else odd inside a segment. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export class TswClient {
  constructor(
    private readonly apiKey: string,
    readonly baseUrl = DEFAULT_BASE_URL,
    private readonly timeoutMs = 2000,
  ) {}

  /** Raw request returning parsed JSON. Node's fetch keeps connections alive by default. */
  async request<T>(method: string, pathAndQuery: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${pathAndQuery}`, {
        method,
        headers: { DTGCommKey: this.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new TswApiError(`Cannot reach TSW API at ${this.baseUrl} (${(err as Error).message})`);
    }
    const text = await res.text();
    if (!res.ok) throw new TswApiError(`${method} ${pathAndQuery} -> HTTP ${res.status}`, res.status, text);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new TswApiError(`${method} ${pathAndQuery} returned non-JSON`, res.status, text);
    }
  }

  info(): Promise<TswInfo> {
    return this.request("GET", "/info");
  }

  list(path = ""): Promise<TswListResponse> {
    return this.request("GET", path ? `/list/${encodePath(path)}` : "/list");
  }

  get<T = Record<string, unknown>>(path: string): Promise<TswGetResponse<T>> {
    return this.request("GET", `/get/${encodePath(path)}`);
  }

  set(path: string, value: string | number | boolean): Promise<unknown> {
    return this.request("PATCH", `/set/${encodePath(path)}?Value=${encodeURIComponent(String(value))}`);
  }

  // Subscriptions bundle many paths into one read (confirmed working on TSW7).
  subscribe(path: string, id: number): Promise<unknown> {
    return this.request("POST", `/subscription/${encodePath(path)}?Subscription=${id}`);
  }

  readSubscription(id: number): Promise<TswSubscriptionRead> {
    return this.request("GET", `/subscription?Subscription=${id}`);
  }

  unsubscribe(id: number): Promise<unknown> {
    return this.request("DELETE", `/subscription?Subscription=${id}`);
  }

  listSubscriptions(): Promise<unknown> {
    return this.request("GET", "/listsubscriptions");
  }
}
