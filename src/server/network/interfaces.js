// Network interface discovery and classification.
// A private IPv4 address alone does not mean "Wi-Fi": we look at the OS's own
// description of each adapter (sysfs on Linux, Get-NetAdapter on Windows).
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const VIRTUAL_RE = /^(docker|br-|veth|virbr|vmnet|vboxnet|lxcbr|lxdbr|cni|flannel|kube|podman|vnet|zt)|vethernet|virtualbox|vmware|hyper-v|wsl|loopback|npcap|bluetooth/i;
const VPN_RE = /^(tun|tap|wg|tailscale|utun|ppp|ipsec|nordlynx|proton|mullvad)|tap-windows|wireguard|openvpn|vpn|fortinet|cisco anyconnect|pangp|zerotier|tailscale/i;
const WIFI_NAME_RE = /^(wl|wlan|wifi|ath|ra\d)|wi-?fi|wireless|wlan|802\.11/i;
const ETH_NAME_RE = /^(en|eth|em|eno|ens|enp|enx)|ethernet|gbe|realtek|intel.*connection/i;
const IPHONE_DESC_RE = /apple mobile device ethernet|iphone|ipheth/i;

const KIND_PRIORITY = { wifi: 1, ethernet: 2, 'iphone-usb': 3, other: 4, vpn: 8, virtual: 9 };
const KIND_LABEL = {
  wifi: 'Wi-Fi', ethernet: 'Ethernet', 'iphone-usb': 'iPhone USB (Personal Hotspot)',
  other: 'Network', vpn: 'VPN', virtual: 'Virtual adapter',
};

let windowsAdapterCache = { at: 0, map: new Map() };

/** Linux: details from /sys/class/net/<if>. Pure reads, no root needed. */
function linuxInfo(name) {
  const base = path.join('/sys/class/net', name);
  const info = { wireless: false, driver: '', operstate: '' };
  try { info.wireless = fs.existsSync(path.join(base, 'wireless')) || fs.existsSync(path.join(base, 'phy80211')); } catch { /* */ }
  try { info.driver = path.basename(fs.readlinkSync(path.join(base, 'device', 'driver'))); } catch { /* virtual devices have no driver link */ }
  try { info.operstate = fs.readFileSync(path.join(base, 'operstate'), 'utf8').trim(); } catch { /* */ }
  try { info.isVirtualDevice = fs.realpathSync(base).includes('/devices/virtual/'); } catch { info.isVirtualDevice = false; }
  return info;
}

/** Windows: adapter descriptions via PowerShell, cached for 30 s (the call takes ~0.5 s). */
export function refreshWindowsAdapters() {
  if (process.platform !== 'win32') return Promise.resolve(new Map());
  if (Date.now() - windowsAdapterCache.at < 30_000) return Promise.resolve(windowsAdapterCache.map);
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-NetAdapter | Select-Object Name,InterfaceDescription,Status,MediaType,PhysicalMediaType,Virtual | ConvertTo-Json -Compress'],
    { timeout: 8000, windowsHide: true }, (err, stdout) => {
      const map = new Map();
      if (!err && stdout.trim()) {
        try {
          const arr = [].concat(JSON.parse(stdout));
          for (const a of arr) map.set(a.Name, a);
        } catch { /* keep empty */ }
      }
      windowsAdapterCache = { at: Date.now(), map };
      resolve(map);
    });
  });
}

/**
 * Classifies one interface. Exported for unit tests.
 * @param {string} name OS interface name
 * @param {string} address IPv4 address
 * @param {{wireless?:boolean, driver?:string, description?:string, isVirtualDevice?:boolean, physicalMedia?:string, virtual?:boolean}} info
 */
export function classifyInterface(name, address, info = {}) {
  const desc = `${name} ${info.description || ''} ${info.driver || ''}`;
  if (info.driver === 'ipheth' || IPHONE_DESC_RE.test(desc)) return 'iphone-usb';
  if (VPN_RE.test(name) || VPN_RE.test(info.description || '')) return 'vpn';
  if (info.virtual === true || VIRTUAL_RE.test(name) || VIRTUAL_RE.test(info.description || '')) return 'virtual';
  if (process.platform === 'linux' && info.isVirtualDevice && !info.wireless) return 'virtual';
  if (info.wireless || /802\.11|wireless|native 802/i.test(info.physicalMedia || '') || WIFI_NAME_RE.test(name)) return 'wifi';
  if (/802\.3/i.test(info.physicalMedia || '') || ETH_NAME_RE.test(name)) return 'ethernet';
  // iPhone hotspot subnet without a recognised driver (e.g. unusual driver names)
  if (address.startsWith('172.20.10.')) return 'iphone-usb';
  return 'other';
}

export function isPrivateIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 127);
}

/** Returns usable IPv4 interfaces, best candidate first. */
export async function listInterfaces() {
  const winAdapters = await refreshWindowsAdapters();
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('127.') || a.address.startsWith('169.254.')) continue;
      let info = {};
      if (process.platform === 'linux') {
        info = linuxInfo(name);
        if (info.operstate === 'down') continue; // inactive
      } else if (process.platform === 'win32') {
        const w = winAdapters.get(name);
        if (w) {
          if (w.Status && w.Status !== 'Up') continue;
          info = { description: w.InterfaceDescription, physicalMedia: w.PhysicalMediaType, virtual: w.Virtual };
        }
      }
      const kind = classifyInterface(name, a.address, info);
      out.push({
        name,
        address: a.address,
        netmask: a.netmask,
        mac: a.mac,
        kind,
        label: KIND_LABEL[kind],
        description: info.description || info.driver || '',
        private: isPrivateIPv4(a.address),
      });
    }
  }
  out.sort((x, y) => (KIND_PRIORITY[x.kind] - KIND_PRIORITY[y.kind]) || x.name.localeCompare(y.name));
  return out;
}

/**
 * Picks the address shown in the QR code.
 * Virtual adapters and VPNs are never chosen automatically.
 */
export function chooseAddress(interfaces, settings) {
  if (!settings.autoDetectIp && settings.manualIp) {
    const found = interfaces.find((i) => i.address === settings.manualIp);
    return { address: settings.manualIp, iface: found ?? null, source: 'manual', warning: found ? null : 'MANUAL_IP_NOT_FOUND' };
  }
  if (settings.interfaceName) {
    const found = interfaces.find((i) => i.name === settings.interfaceName);
    if (found) return { address: found.address, iface: found, source: 'selected', warning: null };
  }
  const auto = interfaces.find((i) => !['virtual', 'vpn'].includes(i.kind));
  if (auto) {
    return { address: auto.address, iface: auto, source: 'auto', warning: settings.interfaceName ? 'SELECTED_INTERFACE_GONE' : null };
  }
  return { address: null, iface: null, source: 'none', warning: interfaces.length ? 'ONLY_VIRTUAL' : 'NO_NETWORK' };
}
