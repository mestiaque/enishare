# iPhone Files app access (SMB): optional, experimental

The iOS **Files** app can connect to SMB servers (*Files → Browse → ⋯ → Connect to Server → `smb://<PC IP>`*). It cannot mount WebDAV.

No maintained Node.js SMB2/3 **server** exists. Packages named "smb2" are clients, and the old Adobe `node-smb-server` is archived and speaks SMB1, which iOS does not use. So ENiShare does not include an SMB server. Instead it manages **one share of the ENiShare folder** in the operating system's own SMB service. Settings → *iPhone Files app (SMB)* shows live checks and a Create/Remove button.

## Ubuntu (Samba usershares, no root for daily use)

One-time setup (needs `sudo` once):

```bash
sudo apt install samba
sudo usermod -aG sambashare $USER
sudo smbpasswd -a $USER          # the password the iPhone will use
# log out and log in again so the group change applies
```

Then in ENiShare: Settings → *Create share "ENiShare"*. This runs `net usershare add ENiShare <storage folder> "ENiShare files" Everyone:F guest_ok=n`. Linux file permissions still apply, and guest access is off.

Checks shown: Samba installed · user in `sambashare` · share exists · port 445 listening.

## Windows (built-in file sharing)

1. Set your Wi-Fi network profile to **Private**.
2. Turn on *File and printer sharing* for private networks (Control Panel → Network and Sharing Center → Advanced sharing settings).
3. In ENiShare: Settings → *Create share "ENiShare"*. Windows asks for administrator permission (UAC), because `New-SmbShare` requires it. Full access is granted to your own account only.
4. On the iPhone, sign in with your Windows user name and password. For a Microsoft account, use its e-mail and password.

Remove the share with the same button (also elevated).

## On the iPhone

Files → Browse → ⋯ (top right) → **Connect to Server** → `smb://192.168.1.20` (the IP shown in ENiShare) → *Registered User* → your PC user name and password. The `ENiShare` share contains `Received`, `Shared`, … folders.

## Status

Implemented as an assisted setup with real status checks. **Read/write access from a real iPhone has not been tested yet.** Please report results.
