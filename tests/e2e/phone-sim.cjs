// E2E "phone": an Electron window with an iPhone user agent and screen size that opens the
// pairing URL, uploads files through the real file inputs (via the DevTools protocol) and
// takes screenshots. This exercises the mobile UI + server; it is not a substitute for Safari.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const [pairUrl, shotsDir, ...uploadFiles] = process.argv.slice(process.argv.indexOf('--') + 1);
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 390, height: 844, x: 0, y: 0, show: true, useContentSize: true });
  win.webContents.setUserAgent(UA);
  const shot = async (name) => fs.writeFileSync(path.join(shotsDir, `phone-${name}.png`), (await win.webContents.capturePage()).toPNG());
  const js = (code) => win.webContents.executeJavaScript(code);
  const log = [];
  win.webContents.on('console-message', (e) => log.push(`${e.level}: ${e.message}`));
  try {
    await win.loadURL(pairUrl);
    await wait(2500);
    console.log('URL after pairing:', win.webContents.getURL());
    await shot('1-send');

    const dbg = win.webContents.debugger;
    dbg.attach('1.3');
    const { root } = await dbg.sendCommand('DOM.getDocument');
    const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#pick-any' });
    await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files: uploadFiles });
    await js(`document.querySelector('#pick-any').dispatchEvent(new Event('change'))`);
    await wait(700);
    await shot('2-uploading');
    for (let i = 0; i < 60; i++) {
      const busy = await js(`document.querySelector('#overall-title')?.textContent || ''`);
      if (/sent/.test(busy) && !/Uploading/.test(busy)) break;
      await wait(500);
    }
    await wait(800);
    await shot('3-uploaded');
    console.log('overall:', await js(`document.querySelector('#overall-title').textContent + ' ' + document.querySelector('#overall-pct').textContent`));
    console.log('sent list:', await js(`[...document.querySelectorAll('#sent .name')].map(e => e.textContent).join(' | ')`));

    await js(`document.querySelector('[data-tab=get]').click()`);
    await wait(1200);
    await shot('4-get');
    console.log('shared list:', await js(`[...document.querySelectorAll('#files .name')].map(e => e.textContent).join(' | ')`));
    await js(`document.querySelector('[data-view]')?.click()`);
    await wait(1200);
    await shot('5-preview');
    console.log('connection:', await js(`document.querySelector('#conn').textContent`));
  } catch (err) {
    console.error('E2E FAILED', err);
  }
  console.log('console:', log.filter((l) => !/DevTools/.test(l)).slice(-10).join('\n'));
  app.quit();
});
