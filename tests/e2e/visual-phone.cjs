// Visual check of the transfer animations: pairs with a PIN, throttles the network, then
// uploads a file and downloads a shared file at the same time and takes screenshots mid-way.
// Writes <shots>/phone-mid.png and touches <shots>/MID so the desktop screenshot can be taken.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const [base, pin, shots, upload] = process.argv.slice(process.argv.indexOf('--') + 1);
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const logFile = () => path.join(shots, 'phone.log');
const log = (...a) => fs.appendFileSync(logFile(), a.join(' ') + '\n');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 390, height: 844, x: 0, y: 0, useContentSize: true, webPreferences: { backgroundThrottling: false } });
  win.webContents.setUserAgent(UA);
  const js = (c) => win.webContents.executeJavaScript(c);
  try {
    await win.loadURL(`${base}/pair`);
    log('pin:', await js(`fetch('/api/pair/pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:'${pin}'})}).then(r=>r.status)`));
    await win.loadURL(`${base}/`);
    await wait(1500);
    const dbg = win.webContents.debugger;
    dbg.attach('1.3');
    await dbg.sendCommand('Network.enable');
    await dbg.sendCommand('Network.emulateNetworkConditions', { offline: false, latency: 5, uploadThroughput: 3 * 1024 * 1024, downloadThroughput: 400 * 1024 });
    const { root } = await dbg.sendCommand('DOM.getDocument');
    const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#pick-any' });
    await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files: [upload] });
    await js(`document.querySelector('#pick-any').dispatchEvent(new Event('change'))`);
    // Start a download of the biggest shared file through the page (counts as a real download on the PC).
    await js(`fetch('/api/files/shared').then(r=>r.json()).then(({files})=>{const f=files.sort((a,b)=>b.size-a.size)[0]; fetch('/api/files/shared/'+f.id).then(r=>r.blob());})`);
    await wait(3500);
    fs.writeFileSync(path.join(shots, 'phone-mid.png'), (await win.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(shots, 'MID'), '');
    log('stage:', await js(`document.querySelector('#stage').className + ' | ' + document.querySelector('#stage .lane-label').textContent`));
    log('bar:', await js(`[...document.querySelectorAll('#xfer-bar i')].map(i=>i.className+':'+i.style.width).join(' ')`));
    await wait(4000);
  } catch (err) { log('VISUAL FAILED', err.stack); }
  app.exit(0);
});
