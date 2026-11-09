# USB / cable: what works and what doesn't

## Summary

* **Works (Experimental):** the iPhone's **Personal Hotspot over USB**. The iPhone becomes a USB network adapter, the PC gets an address in `172.20.10.0/28`, and Safari on the iPhone opens `http://172.20.10.x:8080`. The data goes over the cable. No iPhone app is needed.
* **Doesn't work without an iPhone app:** everything else.

## The facts

| Mechanism | Can iPhone Safari reach the PC? | Verdict |
|---|---|---|
| Plugging in a cable | No. A cable alone creates no network between the PC and the iPhone. | — |
| Personal Hotspot over USB (Linux `ipheth`, Windows "Apple Mobile Device Ethernet") | **Yes.** It is a real network interface; the iPhone is the router (`172.20.10.1`). | Supported when the hotspot is available |
| usbmuxd / libimobiledevice / `iproxy` | No. These forward **PC → a port on the iPhone**. Safari cannot use them, and nothing on a stock iPhone listens for the PC. | Not supported |
| Reverse USB tunnel (phone → PC) | Only with an app on the iPhone. | Not supported |
| iOS Files "Connect to Server" over USB | Only through the hotspot network above (it is just SMB over that IP). | Experimental, see SMB-SETUP.md |
| WebDAV in iOS Files | iOS Files cannot mount WebDAV servers. | Not supported by iOS |

## Requirements for Personal Hotspot over USB

* Personal Hotspot must be available on the iPhone. Some carriers hide it, and iPhones without a SIM/plan usually don't show it.
* **Windows:** the Apple driver from **Apple Devices** (Microsoft Store) or iTunes.
* **Ubuntu:** the `ipheth` kernel driver (included in Ubuntu kernels) and `usbmuxd` for the trust/pairing handshake: `sudo apt install usbmuxd libimobiledevice-utils`.
* Unlock the iPhone and tap **Trust** when you connect it.

## What the USB / Cable screen checks (all real, never assumed)

* **Ubuntu:** Apple USB devices from `/sys/bus/usb/devices/*/idVendor == 05ac` (+ product name), `ipheth` loaded or present in the kernel module folder, the usbmuxd socket, and network interfaces using the `ipheth` driver.
* **Windows:** `Get-PnpDevice` for VID 05AC devices, an "Apple Mobile Device Ethernet" adapter, and the Apple Mobile Device service.
* **States:** *No iPhone detected* → *iPhone connected, no USB network yet* (turn on Personal Hotspot) → *Driver missing* → *USB network ready* (shows the URL and a button to use it for the QR code). The app never shows "Connected" over USB unless the network interface really exists.

## Not tested yet

USB detection logic has unit tests and was run on Ubuntu without an iPhone attached. Behaviour with a real iPhone on Windows and Ubuntu has to be checked with the manual steps in TESTING.md.
