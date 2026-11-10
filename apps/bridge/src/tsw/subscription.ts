import type { TswClient } from "./client.js";

export type SubscriptionValues = Map<string, Record<string, unknown> | undefined>;

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
    const res = await this.client.readSubscription(this.id);
    const out: SubscriptionValues = new Map();
    for (const entry of res.Entries ?? []) out.set(entry.Path, entry.NodeValid ? entry.Values : undefined);
    return out;
  }

  dispose(): Promise<unknown> {
    return this.client.unsubscribe(this.id).catch(() => {});
  }
}
