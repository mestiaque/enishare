# Networking

## Interface detection

`src/server/network/interfaces.js` reads `os.networkInterfaces()` every 5 s. Node has no change event, so the module compares snapshots.

* Only IPv4 addresses are used. `127.*`, internal and link-local `169.254.*` addresses are dropped, and so are inactive adapters (`operstate=down` on Linux, `Status != Up` on Windows).
* Each adapter is classified using what the OS says about it, not just its address:
  * **Linux:** `/sys/class/net/<if>/wireless` (Wi-Fi), the `device/driver` link (`ipheth` = iPhone USB), and whether the device sits under `/devices/virtual/`.
  * **Windows:** `Get-NetAdapter` (description, `PhysicalMediaType`, `Virtual`), cached for 30 s.
  * Kinds: `wifi`, `ethernet`, `iphone-usb`, `virtual` (Docker, VirtualBox, VMware, Hyper-V, WSL, bridges, veth …), `vpn` (tun/tap/wg/Tailscale/ZeroTier/OpenVPN …), `other`.
* **Automatic choice order:** Wi-Fi → Ethernet → iPhone USB → other. Virtual adapters and VPNs are **never** picked automatically. A private address alone does not make an adapter "Wi-Fi".
* **Overrides:** pick an interface (Wi-Fi Sharing page), or set a manual IP (that disables automatic detection). If the chosen interface disappears, ENiShare falls back to automatic and shows a warning.
* **IP changes:** the QR code and URL update by themselves. Paired phones keep their session; they only need the new address (scan again).

## Listening

* Default: `0.0.0.0:8080` plus a private-address filter (see SECURITY.md). Wi-Fi and USB hotspot work at the same time, and a DHCP change does not restart the server.
* "Only the selected interface" (Settings) binds to that single IP and restarts the listener when the IP changes.
* Before listening, ENiShare probes the port. If it is busy, the error names the port and suggests the next free one.

## Why the phone sometimes cannot connect

| Cause | What to do |
|---|---|
| Different networks (guest Wi-Fi, 5 GHz/2.4 GHz split with isolation) | Put both devices on the same network |
| Router "AP / client isolation" | Turn it off, or use the iPhone hotspot |
| Windows network set to *Public* | Set it to *Private*, or allow ENiShare when Windows asks |
| UFW enabled on Ubuntu | `sudo ufw allow 8080/tcp` |
| VPN on the iPhone or PC | Turn it off while sharing |
| Wrong adapter (VirtualBox/Hyper-V address in the QR) | Choose the Wi-Fi adapter on the Wi-Fi Sharing page |

The **iPhone can't connect?** button runs real checks: address present, server listening, the PC reaching its own server on the LAN address, firewall/UFW/network profile, and free disk space.

## Ports used

| Port | What | When |
|---|---|---|
| 8080/TCP (configurable) | HTTP + WebSocket (Socket.IO) | While sharing |
| 445/TCP | OS SMB service | Only if you set up the optional SMB share |
