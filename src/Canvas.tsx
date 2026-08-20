import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge, useReactFlow, ReactFlowProvider,
  type Node, type Edge, type Connection, type NodeChange
} from '@xyflow/react';
import { defaultPortsFor } from './Palette';
import type { DeviceKind } from './types';
import { BUILT_IN_TEMPLATES, loadCustomTemplates, makeDeviceFromTemplate } from './templates';
import { promptText, confirmDialog } from './Modal';
import { inferLayer } from './layers';

import '@xyflow/react/dist/style.css';
import { useStore } from './store';
import { DeviceNode } from './DeviceNode';
import { GroupNode } from './GroupNode';
import { SwitchNode } from './SwitchNode';
import { PatchPanelNode } from './PatchPanelNode';
import { ServerNode } from './ServerNode';
import { PortEdge } from './PortEdge';
import { ModernDeviceNode } from './ModernDeviceNode';
import type { Device, Group } from './types';
import { resolveCollisions, growGroupToFitChildren, readSizeForKind } from './collide';
import { edgeRouter, buildObstacles } from './edgeRouter';
import { portSides, DYNAMIC_KINDS } from './portSides';
import { openPortPicker, buildPortOptions, type PortOption } from './PortPickerDialog';
import { alertDialog } from './Modal';

const nodeTypes: any = {
  device: DeviceNode,
  switchNode: SwitchNode,
  patchNode: PatchPanelNode,
  serverNode: ServerNode,
  group: GroupNode,
  // v0.41: reference-style redesign
  modernNode: ModernDeviceNode,
};

const edgeTypes: any = {
  portEdge: PortEdge,
};

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

function CanvasInner() {
  const doc = useStore(s => s.doc);
  // v0.41: reference redesign — switches the node component and endpoint folding.
  const viewMode = useStore(s => s.viewMode);
  const collapseEndpoints = useStore(s => s.collapseEndpoints);
  const select = useStore(s => s.select);
  const selectGroup = useStore(s => s.selectGroup);
  const setPosition = useStore(s => s.setPosition);
  const setGroupPosition = useStore(s => s.setGroupPosition);
  const addLinkStore = useStore(s => s.addLink);
  const addDevice = useStore(s => s.addDevice);
  const addGroup = useStore(s => s.addGroup);
  const removeLink = useStore(s => s.removeLink);
  const openContextMenu = useStore(s => s.openContextMenu);
  const selectedId = useStore(s => s.selectedDeviceId);
  const selectedGroupId = useStore(s => s.selectedGroupId);
  const highlightIds = useStore(s => s.highlightIds);
  const snapToGrid = useStore(s => s.snapToGrid);
  const showGrid = useStore(s => s.showGrid);
  const filters = useStore(s => s.filters);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();

  // ------- Filter helpers -------
  const isDeviceVisible = useMemo(() => {
    const links = doc.links;
    return (dev: Device) => {
      if (filters.hiddenKinds.has(dev.kind)) return false;
      // Hierarchy layer filter
      if (filters.hiddenLayers.size > 0) {
        if (filters.hiddenLayers.has(inferLayer(dev) as any)) return false;
      }
      if (filters.poeOnly && !dev.ports.some(p => p.poeActive)) return false;
      if (filters.tag) {
        const needle = filters.tag.toLowerCase();
        if (!dev.tags?.some(t => t.toLowerCase().includes(needle))) return false;
      }
      if (filters.vlan != null) {
        // A device is "in" the VLAN if any of its ports (access OR trunk) references it,
        // OR if any of its connecting links (access OR trunk) references it.
        const onPort = dev.ports.some(p =>
          p.vlan === filters.vlan || (p.vlans?.includes(filters.vlan!))
        );
        const onLink = links.some(l =>
          (l.vlan === filters.vlan || (l.vlans?.includes(filters.vlan!))) &&
          (l.fromDeviceId === dev.id || l.toDeviceId === dev.id)
        );
        if (!onPort && !onLink) return false;
      }
      return true;
    };
  }, [filters, doc.links]);

  // ------- Build nodes: groups first (React Flow requires parents before children) -------
  const initialNodes: Node[] = useMemo(() => {
    const groups = doc.groups || [];
    const childCounts = new Map<string, number>();
    doc.devices.forEach(d => {
      if (d.groupId) childCounts.set(d.groupId, (childCounts.get(d.groupId) || 0) + 1);
    });

    const groupNodes: Node[] = groups.map(g => ({
      id: g.id,
      type: 'group',
      position: { x: g.x, y: g.y },
      // parent chain for nested groups
      ...(g.parentId ? { parentId: g.parentId, extent: 'parent' as const } : {}),
      data: {
        label: g.name,
        subtitle: g.subtitle,
        color: g.color,
        collapsed: !!g.collapsed,
        childCount: childCounts.get(g.id) || 0,
        width: g.width,
        height: g.height,
      },
      style: { width: g.width, height: g.collapsed ? 44 : g.height },
      selectable: true,
      draggable: true,
    }));

    const collapsedIds = new Set(groups.filter(g => g.collapsed).map(g => g.id));

    // Which servers are currently expanded → their VMs will be rendered INSIDE the server card, not on canvas
    const expandedServerIds = new Set(
      doc.devices.filter(d => d.kind === 'server' && d.display === 'rack').map(d => d.id)
    );

    // v0.41: which endpoint kinds get hidden from the canvas when
    // collapseEndpoints is on (their info lives in the parent hub's chip list).
    const ENDPOINT_KINDS: DeviceKind[] = ['ap', 'camera', 'pc', 'pos', 'printer', 'lock'];
    const hideAsEndpoint = (d: Device): boolean => {
      if (viewMode !== 'modern' || !collapseEndpoints) return false;
      if (!ENDPOINT_KINDS.includes(d.kind)) return false;
      // Only hide when this endpoint IS actually connected to a switch/router —
      // orphan endpoints stay visible so the user can still see + wire them.
      return doc.links.some(l =>
        (l.fromDeviceId === d.id || l.toDeviceId === d.id) &&
        doc.devices.some(x =>
          (x.id === l.fromDeviceId || x.id === l.toDeviceId) &&
          x.id !== d.id &&
          (x.kind === 'switch' || x.kind === 'router')
        )
      );
    };

    const deviceNodes: Node[] = doc.devices
      .filter(d => !d.groupId || !collapsedIds.has(d.groupId))
      // Hide VMs whose host is expanded (they are shown inside the server card)
      .filter(d => !(d.kind === 'vm' && d.hostDeviceId && expandedServerIds.has(d.hostDeviceId)))
      // v0.41: hide endpoint devices when they're folded into a hub's chip list
      .filter(d => !hideAsEndpoint(d))
      // Layer filters
      .filter(isDeviceVisible)
      .map(d => {
        // v0.41: in modern viewMode ALL devices use the reference-style node.
        const type = viewMode === 'modern'
          ? 'modernNode'
          : (d.kind === 'switch' || d.kind === 'router' ? 'switchNode' :
             d.kind === 'patchpanel'                    ? 'patchNode'  :
             d.kind === 'server'                        ? 'serverNode' :
                                                          'device');
        return {
          id: d.id,
          type,
          position: { x: d.x, y: d.y },
          ...(d.groupId ? { parentId: d.groupId, extent: 'parent' as const } : {}),
          data: { device: d, highlighted: highlightIds.has(d.id) }
        };
      });

    return [...groupNodes, ...deviceNodes];
    // v0.41.1: doc.links is deliberately kept as a dep only when modern mode
    // + collapseEndpoints is active (that's the only path that needs it).
    // Otherwise we skip the dep so the node list doesn't churn on every
    // link add/remove/update — was causing full node remount storms.
  }, [doc.devices, doc.groups, highlightIds, isDeviceVisible, viewMode, collapseEndpoints,
      // Only depend on links when they actually influence node visibility.
      (viewMode === 'modern' && collapseEndpoints) ? doc.links : null]);

  const initialEdges: Edge[] = useMemo(() => {
    const collapsedIds = new Set((doc.groups || []).filter(g => g.collapsed).map(g => g.id));
    const deviceById = new Map(doc.devices.map(d => [d.id, d]));
    // when a device's group is collapsed, its node disappears; we redirect edges to the group node
    const resolve = (deviceId: string): string => {
      const dev = deviceById.get(deviceId);
      if (dev?.groupId && collapsedIds.has(dev.groupId)) return dev.groupId;
      return deviceId;
    };

    // v0.41: same "hide endpoints" heuristic as in initialNodes.
    const ENDPOINT_KINDS: DeviceKind[] = ['ap', 'camera', 'pc', 'pos', 'printer', 'lock'];
    const hideAsEndpoint = (d: Device | undefined): boolean => {
      if (!d) return false;
      if (viewMode !== 'modern' || !collapseEndpoints) return false;
      if (!ENDPOINT_KINDS.includes(d.kind)) return false;
      return doc.links.some(l =>
        (l.fromDeviceId === d.id || l.toDeviceId === d.id) &&
        doc.devices.some(x =>
          (x.id === l.fromDeviceId || x.id === l.toDeviceId) &&
          x.id !== d.id &&
          (x.kind === 'switch' || x.kind === 'router')
        )
      );
    };

    const visibleLinks = doc.links.filter(l => {
      // Cable-type filter
      const cable = l.cable || 'copper';
      if (filters.hiddenCables.has(cable)) return false;
      // Hide edges whose endpoint device is filtered out by the layer filter
      const srcD = deviceById.get(l.fromDeviceId);
      const tgtD = deviceById.get(l.toDeviceId);
      if (srcD && !isDeviceVisible(srcD)) return false;
      if (tgtD && !isDeviceVisible(tgtD)) return false;
      // v0.41: hide edges to endpoints that are folded into their hub.
      if (hideAsEndpoint(srcD) || hideAsEndpoint(tgtD)) return false;
      // VLAN filter on the link itself — the link carries the VLAN if
      // it's the access VLAN OR listed in trunk allowed vlans.
      if (filters.vlan != null) {
        const carries = l.vlan === filters.vlan || l.vlans?.includes(filters.vlan);
        if (!carries) return false;
      }
      return true;
    });

    // v0.23: bundle parallel cables. For each unordered pair (A, B) of devices
    // we count how many links connect them and assign each an offset index so
    // the cables spread out perpendicular to the line instead of overlapping.
    // Key uses resolved node ids (collapsed-groups aware) so a bundle of links
    // going into a collapsed group still fans out cleanly.
    const bundleGroups = new Map<string, string[]>();
    for (const l of visibleLinks) {
      const a = resolve(l.fromDeviceId);
      const b = resolve(l.toDeviceId);
      if (a === b) continue;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const arr = bundleGroups.get(key) || [];
      arr.push(l.id);
      bundleGroups.set(key, arr);
    }
    // Per-link parallel index (0-based) and bundle size
    const bundleIdx = new Map<string, { index: number; total: number }>();
    for (const [, ids] of bundleGroups) {
      // Preserve link order for stable offsets across renders
      ids.forEach((id, i) => bundleIdx.set(id, { index: i, total: ids.length }));
    }

    return visibleLinks
      .map(l => {
        const src = resolve(l.fromDeviceId);
        const tgt = resolve(l.toDeviceId);
        if (src === tgt) return null; // hide intra-collapsed-group edges

        // Attach to specific port handle if both endpoints are visible and the port exists
        const srcDev = deviceById.get(l.fromDeviceId);
        const tgtDev = deviceById.get(l.toDeviceId);
        const srcVisible = src === l.fromDeviceId; // not redirected to a collapsed group
        const tgtVisible = tgt === l.toDeviceId;
        // A device shows port handles when:
        //  - it's a switch/router (BOTH compact and rack — v0.31 fix: compact
        //    now exposes per-port handles distributed across all 4 edges), OR
        //  - it's a patch panel (both compact and expanded expose handles), OR
        //  - it's a normal device (AP/camera/PC/…): our new DeviceNode always draws port dots
        const srcExposesPorts = srcVisible && srcDev;
        const tgtExposesPorts = tgtVisible && tgtDev;

        const sourceHandle = srcExposesPorts && l.fromPortId && srcDev?.ports.some(p => p.id === l.fromPortId)
          ? l.fromPortId : undefined;
        const targetHandle = tgtExposesPorts && l.toPortId && tgtDev?.ports.some(p => p.id === l.toPortId)
          ? l.toPortId : undefined;

        // Distinguish inter-group backbone links from intra-group / local ones.
        const isInterGroup = !!(srcDev && tgtDev
          && (srcDev.groupId || tgtDev.groupId)
          && srcDev.groupId !== tgtDev.groupId);

        // Uplink detection: does either endpoint sit on a port flagged as uplink?
        // Also, direction — the "uplink" side is the destination (arrow points there).
        const srcPort = srcDev?.ports.find(p => p.id === l.fromPortId);
        const tgtPort = tgtDev?.ports.find(p => p.id === l.toPortId);
        const srcIsUplink = !!srcPort?.uplink;
        const tgtIsUplink = !!tgtPort?.uplink;
        const isUplink = srcIsUplink || tgtIsUplink || isInterGroup;
        // v0.18 — arrows removed; keep flags only for edge width/color hints.

        // v0.17: light-blue cables like the reference mockup.
        //   copper/normal → #93C5FD (soft blue)
        //   fiber/uplink  → #3B82F6 (bright blue) — the "backbone"
        //   wifi          → #F59E0B (amber, dashed)
        //   custom color from link wins over defaults
        const baseColor = l.color
          || (l.cable === 'wifi' ? '#F59E0B'
              : l.cable === 'fiber' || isInterGroup || isUplink ? '#2563EB'
              : '#60A5FA');
        // v0.22: inter-group / fiber cables get a bolder stroke + soft glow so
        // they read clearly across large gaps between groups.
        const baseWidth = l.cable === 'fiber' || isInterGroup ? 2.6 : 1.6;

        // Speed label — derived from the port speed on either end.
        // v0.42: expanded to cover full range 100Mbps..100Gbps.
        const speed = srcPort?.speed || tgtPort?.speed;
        const speedLabel =
          speed === '100G' ? '100 Gbps' :
          speed === '40G'  ? '40 Gbps' :
          speed === '25G'  ? '25 Gbps' :
          speed === '10G'  ? '10 Gbps' :
          speed === '2.5G' ? '2.5 Gbps' :
          speed === '1G'   ? '1 Gbps' :
          speed === '100M' ? '100 Mbps' :
          speed === '10M'  ? '10 Mbps' :
          undefined;

        // v0.42: per-speed color scheme for the metric badge — matches the
        // "Link Legend" widget in the top-left corner of the map.
        const speedColor =
          speed === '100G' ? '#7C3AED' :  // purple
          speed === '40G'  ? '#8B5CF6' :
          speed === '25G'  ? '#3B82F6' :
          speed === '10G'  ? '#2563EB' :  // blue
          speed === '2.5G' ? '#22C55E' :
          speed === '1G'   ? '#22C55E' :  // green
          speed === '100M' ? '#F59E0B' :  // amber
          speed === '10M'  ? '#EF4444' :  // red — too slow, alarming
          undefined;

        // v0.42: also thicken the line for higher speeds so bandwidth is
        // legible at a glance without reading the badge.
        const speedWidth =
          speed === '100G' ? 4 :
          speed === '40G' || speed === '25G' ? 3.2 :
          speed === '10G'  ? 2.8 :
          speed === '1G'   ? 2 :
          undefined;

        return {
          id: l.id,
          source: src,
          target: tgt,
          sourceHandle,
          targetHandle,
          type: 'portEdge',
          animated: l.cable === 'fiber',
          data: {
            sourcePort: l.fromPortId,
            targetPort: l.toPortId,
            cable:      l.cable,
            // Prefer explicit link label; otherwise show the speed derived from ports
            centerLabel: l.label || speedLabel,
            // v0.42: color the badge in the reference style palette
            centerBadgeColor: speedColor,
            isUplink,
            isInterGroup,
            vlan:  l.vlan,
            vlans: l.vlans,
            // v0.23: bundle info for parallel-cable offset
            bundleIndex: bundleIdx.get(l.id)?.index ?? 0,
            bundleTotal: bundleIdx.get(l.id)?.total ?? 1,
          },
          style: {
            // v0.42: speed-based color takes priority in modern view
            stroke: (viewMode === 'modern' && speedColor) ? speedColor : baseColor,
            strokeWidth: speedWidth != null ? speedWidth
                       : isInterGroup ? baseWidth + 0.5 : baseWidth,
            strokeDasharray: l.cable === 'wifi' ? '4 4' : undefined,
          },
        } as Edge;
      })
      .filter(Boolean) as Edge[];
   }, [doc.links, doc.devices, doc.groups, filters, isDeviceVisible, viewMode, collapseEndpoints]);

  // Additional "host" edges for VMs (skip VMs already rendered inside expanded server card)
  const hostEdges: Edge[] = useMemo(() => {
    const collapsedIds = new Set((doc.groups || []).filter(g => g.collapsed).map(g => g.id));
    const deviceById = new Map(doc.devices.map(d => [d.id, d]));
    const expandedServerIds = new Set(
      doc.devices.filter(d => d.kind === 'server' && d.display === 'rack').map(d => d.id)
    );
    return doc.devices
      .filter(d => d.kind === 'vm' && d.hostDeviceId)
      .filter(d => !expandedServerIds.has(d.hostDeviceId!))
      .map(vm => {
        const host = deviceById.get(vm.hostDeviceId!);
        if (!host) return null;
        const src = vm.groupId && collapsedIds.has(vm.groupId) ? vm.groupId : vm.id;
        const tgt = host.groupId && collapsedIds.has(host.groupId) ? host.groupId : host.id;
        if (src === tgt) return null;
        return {
          id: `host-${vm.id}`,
          source: src, target: tgt,
          type: 'straight',
          style: { stroke: '#a78bfa', strokeWidth: 1, strokeDasharray: '2 3', opacity: 0.6 },
          label: 'hosted on',
          labelStyle: { fill: '#a78bfa', fontSize: 9, fontStyle: 'italic' },
          labelBgStyle: { fill: '#FFFFFF', fillOpacity: 0.8 },
          labelBgPadding: [3, 1],
        } as Edge;
      })
      .filter(Boolean) as Edge[];
  }, [doc.devices, doc.groups]);

  const allEdges = useMemo(() => [...initialEdges, ...hostEdges], [initialEdges, hostEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(allEdges);

  useEffect(() => { setNodes(initialNodes); }, [initialNodes, setNodes]);
  useEffect(() => { setEdges(allEdges); }, [allEdges, setEdges]);

  // v0.33: feed obstacles to the edge router whenever devices/groups change.
  // The router debounces internally so this is cheap to run on every change.
  // We use `doc.devices` + `doc.groups` (the source of truth) rather than the
  // transient `nodes` state so we don't fight React Flow during drag.
  useEffect(() => {
    const obstacles = buildObstacles(doc.devices, doc.groups, readSizeForKind);
    edgeRouter.setObstacles(obstacles);
  }, [doc.devices, doc.groups]);

  // v0.34.1: wire the edge router's version bump into the zustand store so
  // PortEdge components can react via a normal selector (safer than per-
  // instance subscribe callbacks — those caused error #185 on bulk ops).
  useEffect(() => {
    edgeRouter.setVersionSink((v) => useStore.getState().bumpEdgeRouterVersion(v));
    return () => { edgeRouter.setVersionSink(() => {}); };
  }, []);

  // v0.34.2: external "clear selection" hook — MultiSelectBar (which lives
  // outside the ReactFlowProvider tree) fires this event when the user hits
  // ✕ or bulk-deletes. We deselect every node in React Flow's internal state
  // in ONE call, so React Flow's shallow diff sees a clean before/after
  // instead of a per-node ping-pong that used to blow up with #185.
  useEffect(() => {
    const onClear = () => {
      setNodes(prev => {
        // Only allocate a new array if something was actually selected.
        if (!prev.some(n => n.selected)) return prev;
        return prev.map(n => n.selected ? { ...n, selected: false } : n);
      });
    };
    window.addEventListener('netmap:clear-rf-selection', onClear);
    return () => window.removeEventListener('netmap:clear-rf-selection', onClear);
  }, [setNodes]);

  // v0.34: recompute dynamic port sides whenever devices/groups/links change.
  // Cheap (<1 ms for the Усадьба map). After the pure recompute we bump the
  // store version so SwitchNode/DeviceNode consumers rerender.
  useEffect(() => {
    portSides.recompute(doc.devices, doc.groups, doc.links, readSizeForKind, DYNAMIC_KINDS);
    useStore.getState().bumpPortSidesVersion(portSides.getVersion());
  }, [doc.devices, doc.groups, doc.links]);

  // v0.20: after autoLayout applies new positions, fit the view to the new schema
  useEffect(() => {
    const onLayout = () => {
      requestAnimationFrame(() => {
        try { rf.fitView({ padding: 0.15, duration: 400 }); }
        catch { /* rf may not be ready */ }
      });
    };
    window.addEventListener('netmap:layout-applied', onLayout);
    return () => window.removeEventListener('netmap:layout-applied', onLayout);
  }, [rf]);

  // v0.41.1: safety net for "empty canvas" bug — when the project is loaded
  // from SQLite/localStorage AFTER the initial mount, React Flow's `fitView`
  // prop doesn't re-fire and nodes may end up outside the visible viewport.
  // We listen for the hydration event AND run a bounding-box check: if all
  // visible nodes fit in a tiny box (< 300×300), we assume something is off
  // and forcibly fit-view. Also exposed as a manual event so the AppMenu
  // "Восстановить вид" button can trigger it.
  useEffect(() => {
    const doFitView = () => {
      // Multi-step because RF sometimes needs a couple of frames after data change.
      let tries = 0;
      const tick = () => {
        try {
          rf.fitView({ padding: 0.15, duration: 300, maxZoom: 1.5 });
        } catch { /* rf not ready */ }
        tries++;
        if (tries < 3) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    const onHydrated = () => {
      // Wait a bit so React Flow has ingested the new nodes.
      setTimeout(doFitView, 250);
    };
    const onFit = () => doFitView();
    window.addEventListener('netmap:hydrated', onHydrated);
    window.addEventListener('netmap:fit-view',  onFit);
    return () => {
      window.removeEventListener('netmap:hydrated', onHydrated);
      window.removeEventListener('netmap:fit-view',  onFit);
    };
  }, [rf]);

  // v0.41.1: extra guard — if the doc changed and all nodes suddenly fit in
  // a tiny region (bug symptoms in the report), auto-fitView. Debounced.
  useEffect(() => {
    if (!doc.devices.length) return;
    const t = setTimeout(() => {
      const xs = doc.devices.map(d => d.x || 0);
      const ys = doc.devices.map(d => d.y || 0);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      // Empty group at (0,0) or all collapsed into one point → force fit.
      if (w < 50 && h < 50 && doc.devices.length > 3) {
        // Don't relayout automatically (would nuke the user's positions),
        // just alert them in the notification centre so they know what to do.
        useStore.getState().pushAlert({
          severity: 'warn', origin: 'app',
          title: 'Устройства сжаты в одну точку',
          message: `Все ${doc.devices.length} устройств в области < 50 px. Нажмите ☰ AppMenu → Восстановить вид (F) или запустите Auto Layout.`,
        });
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [doc.devices]);

  // v0.23: pan/zoom to a specific device on demand (from global search results)
  useEffect(() => {
    const onFocus = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (!id) return;
      const dev = useStore.getState().doc.devices.find(d => d.id === id);
      if (!dev) return;
      const grp = dev.groupId
        ? useStore.getState().doc.groups?.find(g => g.id === dev.groupId)
        : null;
      const absX = dev.x + (grp?.x ?? 0);
      const absY = dev.y + (grp?.y ?? 0);
      requestAnimationFrame(() => {
        try {
          rf.setCenter(absX + 90, absY + 40, { zoom: 1.2, duration: 500 });
        } catch { /* rf may not be ready */ }
      });
    };
    window.addEventListener('netmap:focus-device', onFocus as EventListener);
    return () => window.removeEventListener('netmap:focus-device', onFocus as EventListener);
  }, [rf]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChange(changes);
    // v0.35.5: skip position commits whose value already matches the doc.
    // React Flow re-emits `position` changes whenever we push a fresh nodes
    // array from setNodes(initialNodes) — before this guard, that echoed
    // back into setPosition → new doc → new initialNodes → new position
    // change → infinite loop (blank scene + ResizeObserver spam).
    const doc = useStore.getState().doc;
    for (const c of changes) {
      if (c.type === 'position' && c.position && !c.dragging) {
        const n = nodes.find(x => x.id === c.id);
        if (!n) continue;
        if (n.type === 'group') {
          const g = (doc.groups || []).find(x => x.id === c.id);
          if (g && Math.abs(g.x - c.position.x) < 0.5 && Math.abs(g.y - c.position.y) < 0.5) continue;
          setGroupPosition(c.id, c.position.x, c.position.y);
        } else {
          const dev = doc.devices.find(x => x.id === c.id);
          if (dev && Math.abs(dev.x - c.position.x) < 0.5 && Math.abs(dev.y - c.position.y) < 0.5) continue;
          setPosition(c.id, c.position.x, c.position.y);
        }
      }
    }
  }, [nodes, onNodesChange, setPosition, setGroupPosition]);

  // Strip synthetic suffixes: "_left"/"_right" (fallback handles) and ":back" (patch panel rear)
  const cleanHandle = (h: string | null | undefined) =>
    !h || h.startsWith('_') ? undefined : h.replace(/:back$/, '');

  /**
   * Enforce: one cable per port.
   * A port is considered "occupied" if any existing link references (deviceId, portId).
   * Called live during a drag — React Flow disables the drop indicator when it returns false.
   * If either endpoint has no portId (compact-view edge to node body), we don't enforce.
   */
  const isValidConnection = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target) return false;
    if (conn.source === conn.target) return false;      // no self-loops
    const fromPortId = cleanHandle(conn.sourceHandle);
    const toPortId   = cleanHandle(conn.targetHandle);
    const links = useStore.getState().doc.links;
    if (fromPortId) {
      const occupied = links.some(l =>
        (l.fromDeviceId === conn.source && l.fromPortId === fromPortId) ||
        (l.toDeviceId   === conn.source && l.toPortId   === fromPortId));
      if (occupied) return false;
    }
    if (toPortId) {
      const occupied = links.some(l =>
        (l.fromDeviceId === conn.target && l.fromPortId === toPortId) ||
        (l.toDeviceId   === conn.target && l.toPortId   === toPortId));
      if (occupied) return false;
    }
    return true;
  }, []);

  const onConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target) return;
    // Double-check occupancy (isValidConnection should have already caught this,
    // but a drop can slip through if the port only became busy mid-drag).
    if (!isValidConnection(conn)) return;

    const id = `link-${Math.random().toString(36).slice(2,8)}`;
    const fromPortId = cleanHandle(conn.sourceHandle);
    const toPortId   = cleanHandle(conn.targetHandle);

    addLinkStore({
      id,
      fromDeviceId: conn.source, fromPortId,
      toDeviceId: conn.target,   toPortId,
      cable: 'copper'
    });
    setEdges(es => addEdge({ ...conn, id, type: 'portEdge', style: { stroke: '#eab308', strokeWidth: 1.5 } }, es));
  }, [addLinkStore, setEdges, isValidConnection]);

  const onEdgeDoubleClick = useCallback(async (_: any, edge: Edge) => {
    if (await confirmDialog('Удалить кабель?', undefined, { danger: true, okText: 'Удалить' }))
      removeLink(edge.id);
  }, [removeLink]);

  const selectEdge = useStore(s => s.selectEdge);
  const knifeMode  = useStore(s => s.knifeMode);
  const toggleKnife = useStore(s => s.toggleKnifeMode);
  const onEdgeClick = useCallback((_: any, edge: Edge) => {
    if (knifeMode) {
      // Knife mode: instantly cut
      removeLink(edge.id);
      return;
    }
    selectEdge(edge.id);
  }, [knifeMode, removeLink, selectEdge]);

  // ---------- v0.35.6: DROP-ON-DEVICE → port-picker → new link ----------
  //
  // Called from onNodeDragStop when the dropped card's centre lands inside
  // another device. We open a modal asking which ports to connect. If the
  // target has no ports (kinds like 'cloud') or no free ports (all occupied),
  // an alert explains why and no link is created. The dragged card is snapped
  // back to its previous position via a fresh setPosition so it doesn't stay
  // stacked on top of the target.
  const snapBackDevice = useCallback((dev: Device) => {
    // Simply committing dev.x / dev.y again fires our clean setPosition path.
    setPosition(dev.id, dev.x, dev.y, dev.groupId ?? null);
  }, [setPosition]);

  const handleDropOnDevice = useCallback(async (src: Device, tgt: Device) => {
    // Freeze the visual: snap the dropped card back to its previous place
    // BEFORE showing the modal, so the user sees the target is intact.
    snapBackDevice(src);

    const state = useStore.getState();
    const { links, devices } = state.doc;

    // v0.46: buildPortOptions attaches `usedBy` (peer device name, link id).
    // Occupied ports are no longer hard-blocked — the dialog offers a
    // «Заменить связь» button that removes the old link before creating new.
    const srcOptions: PortOption[] = buildPortOptions(src, links, devices);
    const tgtOptions: PortOption[] = buildPortOptions(tgt, links, devices);

    // Only hard-block when the device has ZERO ports (nothing to pick).
    if (srcOptions.length === 0 || tgtOptions.length === 0) {
      const which = srcOptions.length === 0 ? src.name : tgt.name;
      useStore.getState().pushAlert({
        severity: 'warn', origin: 'connect',
        title: 'Нельзя соединить',
        message: `У «${which}» нет портов. Добавьте порт через Inspector → Ports.`,
      });
      await alertDialog('Нельзя соединить',
        `У «${which}» нет портов. Добавьте порт через Inspector → Ports.`);
      return;
    }

    const picked = await openPortPicker(
      { device: src, options: srcOptions },
      { device: tgt, options: tgtOptions },
    );
    if (!picked) return;   // user cancelled

    // v0.46: if user picked occupied ports, remove the pre-existing links
    // FIRST. removeLink already snapshots history, so undo restores the
    // whole edit atomically (or we could add a bulk action later).
    const s = useStore.getState();
    for (const linkId of picked.replaceLinks || []) {
      s.removeLink(linkId);
    }

    const linkId = `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    addLinkStore({
      id: linkId,
      fromDeviceId: src.id, fromPortId: picked.sourcePortId,
      toDeviceId:   tgt.id, toPortId:   picked.targetPortId,
      cable: picked.cable,
    });

    const replacedNote = picked.replaceLinks && picked.replaceLinks.length
      ? ` (заменено связей: ${picked.replaceLinks.length})`
      : '';
    useStore.getState().pushAlert({
      severity: 'success', origin: 'connect',
      title: 'Кабель создан',
      message: `${src.name} · ${picked.sourcePortId.toUpperCase()}  →  ${tgt.name} · ${picked.targetPortId.toUpperCase()}${replacedNote}`,
      deviceId: src.id, deviceName: src.name,
    });
  }, [addLinkStore, snapBackDevice]);

  // ---------- Drop device into a group + collision resolution ----------
  //
  // Two responsibilities on drag-stop:
  //   1) Re-parent the device into whichever group its absolute center is inside.
  //   2) Push away any sibling devices that now overlap the dropped one (AABB collision),
  //      so cards never end up stacked as in v0.17.
  //
  // Works for ALL device node types (device / switchNode / patchNode / serverNode).
  const onNodeDragStop = useCallback((_e: any, node: Node) => {
    // Clear any drop-target highlight regardless of what we do next.
    document.querySelectorAll('.react-flow__node-group.netmap-drop-target')
      .forEach(el => el.classList.remove('netmap-drop-target'));
    document.querySelectorAll('.react-flow__node.netmap-connect-target')
      .forEach(el => el.classList.remove('netmap-connect-target'));
    // groups have their own logic — skip
    if (node.type === 'group') return;

    const groups = useStore.getState().doc.groups || [];
    const devices = useStore.getState().doc.devices;
    const dev = devices.find(d => d.id === node.id);
    if (!dev) return;

    // --- 1) Re-parenting (was broken for switch/patch/server before v0.19) ---
    const parent = dev.groupId ? groups.find(g => g.id === dev.groupId) : null;
    const absX = node.position.x + (parent?.x ?? 0);
    const absY = node.position.y + (parent?.y ?? 0);
    // Absolute rect of the dropped card (approximated from readSizeForKind).
    const droppedSize = readSizeForKind(dev);
    const cx = absX + droppedSize.w / 2;
    const cy = absY + droppedSize.h / 2;

    // v0.35.6: DROP-ON-DEVICE detection — if the dropped card's CENTRE lands
    // inside another device's rect, open the port-picker dialog to connect
    // them instead of re-parenting into a group. Ignore group parents that
    // the point also happens to fall into. If the target has no ports or
    // no free ports, show an alert and bail.
    const groupMap = new Map(groups.map(g => [g.id, g]));
    let targetDev: typeof devices[number] | null = null;
    for (const other of devices) {
      if (other.id === dev.id) continue;
      const par = other.groupId ? groupMap.get(other.groupId) : null;
      if (par?.collapsed) continue;
      const sz = readSizeForKind(other);
      const ox = other.x + (par?.x ?? 0);
      const oy = other.y + (par?.y ?? 0);
      if (cx >= ox && cx <= ox + sz.w && cy >= oy && cy <= oy + sz.h) {
        targetDev = other;
        break;
      }
    }
    if (targetDev) {
      // Detected a drop on another device. Handle async.
      handleDropOnDevice(dev, targetDev);
      return;
    }

    let target: typeof groups[number] | null = null;
    for (const g of groups) {
      if (g.collapsed) continue;
      if (g.id === dev.groupId) { target = g; continue; }
      if (absX >= g.x && absX <= g.x + g.width && absY >= g.y && absY <= g.y + g.height) {
        target = g;
      }
    }

    // v0.35.2: SAFETY — never let a re-parent produce out-of-bounds or NaN
    // coords. Previously a card dropped across a distant group border could
    // land at deeply negative in-group coords → React Flow's `extent:'parent'`
    // clamped it invisibly at (0,0) and it looked "deleted".
    let finalGroupId: string | null | undefined = dev.groupId;
    let finalRelX = node.position.x;
    let finalRelY = node.position.y;
    if (target?.id !== dev.groupId) {
      finalGroupId = target?.id ?? null;
      if (target) {
        finalRelX = absX - target.x;
        finalRelY = absY - target.y - 36 /* group header offset */;
      } else {
        finalRelX = absX;
        finalRelY = absY;
      }
      // Clamp: keep the card visibly inside the new parent (or on-canvas).
      if (!Number.isFinite(finalRelX)) finalRelX = target ? 20 : 0;
      if (!Number.isFinite(finalRelY)) finalRelY = target ? 52 : 0;
      if (target) {
        if (finalRelX < 8)  finalRelX = 20;
        if (finalRelY < 48) finalRelY = 52;
        // Never drop past the current group bounds — growGroupToFitChildren
        // below will still expand as needed, but at least the drop point
        // starts inside the visible area.
        if (finalRelX > (target.width  - 60)) finalRelX = target.width  - 60;
        if (finalRelY > (target.height - 40)) finalRelY = target.height - 40;
      }
      setPosition(dev.id, finalRelX, finalRelY, finalGroupId);
    } else {
      // Same group — still clamp negative in-group coords that the drag might
      // have produced (very fast drag into the header).
      const g = parent;
      if (g) {
        let clampedX = finalRelX, clampedY = finalRelY;
        if (!Number.isFinite(clampedX)) clampedX = 20;
        if (!Number.isFinite(clampedY)) clampedY = 52;
        if (clampedX < 8)  clampedX = 8;
        if (clampedY < 48) clampedY = 48;
        if (clampedX !== finalRelX || clampedY !== finalRelY) {
          setPosition(dev.id, clampedX, clampedY, dev.groupId);
          finalRelX = clampedX; finalRelY = clampedY;
        }
      }
    }

    // --- 2) Collision resolution: nudge overlapping siblings out of the way.
    // Build a fresh "virtual node" with the CLAMPED position we just committed
    // so resolveCollisions doesn't operate on stale drag-event coords. ---
    const virtNode = {
      ...node,
      position: { x: finalRelX, y: finalRelY },
    } as Node;
    resolveCollisions(virtNode, finalGroupId ?? null,
                      /* keep the just-dropped node still */ true);

    // --- 3) Auto-grow the target group if the drop pushed children past the edge ---
    growGroupToFitChildren(finalGroupId ?? null);
  }, [setPosition, handleDropOnDevice]);

  // v0.24/25: no collision resolution DURING drag (avoid jitter). Only used
  // to highlight the target group the dragged card is hovering over — the actual
  // re-parent + collision resolve happens on drag stop.
  const onNodeDrag = useCallback((_e: any, node: Node) => {
    if (node.type === 'group') return;
    const groups = useStore.getState().doc.groups || [];
    const devices = useStore.getState().doc.devices;
    const dev = devices.find(d => d.id === node.id);
    if (!dev) return;
    const parent = dev.groupId ? groups.find(g => g.id === dev.groupId) : null;
    const absX = node.position.x + (parent?.x ?? 0);
    const absY = node.position.y + (parent?.y ?? 0);
    // Find the group whose bounds contain the dragged centre (skip collapsed ones)
    let target: string | null = null;
    for (const g of groups) {
      if (g.collapsed) continue;
      if (absX >= g.x && absX <= g.x + g.width && absY >= g.y && absY <= g.y + g.height) {
        target = g.id;
      }
    }
    // Toggle the CSS class only when target changes — cheap DOM update
    document.querySelectorAll('.react-flow__node-group.netmap-drop-target')
      .forEach(el => el.classList.remove('netmap-drop-target'));
    if (target && target !== dev.groupId) {
      document.querySelector(`.react-flow__node-group[data-id="${target}"]`)
        ?.classList.add('netmap-drop-target');
    }

    // v0.35.6: also highlight the device we're about to CONNECT to. Uses the
    // same size-of-card logic as onNodeDragStop so the hint matches the drop
    // target exactly.
    const droppedSize = readSizeForKind(dev);
    const cx = absX + droppedSize.w / 2;
    const cy = absY + droppedSize.h / 2;
    document.querySelectorAll('.react-flow__node.netmap-connect-target')
      .forEach(el => el.classList.remove('netmap-connect-target'));
    for (const other of devices) {
      if (other.id === dev.id) continue;
      const par = other.groupId ? groups.find(g => g.id === other.groupId) : null;
      if (par?.collapsed) continue;
      const sz = readSizeForKind(other);
      const ox = other.x + (par?.x ?? 0);
      const oy = other.y + (par?.y ?? 0);
      if (cx >= ox && cx <= ox + sz.w && cy >= oy && cy <= oy + sz.h) {
        document.querySelector(`.react-flow__node[data-id="${other.id}"]`)
          ?.classList.add('netmap-connect-target');
        break;
      }
    }
  }, []);



  // -------- Keyboard shortcuts (Delete, Undo, Redo, Escape) --------
  const removeDevice = useStore(s => s.removeDevice);
  const removeGroup = useStore(s => s.removeGroup);
  const undo = useStore(s => s.undo);
  const redo = useStore(s => s.redo);
  const clearPath = useStore(s => s.clearPath);
  const multiSelectedIds = useStore(s => s.multiSelectedIds);

  const duplicateDevice = useStore(s => s.duplicateDevice);
  const addDeviceStore  = useStore(s => s.addDevice);
  const updateDevice    = useStore(s => s.updateDevice);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;

      // v0.41.1: F — Fit view (bring lost / off-screen nodes back)
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('netmap:fit-view'));
        return;
      }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault(); undo(); return;
      }
      if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) {
        e.preventDefault(); redo(); return;
      }

      // Copy: Ctrl+C — stash the selected device(s) into an internal clipboard
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const ids = multiSelectedIds.size > 0
          ? Array.from(multiSelectedIds)
          : (selectedId ? [selectedId] : []);
        if (ids.length === 0) return;
        const st = useStore.getState();
        const payload = ids
          .map(id => st.doc.devices.find(d => d.id === id))
          .filter(Boolean);
        (window as any).__netmapClipboard = JSON.parse(JSON.stringify(payload));
        e.preventDefault();
        return;
      }

      // Paste: Ctrl+V — create copies with fresh ids, offset by 40x40
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        const clip = (window as any).__netmapClipboard as any[] | undefined;
        if (!clip || clip.length === 0) return;
        e.preventDefault();
        const newIds: string[] = [];
        for (const src of clip) {
          const id = `${src.kind}-${Math.random().toString(36).slice(2, 7)}`;
          addDeviceStore({
            ...src,
            id,
            name: `${src.name} (копия)`,
            x: (src.x || 0) + 40,
            y: (src.y || 0) + 40,
            ports: (src.ports || []).map((p: any) => ({ ...p })),
          });
          newIds.push(id);
        }
        // Select last pasted for convenience
        if (newIds.length === 1) select(newIds[0]);
        else useStore.getState().setMultiSelection(newIds);
        return;
      }

      // Duplicate: Ctrl+D
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (selectedId) { e.preventDefault(); duplicateDevice(selectedId); }
        return;
      }

      // Rename: F2
      if (e.key === 'F2' && selectedId) {
        e.preventDefault();
        const dev = useStore.getState().doc.devices.find(d => d.id === selectedId);
        if (!dev) return;
        (async () => {
          const name = await promptText('Переименовать', dev.name);
          if (name && name.trim()) updateDevice(selectedId, { name: name.trim() });
        })();
        return;
      }

      // Knife mode toggle
      if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); toggleKnife(); return;
      }

      if (e.key === 'Escape') {
        clearPath();
        selectEdge(null);
        if (useStore.getState().knifeMode) toggleKnife();
        return;
      }

      // Delete selected edge
      if ((e.key === 'Delete' || e.key === 'Backspace')
          && useStore.getState().selectedEdgeId
          && !selectedId && multiSelectedIds.size < 2) {
        e.preventDefault();
        removeLink(useStore.getState().selectedEdgeId!);
        selectEdge(null);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (multiSelectedIds.size > 1) {
          e.preventDefault();
          const count = multiSelectedIds.size;
          const ids = Array.from(multiSelectedIds);
          (async () => {
            if (await confirmDialog(`Удалить ${count} устройств?`, 'Можно отменить через Ctrl+Z.', { danger: true, okText: 'Удалить' })) {
              ids.forEach(id => removeDevice(id));
            }
          })();
          return;
        }
        if (selectedId) { e.preventDefault(); removeDevice(selectedId); }
        else if (selectedGroupId) {
          e.preventDefault();
          const gid = selectedGroupId;
          (async () => {
            if (await confirmDialog('Удалить группу?', 'Устройства останутся на канвасе.', { danger: true, okText: 'Удалить группу' })) {
              removeGroup(gid, { deleteChildren: false });
            }
          })();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, selectedGroupId, multiSelectedIds, removeDevice, removeGroup, duplicateDevice, addDeviceStore, updateDevice, select, undo, redo, clearPath]);

  // -------- Drag&drop from Palette --------
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();

    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });

    // 1) Template drop takes priority
    const tplId = e.dataTransfer.getData('application/x-netmap-template');
    if (tplId) {
      const all = [...loadCustomTemplates(), ...BUILT_IN_TEMPLATES];
      const t = all.find(x => x.id === tplId);
      if (!t) return;
      const targetGroup = (doc.groups || []).find(g => !g.collapsed
        && pos.x >= g.x && pos.x <= g.x + g.width
        && pos.y >= g.y && pos.y <= g.y + g.height);
      const localPos = targetGroup
        ? { x: pos.x - targetGroup.x, y: pos.y - targetGroup.y - 36 }
        : pos;
      const dev = makeDeviceFromTemplate(t, localPos.x, localPos.y);
      if (targetGroup) dev.groupId = targetGroup.id;
      addDevice(dev);
      select(dev.id);
      return;
    }

    // 2) Plain kind drop
    const kindRaw = e.dataTransfer.getData('application/x-netmap-kind');
    if (!kindRaw) return;

    if (kindRaw === '__group__') {
      const id = `group-${Math.random().toString(36).slice(2, 7)}`;
      addGroup({
        id, name: 'Новая группа',
        x: pos.x - 100, y: pos.y - 50, width: 400, height: 280,
        color: '#0D9488', collapsed: false, parentId: null
      });
      selectGroup(id);
      return;
    }

    const kind = kindRaw as DeviceKind;
    const id = `${kind}-${Math.random().toString(36).slice(2, 7)}`;

    // If dropped inside an expanded group, snap into it
    const targetGroup = (doc.groups || []).find(g => !g.collapsed
      && pos.x >= g.x && pos.x <= g.x + g.width
      && pos.y >= g.y && pos.y <= g.y + g.height);

    const localPos = targetGroup
      ? { x: pos.x - targetGroup.x, y: pos.y - targetGroup.y - 36 }
      : pos;

    addDevice({
      id, name: `Новый ${kind}`,
      kind, x: localPos.x, y: localPos.y,
      ports: defaultPortsFor(kind),
      display: 'compact',
      ...(targetGroup ? { groupId: targetGroup.id } : {})
    });
    select(id);
  }, [rf, addDevice, addGroup, select, selectGroup, doc.groups]);

  // Path overlay & multi-select influence node rendering
  const pathIds = useStore(s => s.pathIds);
  const pathA = useStore(s => s.pathA);
  const pathB = useStore(s => s.pathB);
  const pathActive = !!(pathA && pathB && pathIds.size > 0);
  const hoveredId = useStore(s => s.hoveredDeviceId);
  const focusRelated = useStore(s => s.focusRelated);
  const links = useStore(s => s.doc.links);

  // "Focus related" set — devices whose cables should stay bright when a
  // device is being hovered/selected. The set includes the active devices
  // themselves and every direct neighbour connected via a link.
  const focusSet: Set<string> | null = useMemo(() => {
    if (!focusRelated) return null;
    // hover has priority over selection
    const base: string[] = hoveredId
      ? [hoveredId]
      : multiSelectedIds.size > 0
        ? Array.from(multiSelectedIds)
        : selectedId
          ? [selectedId]
          : [];
    if (base.length === 0) return null;
    const set = new Set(base);
    for (const l of links) {
      if (set.has(l.fromDeviceId)) set.add(l.toDeviceId);
      else if (set.has(l.toDeviceId)) set.add(l.fromDeviceId);
    }
    return set;
  }, [focusRelated, hoveredId, selectedId, multiSelectedIds, links]);

  // v0.34.2: DO NOT override `n.selected` for the multi-select case. React
  // Flow already tracks selection in its internal state via onNodesChange —
  // overriding it here every render was forcing React Flow to re-sync its
  // node list, which under a bulk-selection + programmatic clear (like the
  // ✕ button in MultiSelectBar) drove it into an infinite setNodes loop
  // (React error #185). Multi-selection styling comes from React Flow's
  // own `.selected` class (already added by the library).
  //
  // We DO still override for the single-select case (`selectedId` /
  // `selectedGroupId`) because those are programmatic — set by clicks on
  // the sidebar, the port matrix, search results etc. — and must sync into
  // React Flow's internal state.
  //
  // Style overrides (opacity for dim, filter for path endpoints) are kept
  // but produced from stable references when nothing changed for that node,
  // so React Flow's shallow-diff doesn't see churn.
  const displayedNodes = useMemo(() =>
    nodes.map(n => {
      const onPath  = pathActive && pathIds.has(n.id);
      const pathDim = pathActive && !onPath && n.type !== 'group';
      const focusDim = !!focusSet && n.type !== 'group' && !focusSet.has(n.id);
      const dimmed  = pathDim || focusDim;
      const isEndpoint = n.id === pathA || n.id === pathB;

      // Compute what selected SHOULD be from our programmatic sources only.
      // (Multi-select handled internally by React Flow — we don't touch it here.)
      const wantSelected =
        n.type === 'group' ? n.id === selectedGroupId
        : n.id === selectedId;

      // If nothing about this node needs to change, return the EXACT same
      // reference — React Flow's shallow diff sees no churn.
      const needsStyle = dimmed || isEndpoint;
      // Only override selection when it differs AND the node isn't already
      // selected internally (e.g. via multi-select) — avoids clobbering it.
      const needsSelected = wantSelected !== (n.selected ?? false) && !(!wantSelected && n.selected);

      if (!needsStyle && !needsSelected) return n;

      const next: Node = { ...n };
      if (needsSelected) next.selected = wantSelected;
      if (needsStyle) {
        next.style = {
          ...(n.style as any || {}),
          opacity: dimmed ? 0.25 : 1,
          filter: isEndpoint ? 'drop-shadow(0 0 8px #2563EB)' : undefined,
          transition: 'opacity 0.18s, filter 0.18s',
        };
      }
      return next;
    }),
  [nodes, selectedId, selectedGroupId, pathIds, pathActive, pathA, pathB, focusSet]);

  // Also style edges based on path
  const pathLinkIds = useStore(s => s.pathLinkIds);
  // v0.43.6: global "hide all edges" toggle from the FAB.
  const hideEdges = useStore(s => s.hideEdges);
  const displayedEdges = useMemo(() => {
    if (hideEdges) return [];   // just drop them from RF entirely
    return edges.map(e => {
      const onPath = pathActive && pathLinkIds.has(e.id);
      const dimmed = pathActive && !onPath;
      return {
        ...e,
        animated: onPath ? true : e.animated,
        style: {
          ...(e.style as any || {}),
          opacity: dimmed ? 0.15 : 1,
          strokeWidth: onPath ? 3.5 : ((e.style as any)?.strokeWidth || 1.5),
          stroke: onPath ? '#2563EB' : (e.style as any)?.stroke,
          transition: 'opacity 0.18s',
        },
      };
    });
  },
  [edges, pathLinkIds, pathActive, hideEdges]);

  return (
    <div ref={wrapperRef} onDragOver={onDragOver} onDrop={onDrop}
         style={{
           width: '100%', height: '100%',
           cursor: knifeMode ? 'crosshair' : undefined,
         }}>
    <ReactFlow
      snapToGrid={snapToGrid}
      snapGrid={[20, 20]}
      nodes={displayedNodes}
      edges={displayedEdges}
      onNodesChange={handleNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection as any}
      onEdgeDoubleClick={onEdgeDoubleClick}
      onEdgeClick={onEdgeClick}
      onNodeClick={(e, n) => {
        // Shift+click on a device sets/updates the traceroute endpoints (A first, then B)
        if (n.type !== 'group' && (e.shiftKey || e.altKey)) {
          const s = useStore.getState();
          if (!s.pathA || (s.pathA && s.pathB)) {
            // Start a new pair
            useStore.getState().clearPath();
            useStore.getState().setPathEndpoint('a', n.id);
          } else if (s.pathA === n.id) {
            useStore.getState().clearPath();
          } else {
            useStore.getState().setPathEndpoint('b', n.id);
          }
          return;
        }
        // v0.47 — plain click → select (store.select auto-opens right panel).
        // Double click → focus view (handled by node's own onDoubleClick).
        if (n.type === 'group') selectGroup(n.id); else select(n.id);
      }}
      onNodeDoubleClick={(e, n) => {
        // v0.47 — Canvas-level fallback: if a node type didn't declare its
        // own onDoubleClick, ReactFlow bubbles here. We open focus mode.
        if (n.type === 'group') return;
        // stopPropagation prevents the click event from also firing select.
        (e as any).stopPropagation?.();
        useStore.getState().focusDevice(n.id);
      }}
      onNodeContextMenu={(e, n) => {
        e.preventDefault();
        if (n.type === 'group') {
          selectGroup(n.id);
          openContextMenu({ x: e.clientX, y: e.clientY, target: { type: 'group', id: n.id } });
        } else {
          select(n.id);
          openContextMenu({ x: e.clientX, y: e.clientY, target: { type: 'device', id: n.id } });
        }
      }}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      onSelectionChange={({ nodes: selNodes }) => {
        // Only device-type nodes count as multi-selectable, and we treat "0 or 1 selected"
        // as "no multi-selection" — MultiSelectBar shows only when >= 2 are selected anyway.
        const deviceIds = selNodes.filter(n => n.type !== 'group').map(n => n.id);
        const ids = deviceIds.length >= 2 ? deviceIds : [];
        // Guard against React Flow echoing back our own selection state and triggering an infinite loop.
        const cur = useStore.getState().multiSelectedIds;
        if (ids.length === cur.size && ids.every(id => cur.has(id))) return;
        useStore.getState().setMultiSelection(ids);
      }}
      onPaneClick={() => {
        select(null); selectGroup(null); selectEdge(null);
        useStore.getState().setPortHighlight(null, null);
        useStore.getState().setHoveredDevice(null);
      }}
      onNodeMouseEnter={(_e, n) => {
        // Only devices (not groups) trigger the "focus related" dim effect.
        if (n.type !== 'group') useStore.getState().setHoveredDevice(n.id);
      }}
      onNodeMouseLeave={() => useStore.getState().setHoveredDevice(null)}
      selectionOnDrag
      panOnDrag={[1, 2]}
      selectionMode={'partial' as any}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      minZoom={0.1}
      maxZoom={2}
      colorMode="dark"
      proOptions={{ hideAttribution: true }}
    >
      {showGrid && <Background gap={20} size={1} color="#E5E7EB" />}
      <Controls style={{ background: '#F9FAFB', border: '1px solid #D1D5DB' }} />
      <MiniMap
        style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', cursor: 'crosshair' }}
        nodeColor={(n) => {
          if (n.type === 'group') return (n.data as any)?.color || '#0D9488';
          const kind = (n.data as any)?.device?.kind ?? (n.data as any)?.kind;
          return ({ router:'#60a5fa', switch:'#0D9488', patchpanel:'#c084fc',
                   ap:'#f59e0b', camera:'#f87171',
                   server:'#94a3b8', pc:'#a3a3a3', pos:'#f472b6', printer:'#d4d4d8',
                   lock:'#fbbf24', cloud:'#38bdf8' } as any)[kind] || '#6B7280';
        }}
        maskColor="rgba(0,0,0,0.5)"
        // v0.43.6: click any point in the minimap → viewport centres there.
        pannable
        zoomable
        onClick={(_e, coord) => {
          // Coord is in flow coordinates. setCenter animates smoothly.
          try { rf.setCenter(coord.x, coord.y, { duration: 400, zoom: rf.getZoom() }); }
          catch { /* rf may not be ready */ }
        }}
      />
    </ReactFlow>
    </div>
  );
}
