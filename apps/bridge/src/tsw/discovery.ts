import type { TswClient } from "./client.js";

export interface DiscoveredNode {
  path: string;
  endpoints: { name: string; writable: boolean }[];
  children: DiscoveredNode[];
  error?: string;
}

/**
 * Walks /list from a starting node. Used to dump a loco's controls so its
 * cab-screen profile can be written by hand.
 */
export async function crawl(client: TswClient, path: string, maxDepth: number, depth = 0): Promise<DiscoveredNode> {
  const node: DiscoveredNode = { path, endpoints: [], children: [] };
  try {
    const res = await client.list(path);
    node.endpoints = (res.Endpoints ?? []).map((e) => ({ name: e.Name, writable: e.Writable }));
    if (depth < maxDepth) {
      for (const child of res.Nodes ?? []) {
        const name = child.Name ?? child.NodeName;
        if (!name) continue;
        const childPath = path ? `${path}/${name}` : name;
        node.children.push(await crawl(client, childPath, maxDepth, depth + 1));
      }
    }
  } catch (err) {
    node.error = (err as Error).message;
  }
  return node;
}

/** Flattens a crawl into readable "Node/Child.Endpoint" lines. */
export function flatten(node: DiscoveredNode, out: string[] = []): string[] {
  for (const e of node.endpoints) out.push(`${node.path}.${e.name}${e.writable ? "  [writable]" : ""}`);
  for (const child of node.children) flatten(child, out);
  return out;
}
