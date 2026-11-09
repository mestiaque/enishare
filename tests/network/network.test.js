import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyInterface, chooseAddress, isPrivateIPv4 } from '../../src/server/network/interfaces.js';
import { isPortFree, findFreePort } from '../../src/server/network/port.js';
import { sanitizeFileName, contentDisposition } from '../../src/server/storage/sanitize.js';
import { safeJoin, isInside } from '../../src/server/storage/paths.js';
import { crc32, crc32Hex } from '../../src/shared/crc32.js';
import net from 'node:net';

test('interface classification', () => {
  assert.equal(classifyInterface('wlp2s0', '192.168.1.5', { wireless: true, driver: 'iwlwifi' }), 'wifi');
  assert.equal(classifyInterface('enp3s0', '192.168.1.6', { driver: 'r8169' }), 'ethernet');
  assert.equal(classifyInterface('enx0a1b2c', '172.20.10.3', { driver: 'ipheth' }), 'iphone-usb');
  assert.equal(classifyInterface('Ethernet 3', '172.20.10.2', { description: 'Apple Mobile Device Ethernet' }), 'iphone-usb');
  assert.equal(classifyInterface('docker0', '172.17.0.1', {}), 'virtual');
  assert.equal(classifyInterface('vEthernet (WSL)', '172.24.0.1', { description: 'Hyper-V Virtual Ethernet Adapter' }), 'virtual');
  assert.equal(classifyInterface('tailscale0', '100.80.1.2', {}), 'vpn');
  assert.equal(classifyInterface('wg0', '10.8.0.2', {}), 'vpn');
  assert.equal(classifyInterface('Wi-Fi', '192.168.0.10', { description: 'Intel(R) Wi-Fi 6 AX201 160MHz', physicalMedia: 'Native 802.11' }), 'wifi');
  assert.equal(classifyInterface('Ethernet', '10.0.0.5', { description: 'Realtek PCIe GbE Family Controller', physicalMedia: '802.3' }), 'ethernet');
});

test('address choice never auto-selects virtual or VPN adapters', () => {
  const ifaces = [
    { name: 'docker0', address: '172.17.0.1', kind: 'virtual' },
    { name: 'wg0', address: '10.8.0.2', kind: 'vpn' },
  ];
  assert.equal(chooseAddress(ifaces, { autoDetectIp: true }).address, null);
  assert.equal(chooseAddress(ifaces, { autoDetectIp: true }).warning, 'ONLY_VIRTUAL');
  const withWifi = [{ name: 'wlan0', address: '192.168.1.7', kind: 'wifi' }, ...ifaces];
  assert.equal(chooseAddress(withWifi, { autoDetectIp: true }).address, '192.168.1.7');
  assert.equal(chooseAddress(withWifi, { autoDetectIp: true, interfaceName: 'docker0' }).address, '172.17.0.1');
  const gone = chooseAddress(withWifi, { autoDetectIp: true, interfaceName: 'eth9' });
  assert.equal(gone.address, '192.168.1.7');
  assert.equal(gone.warning, 'SELECTED_INTERFACE_GONE');
  const manual = chooseAddress(withWifi, { autoDetectIp: false, manualIp: '192.168.50.2' });
  assert.equal(manual.address, '192.168.50.2');
  assert.equal(manual.warning, 'MANUAL_IP_NOT_FOUND');
  assert.equal(chooseAddress([], { autoDetectIp: true }).warning, 'NO_NETWORK');
});

test('private address detection', () => {
  assert.ok(isPrivateIPv4('192.168.1.1'));
  assert.ok(isPrivateIPv4('172.20.10.1'));
  assert.ok(!isPrivateIPv4('172.15.0.1'));
  assert.ok(!isPrivateIPv4('8.8.8.8'));
  assert.ok(!isPrivateIPv4('999.1.1.1'));
});

test('port conflict detection finds the next free port', async () => {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const used = srv.address().port;
  assert.equal(await isPortFree(used, '127.0.0.1'), false);
  const next = await findFreePort(used, '127.0.0.1');
  assert.ok(next > used);
  srv.close();
});

test('file name sanitising', () => {
  assert.equal(sanitizeFileName('../../etc/passwd'), '_.._etc_passwd');
  assert.equal(sanitizeFileName('a<b>c:d"e|f?g*h.txt'), 'a_b_c_d_e_f_g_h.txt');
  assert.equal(sanitizeFileName('CON.txt'), '_CON.txt');
  assert.equal(sanitizeFileName('  .hidden. '), 'hidden');
  assert.equal(sanitizeFileName(''), 'file');
  assert.equal(sanitizeFileName('ছবি ২০২৬.jpg'), 'ছবি ২০২৬.jpg');
  assert.ok(Buffer.byteLength(sanitizeFileName('অ'.repeat(200) + '.jpg')) <= 200);
  assert.ok(sanitizeFileName('অ'.repeat(200) + '.jpg').endsWith('.jpg'));
  assert.equal(sanitizeFileName('bad\u0000name\u0007.txt'), 'badname.txt');
});

test('safeJoin refuses escapes', () => {
  assert.throws(() => safeJoin('/tmp/x', '../y'));
  assert.throws(() => safeJoin('/tmp/x', 'a/b'));
  assert.throws(() => safeJoin('/tmp/x', '/etc/passwd'));
  assert.throws(() => safeJoin('/tmp/x', 'a\\b'));
  assert.equal(safeJoin('/tmp/x', 'ok.txt'), '/tmp/x/ok.txt');
  assert.ok(isInside('/tmp/x', '/tmp/x/a/b'));
  assert.ok(!isInside('/tmp/x', '/tmp/xy'));
});

test('content-disposition', () => {
  assert.equal(contentDisposition('attachment', 'a b.pdf'), `attachment; filename="a b.pdf"; filename*=UTF-8''a%20b.pdf`);
});

test('crc32 matches the standard check value', () => {
  assert.equal(crc32Hex(crc32(Buffer.from('123456789'))), 'cbf43926');
});
