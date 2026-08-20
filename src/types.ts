export type DeviceKind =
  | 'router'
  | 'switch'
  | 'patchpanel'   // passive patch panel (documentation only)
  | 'ap'          // access point
  | 'camera'      // CCTV
  | 'server'      // physical server (Hyper-V, ESXi host, bare-metal)
  | 'vm'          // virtual machine running on a server (hostDeviceId required)
  | 'vps'         // rented VPS/VDS from a provider (lives "somewhere")
  | 'pc'
  | 'pos'         // terminal / kassa
  | 'printer'
  | 'lock'        // SALTO door lock
  | 'cloud';      // ISP / internet provider

export type PortType = 'RJ45' | 'SFP' | 'SFP+' | 'Combo' | 'WiFi' | 'Console';
export type PortStatus = 'up' | 'down' | 'disabled' | 'error';

/** v0.48 — explicit port VLAN mode (was implicit before, based on which
 *  fields were filled). Semantics:
 *    - 'access' : untagged single VLAN (Port.vlan). Port.vlans[] IGNORED.
 *    - 'trunk'  : multiple tagged VLANs (Port.vlans[]). Port.vlan =
 *                 native/untagged VLAN on the trunk (optional).
 *    - 'hybrid' : mix — access-like default (Port.vlan) plus tagged
 *                 allowed list (Port.vlans[]). Common on Cisco / HP.
 *  Missing = legacy behaviour (inferred from `vlans[].length > 0`).
 */
export type PortVlanMode = 'access' | 'trunk' | 'hybrid';

export interface Port {
  id: string;                // logical id, e.g. "eth1"
  label?: string;            // human label / what's connected
  type?: PortType;           // physical type
  speed?: '10M' | '100M' | '1G' | '2.5G' | '10G' | '25G' | '40G' | '100G' | 'PoE';
  poe?: boolean;             // port supports PoE
  poeActive?: boolean;       // PoE is currently supplying power
  status?: PortStatus;       // current link status
  uplink?: boolean;          // this port is an uplink (magenta/blue tint)
  vlanMode?: PortVlanMode;   // v0.48 — explicit; inferred if missing
  vlan?: number;             // access VLAN (untagged) / trunk native (PVID)
  vlans?: number[];          // trunk/hybrid: allowed tagged VLAN IDs
  notes?: string;
}

export interface Credential {
  username?: string;
  /** Legacy Bitwarden web-vault link (v0.3-v0.5) */
  bitwardenItemId?: string;
  bitwardenUrl?: string;
  /** New (v0.6): id of the item in our built-in encrypted vault */
  vaultItemId?: string;
  notes?: string;
}

export type NetworkLayer = 'core' | 'distribution' | 'access';

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  model?: string;
  vendor?: string;
  ip?: string;
  mac?: string;
  mgmtUrl?: string;          // http(s)://... to open in browser
  location?: string;
  ports: Port[];
  credential?: Credential;
  /** v0.38 — optional link to a vault item. Preferred over the embedded
   *  `credential` field. When both are present, credentialId takes priority. */
  credentialId?: string | null;
  tags?: string[];
  x: number;                 // canvas position (absolute if no group, else RELATIVE to parent group)
  y: number;
  groupId?: string | null;   // parent group id, if any
  /** For kind='vm': the physical host device id */
  hostDeviceId?: string | null;
  /** For kind='vm': vCPU / RAM / OS metadata */
  vmInfo?: { vcpu?: number; ramGb?: number; os?: string; storage?: string };
  /** v0.35: for kind='server' — physical host spec (CPU, RAM, OS, drives, software). */
  hostSpec?: {
    cpu?: string;         // e.g. "Xeon E-2288G 8c/16t 3.7GHz"
    ramGb?: number;
    os?: string;          // e.g. "Ubuntu Server 22.04", "Windows Server 2019", "Proxmox 8"
    osVersion?: string;
    disks?: Array<{ sizeGB: number; kind?: 'HDD' | 'SSD' | 'NVMe'; model?: string; role?: string }>;
    software?: string[];  // e.g. ["Docker 24", "PostgreSQL 15", "nginx", "MikroTik REST"]
    formFactor?: '1U' | '2U' | '4U' | 'Tower' | 'Mini';
  };
  /** v0.35: for kind='server' when it's a video recorder (DVR/NVR). Independent
   *  of hostSpec — a recorder may or may not run a general-purpose OS. */
  dvr?: {
    channels: number;                       // total camera channels supported
    activeChannels?: number;                // channels currently in use
    disks?: Array<{ sizeGB: number; kind?: 'HDD' | 'SSD'; model?: string }>;
    retentionDays?: number;
    resolution?: string;                    // e.g. "1080p", "4K"
    software?: string;                      // e.g. "TRASSIR", "Xeoma", "Hikvision iVMS"
  };
  /** v0.35: for kind='ap' — list of SSIDs this AP broadcasts. Rendered as chips
   *  on the compact card so техник видит зона покрытия/название сети сразу. */
  ssids?: Array<{ name: string; band?: '2.4GHz' | '5GHz' | '6GHz' | 'both'; hidden?: boolean; guest?: boolean }>;
  /** v0.35.5: for kind='camera' — the DVR/NVR device that records this camera.
   *  Purely informational — creates a dashed "recorded by" indicator on the
   *  camera card and lets the DVR list "attached cameras". Nothing on the
   *  wire uses this — cabling is still expressed via links. */
  attachedToRegistrarId?: string | null;
  /** v0.35.5: for kind='server' when device.dvr is set — the ordered list of
   *  camera device ids this DVR records. Kept in sync with each camera's
   *  attachedToRegistrarId on edits from either side. */
  cameraIds?: string[];
  /** v0.36.2: Wake-on-LAN broadcast IP override.
   *  If unset, WoL uses ALL local broadcast + 255.255.255.255. Set to
   *  a subnet broadcast (192.168.11.255) when target sits in a remote
   *  subnet that your router forwards directed-broadcasts for. */
  wolBroadcastIp?: string;
  /** 'compact' = icon+name only, 'rack'/'expanded' = full port view (any device kind supports both) */
  display?: 'compact' | 'rack';
  /**
   * Cisco three-tier hierarchical network model layer:
   *  core         — high-speed backbone (routers, aggregation switches with 10G+ uplinks)
   *  distribution — connects access to core, applies policies
   *  access       — end devices (PC, AP, cameras, phones, printers, etc.)
   * Omitted → auto-inferred from device kind.
   */
  layer?: NetworkLayer;
  /**
   * Runtime ping status (not persisted — refreshed by the monitor).
   * 'unknown' = never probed / no IP
   * 'up'      = last probe succeeded
   * 'down'    = last probe failed
   * 'checking'= probe in flight
   */
  liveStatus?: 'unknown' | 'up' | 'down' | 'checking';
  /** Last successful probe RTT in ms */
  lastRttMs?: number;
  /** Timestamp (ms) of last probe result */
  lastCheckedAt?: number;
}

export interface Link {
  id: string;
  fromDeviceId: string;
  fromPortId?: string;
  toDeviceId: string;
  toPortId?: string;
  cable?: 'copper' | 'fiber' | 'wifi';
  vlan?: number;             // native VLAN carried over the cable
  vlans?: number[];          // trunk: all VLANs allowed on this link
  color?: string;            // override edge color
  label?: string;
}

/**
 * A VLAN definition scoped to the current project (per-project model).
 * Referenced from Port.vlan / Port.vlans / Link.vlan / Link.vlans by numeric id.
 */
export interface Vlan {
  /** Stable identifier (uuid-like), used only for keying in UI lists */
  id: string;
  /** IEEE 802.1Q VLAN ID (1..4094), unique within a project */
  vlanId: number;
  /** Short display name, e.g. "CORPORATE", "GUEST", "IOT" */
  name: string;
  /** CIDR subnet, e.g. "192.168.10.0/24" */
  cidr?: string;
  /** Default gateway IP, e.g. "192.168.10.1" */
  gateway?: string;
  /** Badge/dot color — hex string like "#3B82F6" */
  color: string;
  /** Free-text description */
  description?: string;
}

export interface Group {
  id: string;
  name: string;
  /** Optional parent group id → allows nested containers */
  parentId?: string | null;
  /** Absolute canvas position (top-left) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Preset color; also used for the header/border tint */
  color?: string;
  collapsed?: boolean;
  /** Short label under the title, e.g. "Корпус · 23 устройства" */
  subtitle?: string;
}

export type StickyColor = 'yellow' | 'pink' | 'blue' | 'green';

export interface StickyNote {
  id: string;
  deviceId: string;
  text: string;
  color: StickyColor;
  rotation: number;
  createdAt: number;
  /** width/height in px — default 130x84 */
  width?: number;
  height?: number;
  /** User-adjusted offset (relative to the device's top-left). If undefined, use the
      default stack position based on note order. */
  offsetX?: number;
  offsetY?: number;
  /** If true — the sticky is collapsed into a small "rolled-up" scroll icon */
  collapsed?: boolean;
}

export interface NetMapDoc {
  /**
   * Schema version.
   *   2 — v0.9-v0.12 (devices/links/groups/stickies)
   *   3 — v0.13+ adds `vlans` field. Old v2 docs are migrated on load (vlans defaults to []).
   */
  version: 2 | 3;
  name: string;
  devices: Device[];
  links: Link[];
  groups: Group[];
  stickies?: StickyNote[];
  /** Project-scoped VLAN dictionary (added in schema v3). */
  vlans?: Vlan[];
}
