/**
 * Cable-trace helper (v0.26).
 *
 * Given a starting (deviceId, portId), walks along the cable and — when the
 * cable lands on a patch panel — continues through it to the "paired" port on
 * the other side. Returns the ordered list of hops so the UI can highlight the
 * entire cable path, not just the immediate link.
 *
 * We treat patch panels as "transparent" nodes: the cable enters one port,
 * exits an adjacent port. Since our data model doesn't explicitly pair front
 * and back of a PP-port, we pair by convention: even-indexed port is paired
 * with the next odd-indexed one (port1↔port2, port3↔port4, …). If that
 * assumption doesn't hold for a specific PP, the user can still see the first
 * hop and continue tracing manually.
 */

import type { Device, Link, NetMapDoc } from './types';

export interface TraceHop {
  /** Device at THIS end of the hop */
  deviceId: string;
  /** Port on that device */
  portId: string;
  /** Link used to reach the NEXT hop (undefined for the last hop) */
  linkId?: string;
  /** True when this hop is a patch panel we walked through */
  transitPp?: boolean;
}

export interface TraceResult {
  /** Ordered chain of hops from origin to terminal endpoint */
  hops: TraceHop[];
  /** Every link id involved in the trace (for edge highlighting) */
  linkIds: Set<string>;
  /** Every "deviceId:portId" key involved (for port highlighting) */
  portKeys: Set<string>;
  /** True if the trace hit a loop or ran out of iterations */
  aborted?: boolean;
}

const MAX_HOPS = 12;

/**
 * Trace the cable starting at (deviceId, portId). Returns the full chain.
 * If the port is not connected, returns a single-hop result (just the origin).
 */
export function traceCable(doc: NetMapDoc, deviceId: string, portId: string): TraceResult {
  const devById = new Map(doc.devices.map(d => [d.id, d]));
  const hops: TraceHop[] = [];
  const linkIds = new Set<string>();
  const portKeys = new Set<string>();
  const visited = new Set<string>();  // guards against cycles

  let curDevId = deviceId;
  let curPortId = portId;

  for (let i = 0; i < MAX_HOPS; i++) {
    const key = `${curDevId}:${curPortId}`;
    if (visited.has(key)) {
      return { hops, linkIds, portKeys, aborted: true };
    }
    visited.add(key);
    portKeys.add(key);

    // Find the link on this port
    const link = findLinkOnPort(doc.links, curDevId, curPortId);
    if (!link) {
      hops.push({ deviceId: curDevId, portId: curPortId });
      return { hops, linkIds, portKeys };
    }
    linkIds.add(link.id);

    // Record current hop with outgoing link
    hops.push({ deviceId: curDevId, portId: curPortId, linkId: link.id });

    // Cross the cable to the other side
    const otherDevId = link.fromDeviceId === curDevId ? link.toDeviceId : link.fromDeviceId;
    const otherPortId = link.fromDeviceId === curDevId ? link.toPortId : link.fromPortId;
    if (!otherPortId) {
      // Link doesn't specify a port on the other end — terminal.
      hops.push({ deviceId: otherDevId, portId: '' });
      return { hops, linkIds, portKeys };
    }
    portKeys.add(`${otherDevId}:${otherPortId}`);

    const otherDev = devById.get(otherDevId);
    if (!otherDev) {
      hops.push({ deviceId: otherDevId, portId: otherPortId });
      return { hops, linkIds, portKeys };
    }

    // If we landed on a patch panel — try to continue through the paired port.
    if (otherDev.kind === 'patchpanel') {
      const paired = pairedPortId(otherDev, otherPortId);
      if (paired) {
        // Add the PP "transit" hop and continue from the paired port
        hops.push({ deviceId: otherDevId, portId: otherPortId, transitPp: true });
        curDevId = otherDevId;
        curPortId = paired;
        continue;
      }
    }

    // Terminal — not a patch panel or no pair. Add final hop and return.
    hops.push({ deviceId: otherDevId, portId: otherPortId });
    return { hops, linkIds, portKeys };
  }

  return { hops, linkIds, portKeys, aborted: true };
}

/**
 * For a patch panel port, guess the "back" side by pairing convention:
 *   port1 ↔ port2, port3 ↔ port4, …
 * Falls back to the numeric neighbour when the port id has a trailing number.
 */
function pairedPortId(pp: Device, portId: string): string | null {
  // Extract trailing number from port id, e.g. "port5" → 5
  const m = /^(\D*)(\d+)$/.exec(portId);
  if (!m) return null;
  const prefix = m[1];
  const num = parseInt(m[2], 10);
  const partnerNum = num % 2 === 1 ? num + 1 : num - 1;
  const candidate = `${prefix}${partnerNum}`;
  const has = pp.ports.some(p => p.id === candidate);
  return has ? candidate : null;
}

function findLinkOnPort(links: Link[], deviceId: string, portId: string): Link | null {
  for (const l of links) {
    if ((l.fromDeviceId === deviceId && l.fromPortId === portId) ||
        (l.toDeviceId === deviceId && l.toPortId === portId)) {
      return l;
    }
  }
  return null;
}
