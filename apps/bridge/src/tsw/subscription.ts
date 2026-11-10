import type { TswSubscriptionRead } from "@tsw/shared";
import type { TswClient } from "./client.js";

export type SubscriptionValues = Map<string, Record<string, unknown> | undefined>;

/**
 * Keys a subscription read by path. The game echoes paths URL-encoded
 * ("MR%20%28AirPipe%29"), so decode them to match the paths we asked for.
 */
export function entriesByPath(res: TswSubscriptionRead): SubscriptionValues {
  const out: SubscriptionValues = new Map();
  for (const entry of res.Entries ?? []) {
    let path = entry.Path;
    try {
      path = decodeURIComponent(path);
    } catch {
      // Not valid percent-encoding; use as is.
    }
    out.set(path, entry.NodeValid ? entry.Values : undefined);
  }
  return out;
}

/**
 * One server-side subscription set: many paths read in a single request.
 * Each read costs one game tick (~33 ms) whatever its size.
 */
export class SubscriptionSet {
  constructor(
    private readonly client: TswClient,
    readonly id: number,
    readonly paths: readonly string[],
  ) {}

  /** Clears any leftover set with this id, then adds every path. */
  async create(): Promise<void> {
    await this.client.unsubscribe(this.id).catch(() => {});
    for (const path of this.paths) {
      // A path the current loco lacks may be rejected; it just reads as missing.
      await this.client.subscribe(path, this.id).catch(() => {});
    }
  }

  /** Path -> Values. Paths with NodeValid=false map to undefined. */
  async read(): Promise<SubscriptionValues> {
    return entriesByPath(await this.client.readSubscription(this.id));
  }

  dispose(): Promise<unknown> {
    return this.client.unsubscribe(this.id).catch(() => {});
  }
}
