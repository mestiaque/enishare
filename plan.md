# MASTER DEVELOPMENT PROMPT
## Project: ENiShare — Cross-Platform PC to iPhone File Sharing Application

Act as a Senior Cross-Platform Desktop Application Architect, Node.js Engineer, Network Engineer, UI/UX Designer, and Security Engineer.

Your task is to design and develop a complete, production-quality desktop application named **ENiShare**.

The application will allow users to transfer files between a Windows/Linux PC and an iPhone without installing any application on the iPhone.

The iPhone must use its built-in Safari browser and, wherever technically supported, its native Files application.

Do not build a simple demo or proof of concept. Build a complete, polished, maintainable desktop application.

---

# 1. PROJECT OBJECTIVE

Develop a local-network file-sharing application that provides:

- PC to iPhone file transfers.
- iPhone to PC file transfers.
- Multiple file uploads.
- Multiple file downloads.
- Image and document previews.
- QR-code-based device connection.
- Real-time transfer progress.
- Drag-and-drop file sharing.
- Received file management.
- Wi-Fi-based sharing.
- A technically verified USB connectivity option.
- No cloud storage or third-party file hosting.

All file transfers should happen locally whenever possible.

The application must support:

- Windows 10/11
- Ubuntu Linux (22.04 and newer)
- iPhone with a modern iOS version
- Safari and Chrome on iOS

---

# 2. TECHNOLOGY STACK

Use the following architecture.

## Desktop Application

Framework: Electron.js

Frontend:
- HTML5
- CSS3
- Vanilla JavaScript
- Bootstrap 5 (optional)
- Lucide Icons
- QRCode.js

Desktop backend:
- Node.js
- Express.js

Communication:
- Socket.IO
- HTTP
- WebSocket

File handling:
- Multer or a suitable streaming upload implementation
- Node.js streams
- Chunked transfer support

Networking:
- Node.js OS network interfaces
- HTTP local server
- Optional SMB integration
- USB connectivity investigation and implementation where supported

Packaging:
- Electron Builder

Target packages:
- Windows: NSIS installer
- Linux: AppImage and DEB

Avoid unnecessary frameworks and dependencies.

Keep the architecture modular and maintainable.

---

# 3. APPLICATION ARCHITECTURE

Use a modular architecture with three major components.

### A. Desktop Application

Responsible for:
- Application window.
- Desktop UI.
- Starting/stopping the sharing server.
- Network interface detection.
- QR code generation.
- File selection and drag-and-drop.
- Shared file management.
- Received file management.
- Transfer monitoring.
- Application settings.

### B. Local Network Server

Responsible for:
- Express HTTP server.
- Serving the mobile interface.
- File upload endpoints.
- File download endpoints.
- File listing.
- WebSocket communication.
- Transfer progress.
- Device session management.
- Security and authentication.

### C. Mobile Web Client

Responsible for:
- iPhone connection.
- File uploads.
- File downloads.
- Image previews.
- Document listing.
- Transfer progress.
- Mobile-friendly navigation.

The mobile client must be accessible through a URL such as:

http://192.168.1.100:8080

The IP address and port must be configurable.

---

# 4. DESKTOP APPLICATION UI

Create a modern, professional desktop interface.

Design direction:

- Minimal and clean.
- Modern desktop application appearance.
- Light and dark themes.
- Rounded cards.
- Subtle shadows.
- Consistent spacing.
- Smooth transitions.
- Clear icons.
- Responsive desktop layout.

The application should have a sidebar navigation.

## Navigation

1. Dashboard
2. Wi-Fi Sharing
3. USB / Cable
4. Shared Files
5. Received Files
6. Transfer History
7. Settings
8. About

## Dashboard

Display:

- Server status.
- Current network IP.
- Server port.
- Connected devices.
- Total files shared.
- Total files received.
- Total transferred data.
- Active transfers.

Include a prominent Start Sharing / Stop Sharing button.

## Wi-Fi Sharing Screen

Display:

- Dynamically detected local IPv4 address.
- Sharing URL.
- QR code.
- Copy URL button.
- Refresh QR button.
- Server status.
- Connected device count.
- Connection instructions.

Example:

http://192.168.1.100:8080

Generate the QR code dynamically whenever the active IP or port changes.

The QR code must contain the complete connection URL.

Allow users to select the network interface if multiple interfaces exist.

Do not select loopback, virtual adapters, VPN interfaces, or inactive interfaces as the default Wi-Fi address unless explicitly selected.

Provide a manual IP override.

## USB / Cable Screen

Provide a dedicated interface explaining cable connectivity.

IMPORTANT TECHNICAL REQUIREMENT:

Do not assume that connecting an iPhone using a USB cable automatically creates a network interface between the PC and iPhone.

Investigate the actual technical capabilities and limitations of:

- iOS Files app SMB support.
- WebDAV compatibility with iOS Files.
- iPhone USB tethering.
- Linux usbmuxd and libimobiledevice.
- Windows Apple USB networking drivers.
- USB port forwarding.
- Reverse USB tunneling.

Do not claim that the iOS Files app supports native WebDAV mounting.

The iOS Files app supports SMB connections through Connect to Server. However, an actual network path to the PC must exist.

Implement USB functionality only when a real, tested transport mechanism is available.

If native Files access over USB is not feasible on a particular platform:

- Clearly explain the limitation.
- Display supported alternatives.
- Never show a fake Connected status.
- Never pretend a USB connection exists.

Where feasible, investigate an optional USB tunnel that allows the iPhone's Safari browser to reach the Express server without requiring an iOS application.

Provide platform-specific instructions for Windows and Ubuntu.

## Shared Files Screen

Display files selected from the PC for iPhone downloads.

Features:

- Add files.
- Add folders.
- Drag-and-drop upload.
- Remove shared files.
- Rename files where safe.
- File preview.
- File size.
- File type.
- Date added.
- Download availability.
- Search and filtering.

The files should be accessible from the iPhone mobile interface.

## Received Files Screen

Display files uploaded from the iPhone.

Features:

- Image thumbnails.
- Document icons.
- File name.
- File size.
- Received date.
- Open file.
- Open containing folder.
- Delete file.
- Search.
- Sort by date, name, and size.

Support common formats:

Images:
- JPG
- JPEG
- PNG
- WEBP
- GIF
- HEIC where supported by the desktop OS

Documents:
- PDF
- DOC
- DOCX
- XLS
- XLSX
- PPT
- PPTX
- TXT
- CSV

Also allow other file types without preview.

---

# 5. IPHONE MOBILE WEB INTERFACE

Create a standalone, mobile-first web interface.

The interface must work without installing an iOS application.

Design requirements:

- Responsive layout.
- Optimized for iPhone screens.
- Touch-friendly buttons.
- Clean typography.
- Light and dark mode.
- Minimal navigation.
- Fast loading.
- No unnecessary animations.

Use vanilla HTML, CSS, and JavaScript.

## Mobile Dashboard

Show:

- Application name: ENiShare.
- Connection status.
- Connected PC name.
- Available shared files.
- Upload section.
- Download section.

## Upload Files

Provide two separate actions:

1. Select Photos
2. Select Documents

Use appropriate HTML input elements:

- `accept="image/*"` for images.
- `accept` for supported document MIME types and extensions.
- `multiple` for selecting multiple files.

Allow users to select files from the iPhone Photos library and Files app.

Requirements:

- Multiple file selection.
- Upload queue.
- Individual progress bars.
- Overall progress.
- Upload speed.
- Remaining file size.
- Cancel upload.
- Upload completion notification.
- Error handling.

Do not assume the browser can directly access the entire iPhone photo library. Use the browser's supported file-picker interface.

## Download from PC

Display all files shared by the desktop application.

Each item should display:

- File icon or thumbnail.
- File name.
- File size.
- File type.
- Download button.

Support:

- Single-click downloads.
- Image preview.
- PDF preview where supported.
- Multiple downloads.
- Download progress.
- Download cancellation where technically possible.

Use the appropriate browser download mechanisms.

Explain browser limitations when multiple downloads require user permission.

## Real-Time Communication

Use Socket.IO for:

- Device connection status.
- Upload progress.
- Download progress where measurable.
- File-list updates.
- Transfer completion notifications.

The interface must reconnect automatically if the connection drops.

---

# 6. NODE.JS BACKEND IMPLEMENTATION

Build the Express backend as a modular service.

## Server Responsibilities

1. Detect available IPv4 network interfaces.
2. Identify usable LAN addresses.
3. Start HTTP server.
4. Serve mobile web application.
5. Handle file uploads.
6. Handle file downloads.
7. List shared files.
8. List received files.
9. Manage file metadata.
10. Manage transfer sessions.
11. Communicate with desktop UI.
12. Handle errors.
13. Enforce security restrictions.

## Network Detection

Use Node.js `os.networkInterfaces()`.

Requirements:

- Detect IPv4.
- Exclude 127.0.0.1.
- Exclude inactive interfaces.
- Identify likely Wi-Fi/Ethernet interfaces.
- Handle multiple adapters.
- Handle changing IP addresses.
- Allow manual interface selection.

Do not assume that every private IPv4 address belongs to Wi-Fi.

## Server Configuration

Default configuration:

PORT=8080

Allow users to change the port.

Provide a configuration file or settings storage.

Support automatic port-conflict detection and report meaningful errors.

## Storage

Use the following default directories:

Windows:
`%USERPROFILE%\Downloads\ENiShare`

Ubuntu:
`~/Downloads/ENiShare`

Create:

- Received/
- Shared/
- Thumbnails/
- Temp/
- Database/

Never store uploaded files in temporary application installation directories.

Allow users to change the storage location.

## Upload API

Implement:

POST /api/upload

Requirements:

- Multipart file uploads.
- Multiple files.
- File size limits configurable by the user.
- Unique filenames to prevent overwrites.
- Streaming file writes.
- Upload progress events.
- Upload cancellation.
- Temporary file cleanup.
- Proper error handling.

Support large files without loading the entire file into RAM.

Use chunked/resumable uploads for large files.

Each upload session should have:

- Unique upload ID.
- Original filename.
- File size.
- Chunk size.
- Received chunk count.
- Upload status.
- Creation timestamp.

Verify completed uploads before moving them into Received/.

## File Listing API

GET /api/files/shared

GET /api/files/received

Return structured JSON metadata.

## Download API

GET /api/files/shared/:id

Requirements:

- Stream file contents.
- Correct MIME types.
- Content-Disposition headers.
- Proper filenames.
- Download progress tracking.
- File access validation.

## File Management API

DELETE /api/files/shared/:id

DELETE /api/files/received/:id

Implement safe file deletion and validate all paths.

## Device Management

Provide:

GET /api/devices

Display connected devices.

Do not rely on Socket.IO connection counts alone as proof of a physically connected device.

Use session identifiers and last-active timestamps.

---

# 7. WEBDAV / SMB IMPLEMENTATION

Investigate and implement the correct protocol for the intended use case.

IMPORTANT:

WebDAV and SMB are different protocols.

Do not treat them as interchangeable.

The iPhone Files application supports SMB through:

Files → Browse → Three-dot menu → Connect to Server

The native Files app does not provide general-purpose WebDAV server mounting.

Therefore:

- Implement SMB as an optional service if it can be reliably integrated.
- Investigate a maintained Node.js SMB server implementation or a platform-native SMB service.
- Do not assume that a package advertised as an SMB client is an SMB server.
- Verify read/write access from the actual iOS Files app.
- Configure SMB authentication securely.
- Do not expose SMB to public networks.

For WebDAV:

- It may be implemented as an additional browser-compatible service.
- Do not advertise it as directly mountable in iOS Files.
- Document which clients can use it.

For USB:

- Research a genuine USB networking or port-forwarding mechanism.
- Test on Windows and Ubuntu separately.
- Clearly distinguish USB data transport from ordinary Wi-Fi connectivity.
- Do not promise functionality without a working implementation.

If a true USB transport cannot be implemented reliably without an iOS companion app, document that limitation and deliver a working Wi-Fi solution rather than shipping misleading functionality.

---

# 8. SECURITY REQUIREMENTS

Security is mandatory even though this is a local application.

Implement:

- Random session tokens.
- QR-based pairing.
- Optional pairing PIN.
- Session expiration.
- CSRF protection where applicable.
- Upload size restrictions.
- Filename sanitization.
- Path traversal protection.
- MIME validation.
- Rate limiting.
- Secure temporary file handling.
- Restricted file access.
- Safe deletion.
- WebSocket authentication.

Never expose arbitrary PC filesystem paths through HTTP endpoints.

Only expose explicitly shared files and files inside the configured Received directory.

Bind the server to an appropriate network interface.

Default behavior should be LAN-only.

Do not expose the application to the public internet by default.

Use HTTPS where practical and explain the certificate requirements for iOS browser access. If local HTTP is used, document its security limitations.

---

# 9. TRANSFER ENGINE

Create a reusable transfer manager.

It must support:

- Multiple simultaneous transfers.
- Configurable concurrency.
- Large files.
- Chunked transfers.
- Resume interrupted uploads.
- Transfer cancellation.
- Progress events.
- Transfer history.
- Error recovery.

Progress information:

- Total bytes.
- Transferred bytes.
- Percentage.
- Transfer speed.
- Estimated remaining time.
- Transfer status.

Use Node.js streams and avoid unnecessary memory consumption.

Ensure that file names and metadata remain correct.

---

# 10. DATABASE AND METADATA

Use SQLite for persistent metadata.

Recommended tables:

### files
- id
- original_name
- stored_name
- file_path
- mime_type
- file_size
- file_hash
- direction
- created_at

### devices
- id
- device_name
- session_id
- ip_address
- last_seen
- created_at

### transfers
- id
- file_id
- device_id
- direction
- total_size
- transferred_size
- status
- started_at
- completed_at

### settings
- key
- value

Use parameterized database queries.

Keep the database separate from physical file storage.

---

# 11. PROJECT STRUCTURE

Use a maintainable structure similar to:

ENiShare/
│
├── package.json
├── electron-builder.yml
├── README.md
├── .gitignore
│
├── src/
│   ├── main/
│   │   ├── main.js
│   │   ├── preload.js
│   │   └── window-manager.js
│   │
│   ├── server/
│   │   ├── index.js
│   │   ├── app.js
│   │   ├── config/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── middleware/
│   │   ├── sockets/
│   │   ├── network/
│   │   ├── storage/
│   │   ├── database/
│   │   └── protocols/
│   │
│   ├── desktop/
│   │   ├── index.html
│   │   ├── css/
│   │   ├── js/
│   │   └── assets/
│   │
│   └── mobile/
│       ├── index.html
│       ├── css/
│       ├── js/
│       └── assets/
│
├── scripts/
│   ├── build-windows.js
│   └── build-linux.js
│
├── tests/
│   ├── api/
│   ├── network/
│   └── transfer/
│
└── docs/
    ├── ARCHITECTURE.md
    ├── SECURITY.md
    ├── NETWORKING.md
    ├── USB-LIMITATIONS.md
    └── INSTALLATION.md

You may improve this structure when necessary, but keep responsibilities separated.

---

# 12. WINDOWS AND UBUNTU SUPPORT

The application must behave consistently across both platforms.

## Windows

Support:

- Windows 10/11.
- Network adapter detection.
- Windows Firewall guidance.
- File storage permissions.
- USB driver detection where applicable.
- NSIS installer.
- Desktop shortcut.
- Start menu entry.
- Application uninstall.

Provide commands to install dependencies and run the application.

## Ubuntu

Support:

- Ubuntu 22.04 and newer.
- Network adapter detection.
- UFW firewall guidance.
- File storage permissions.
- USB device diagnostics where applicable.
- AppImage.
- DEB package.

Provide:

- Node.js installation instructions.
- npm installation.
- Dependency installation.
- Development commands.
- Production build commands.

Do not assume root privileges for normal application operation.

---

# 13. APPLICATION SETTINGS

Create a settings interface containing:

- Server port.
- Preferred network interface.
- Automatic IP detection.
- Storage directory.
- Maximum upload size.
- Maximum simultaneous transfers.
- Theme.
- Automatic server startup.
- Pairing PIN.
- Session expiration.
- SMB service settings if supported.
- Notification preferences.

Changes must persist between application restarts.

---

# 14. ERROR HANDLING

Handle the following cases:

- No Wi-Fi connection.
- No valid network adapter.
- IP address changes.
- Port already in use.
- Firewall blocking incoming connections.
- iPhone cannot connect.
- Invalid pairing token.
- Upload interrupted.
- Download interrupted.
- Insufficient disk space.
- Unsupported file format.
- Duplicate filenames.
- Permission denied.
- USB device unavailable.
- SMB service failure.

Display understandable error messages rather than raw stack traces.

Write technical logs to an application log directory.

---

# 15. TESTING REQUIREMENTS

Create a real testing strategy.

Test:

1. Windows PC to iPhone upload.
2. iPhone to Windows PC upload.
3. Ubuntu PC to iPhone upload.
4. iPhone to Ubuntu PC upload.
5. Multiple image uploads.
6. Multiple document uploads.
7. Large file transfers.
8. Interrupted transfers.
9. Resumable transfers.
10. QR code connection.
11. IP changes.
12. Multiple simultaneous devices.
13. File deletion.
14. Security restrictions.
15. SMB connectivity using iOS Files, if implemented.
16. USB connectivity separately on Windows and Ubuntu, if implemented.

Do not mark a feature as completed merely because the code compiles.

Clearly distinguish:

- Implemented.
- Tested.
- Partially supported.
- Experimental.
- Not supported.

---

# 16. DEVELOPMENT EXECUTION PLAN

Develop this project in phases.

### Phase 1 — Architecture
- Finalize application architecture.
- Finalize dependencies.
- Define API contracts.
- Define database schema.
- Define network behavior.
- Investigate USB feasibility.

### Phase 2 — Desktop Foundation
- Create Electron application.
- Create desktop UI.
- Implement settings.
- Implement storage manager.
- Implement network detection.

### Phase 3 — HTTP Server
- Implement Express server.
- Implement mobile UI hosting.
- Implement QR generation.
- Implement pairing and authentication.

### Phase 4 — File Transfers
- Implement upload API.
- Implement download API.
- Implement chunked uploads.
- Implement transfer progress.
- Implement file management.

### Phase 5 — Mobile Interface
- Build responsive iPhone interface.
- Implement file selection.
- Implement upload queue.
- Implement download listing.
- Implement previews.
- Implement real-time progress.

### Phase 6 — Advanced Networking
- Investigate and implement SMB.
- Investigate USB networking.
- Implement only verified transport methods.
- Add clear platform-specific limitations.

### Phase 7 — Testing and Security
- Test Windows.
- Test Ubuntu.
- Test iPhone Safari.
- Test large files.
- Perform security checks.
- Fix bugs.

### Phase 8 — Production Packaging
- Build Windows installer.
- Build Ubuntu AppImage.
- Build Ubuntu DEB.
- Create installation documentation.
- Create user manual.

---

# 17. DEVELOPMENT RULES

Follow these rules strictly:

1. Write complete, executable code.
2. Do not provide pseudocode as a substitute for implementation.
3. Do not leave critical functions as TODO.
4. Do not invent package APIs.
5. Verify dependency compatibility.
6. Use maintained packages.
7. Keep code modular.
8. Use meaningful variable and function names.
9. Handle errors consistently.
10. Avoid unnecessary dependencies.
11. Avoid hardcoded IP addresses.
12. Avoid hardcoded filesystem paths.
13. Do not use cloud storage.
14. Do not require an iOS application.
15. Do not compromise security for convenience.
16. Do not claim unsupported USB functionality.
17. Make the application usable by non-technical users.

When implementing a feature, explain its purpose and important technical decisions.

---

# 18. EXPECTED DELIVERABLES

Produce the following:

1. Complete technical architecture.
2. Architecture diagram.
3. Complete project directory structure.
4. package.json with dependencies.
5. Electron main process.
6. Secure preload script.
7. Complete Express backend.
8. SQLite database implementation.
9. Network detection module.
10. File upload and download services.
11. Chunked transfer implementation.
12. Socket.IO implementation.
13. Complete desktop HTML/CSS/JS interface.
14. Complete mobile HTML/CSS/JS interface.
15. QR code implementation.
16. Security middleware.
17. SMB implementation if technically feasible.
18. USB feasibility assessment and implementation if feasible.
19. Windows installation guide.
20. Ubuntu installation guide.
21. Development and production build commands.
22. Testing instructions.
23. README.md.
24. Troubleshooting documentation.

---

# 19. HOW TO WORK WITH ME

I want you to act as the lead developer for this project.

Do not generate the entire project in one enormous response that risks missing files or producing incomplete code.

Work systematically.

First, provide:

- Final architecture.
- Technical feasibility assessment.
- Dependency list.
- Database design.
- Complete project structure.
- API endpoint specification.
- Networking design.
- Development roadmap.

Then wait for my approval before beginning implementation.

After approval:

- Develop one phase at a time.
- Generate complete files with exact paths.
- Clearly identify where each file belongs.
- Never silently omit required files.
- Keep track of completed and remaining components.
- Check compatibility between previously generated files.
- Explain how to run and test each phase.
- Fix errors before proceeding to the next phase.

When I report an error, investigate its root cause and provide corrected complete code for the affected files.

Always prioritize a working, secure, cross-platform application over unnecessary features.

# FINAL GOAL

Deliver a polished desktop application that makes transferring files between Windows/Ubuntu PCs and iPhones as simple as scanning a QR code.

The primary experience should be:

1. Open ENiShare on the PC.
2. Click Start Sharing.
3. Scan the displayed QR code using the iPhone camera.
4. Open the ENiShare web interface in Safari.
5. Upload photos and documents to the PC.
6. Browse and download shared PC files directly on the iPhone.

No iOS app installation. No cloud account. No external file-hosting service.

The application should feel like a professional, reliable desktop product rather than a basic development utility.