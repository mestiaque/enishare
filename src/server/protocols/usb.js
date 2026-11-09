// USB / cable detection.
//
// Facts this module is built on (see docs/USB-LIMITATIONS.md):
//  * Plugging in an iPhone does NOT create a network between PC and phone by itself.
//  * The only app-free way for iPhone Safari to reach the PC over the cable is
//    "Personal Hotspot over USB": the iPhone becomes a USB network adapter
//    (Linux driver `ipheth`, Windows "Apple Mobile Device Ethernet"), the PC gets an
//    address in 172.20.10.0/28, and Safari can open http://172.20.10.x:PORT.
//  * usbmuxd / iproxy forward PC → phone ports only; they cannot let Safari reach the PC.
// Every status reported here comes from a real check. Nothing is assumed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { powershell } from './exec.js';

function readTrim(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { return ''; }
}

function linuxAppleDevices() {
  const base = '/sys/bus/usb/devices';
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(base); } catch { return out; }
  for (const e of entries) {
    const dir = path.join(base, e);
    if (readTrim(path.join(dir, 'idVendor')) !== '05ac') continue;
    const product = readTrim(path.join(dir, 'product'));
    if (/iphone|ipad|ipod/i.test(product)) out.push({ name: product, id: `${readTrim(path.join(dir, 'idVendor'))}:${readTrim(path.join(dir, 'idProduct'))}` });
  }
  return out;
}

function linuxDriverAvailable() {
  if (fs.existsSync('/sys/module/ipheth')) return { available: true, loaded: true };
  const dir = path.join('/lib/modules', os.release(), 'kernel/drivers/net/usb');
  try {
    const found = fs.readdirSync(dir).some((f) => f.startsWith('ipheth.ko'));
    return { available: found, loaded: false };
  } catch {
    return { available: null, loaded: false }; // unknown (e.g. custom kernel layout)
  }
}

async function windowsInfo() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$apple = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\\VID_05AC*' -and $_.FriendlyName -match 'iPhone|iPad|Apple Mobile Device' } | Select-Object FriendlyName, Status, Class)
$net = @(Get-NetAdapter | Where-Object { $_.InterfaceDescription -like '*Apple Mobile Device Ethernet*' } | Select-Object Name, Status, InterfaceDescription)
$svc = @(Get-Service | Where-Object { $_.Name -like 'Apple Mobile Device*' } | Select-Object Name, Status)
[pscustomobject]@{ apple = $apple; net = $net; svc = $svc } | ConvertTo-Json -Depth 4 -Compress`;
  const r = await powershell(script, { timeout: 15_000 });
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.stdout);
    const arr = (x) => (x ? [].concat(x) : []);
    return { apple: arr(j.apple), net: arr(j.net), svc: arr(j.svc) };
  } catch { return null; }
}

/**
 * @param {Array} interfaces from listInterfaces()
 * @param {number} port HTTP port in use
 */
export async function detectUsb(interfaces, port) {
  const usbNets = interfaces.filter((i) => i.kind === 'iphone-usb');
  const urls = usbNets.map((i) => `http://${i.address}:${port}`);
  const base = { platform: process.platform, network: usbNets.map((i) => ({ name: i.name, address: i.address })), urls, checks: [] };

  if (process.platform === 'linux') {
    const devices = linuxAppleDevices();
    const driver = linuxDriverAvailable();
    const usbmuxd = fs.existsSync('/var/run/usbmuxd') || fs.existsSync('/run/usbmuxd');
    base.devices = devices;
    base.checks = [
      { id: 'device', label: 'iPhone connected by USB', ok: devices.length > 0, detail: devices.map((d) => d.name).join(', ') || 'No Apple device found on USB' },
      { id: 'driver', label: 'ipheth network driver', ok: driver.available === true, warn: driver.available === null, detail: driver.loaded ? 'Loaded' : driver.available ? 'Available (loads automatically)' : driver.available === null ? 'Could not check' : 'Not found in this kernel' },
      { id: 'usbmuxd', label: 'usbmuxd (pairing service)', ok: usbmuxd, detail: usbmuxd ? 'Running' : 'Not running — install with: sudo apt install usbmuxd' },
      { id: 'network', label: 'USB network from Personal Hotspot', ok: usbNets.length > 0, detail: usbNets.length ? usbNets.map((i) => `${i.name} ${i.address}`).join(', ') : 'No iPhone network interface' },
    ];
    base.state = usbNets.length ? 'ready' : devices.length ? (driver.available === false ? 'driver-missing' : 'device-no-network') : 'no-device';
    return base;
  }

  if (process.platform === 'win32') {
    const w = await windowsInfo();
    if (!w) {
      base.state = usbNets.length ? 'ready' : 'unknown';
      base.checks = [{ id: 'query', label: 'Windows device query', ok: false, detail: 'Could not query devices (PowerShell unavailable).' }];
      return base;
    }
    const driverInstalled = w.svc.length > 0 || w.net.length > 0;
    base.devices = w.apple.map((d) => ({ name: d.FriendlyName, status: d.Status }));
    base.checks = [
      { id: 'device', label: 'iPhone connected by USB', ok: w.apple.length > 0, detail: w.apple.map((d) => d.FriendlyName).join(', ') || 'No Apple device found on USB' },
      { id: 'driver', label: 'Apple Mobile Device driver', ok: driverInstalled, detail: driverInstalled ? 'Installed' : 'Install "Apple Devices" from the Microsoft Store (or iTunes)' },
      { id: 'network', label: 'USB network from Personal Hotspot', ok: usbNets.length > 0, detail: usbNets.length ? usbNets.map((i) => `${i.name} ${i.address}`).join(', ') : w.net.length ? `Adapter present: ${w.net.map((n) => `${n.Name} (${n.Status})`).join(', ')}` : 'No Apple Mobile Device Ethernet adapter' },
    ];
    base.state = usbNets.length ? 'ready' : w.apple.length ? (driverInstalled ? 'device-no-network' : 'driver-missing') : 'no-device';
    return base;
  }

  base.state = usbNets.length ? 'ready' : 'unsupported-platform';
  return base;
}
