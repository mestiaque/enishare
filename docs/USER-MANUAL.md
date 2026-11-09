# ENiShare user manual

## Connect your iPhone (Wi-Fi)

1. Connect the iPhone to the **same Wi-Fi** as the PC.
2. In ENiShare on the PC, click **Start Sharing** (Dashboard or Wi-Fi Sharing).
3. Open the iPhone **Camera**, point it at the QR code and tap the link. Safari opens ENiShare and shows *Connected*.

Each QR code works once and changes after you scan it. To connect another iPhone, scan the new code.

**PIN instead of QR:** Settings → Security → turn on *Pairing PIN* and set 6 digits. On the iPhone, type the address shown on the PC (for example `http://192.168.1.20:8080`) and enter the PIN.

## Send files from the iPhone to the PC

* **Select Photos**: pick photos and videos from the Photos library.
* **Select Documents**: pick PDFs, Office files, text and CSV files from the Files app.
* **Other file types…**: any file.

Each file shows its own progress, and the summary card shows total progress, speed and remaining size. **✕** cancels a file, *Cancel all* cancels everything. If Wi-Fi drops or the screen locks, uploads pause and continue by themselves.
Received files land in **Downloads/ENiShare/Received** on the PC (*Received Files* in the app). Names are kept; if a name already exists, ENiShare adds `(1)`, `(2)` …

## Send files from the PC to the iPhone

* **Shared Files → Add files / Add folder**, or drag files onto the ENiShare window.
* Files are shared **from where they are**; nothing is copied unless you turn on *Copy shared files* in Settings.
* **Rename** changes the name the iPhone sees, not the file on your PC. **✕** stops sharing; your original file is not deleted.

On the iPhone, open **Get from PC**:
* Tap the blue arrow to download. Files go to **Files → Downloads**.
* The eye icon previews images, PDFs, videos and text.
* **Select** → choose files → **Download as ZIP** (always works) or **One by one** (Safari may ask for permission).

## Managing devices and files

* **Dashboard:** status, IP address, devices online, totals, live transfers.
* **Devices:** *Disconnect* signs a device out; it has to scan the QR code again.
* **Received Files:** grid or list, search, sort by date/name/size, open, show in folder, delete (Ctrl+click or right-click selects several).
* **Transfer History:** every upload and download with status; *Clear finished* empties the list.

## Using a cable (USB)

The iPhone's **Personal Hotspot** can share a network with the PC over the USB cable. Open **USB / Cable** in ENiShare and follow the steps for Windows or Ubuntu. When it shows *USB network ready*, press **Use USB network for the QR code** and scan as usual. A cable alone is not enough: Personal Hotspot must be on. See docs/USB-LIMITATIONS.md.

## Settings at a glance

Open Settings with the gear in the top bar (or Ctrl+,). Like the other EN* apps, it is one dialog with sections:

* **General:** start sharing automatically, notifications, the PC name shown on the iPhone, settings file import/export, reset.
* **Sharing:** port, listen on all local networks or one interface, storage folder, copy shared files.
* **Transfers:** maximum upload size, simultaneous transfers per device.
* **Security:** pairing PIN, session length, QR lifetime, disconnect all devices.
* **Files app (SMB):** optional share for the iPhone Files app.
* **Appearance:** theme (Dark/Light/Glass/System), accent colour, animations.
* **Logs:** recent log lines, open the log folder, copy diagnostics for a bug report.
* **About:** version, folders, feature status, developer.

Ctrl+B hides or shows the sidebar. The theme button in the top bar switches themes quickly.
