// Validated, persistent application settings (SQLite `settings` table).
import os from 'node:os';
import net from 'node:net';
import { DEFAULT_SETTINGS, SETTING_LIMITS } from '../../shared/constants.js';
import { AppError } from '../errors.js';

const THEMES = ['system', 'dark', 'light', 'glass'];
const BIND_MODES = ['lan', 'selected'];

export function createSettingsService(repos, onChange = () => {}) {
  let cache = { ...DEFAULT_SETTINGS, ...repos.settings.all() };

  function validate(key, value) {
    if (!(key in DEFAULT_SETTINGS)) throw new AppError('BAD_SETTING', `Unknown setting: ${key}`);
    const def = DEFAULT_SETTINGS[key];
    if (typeof def === 'boolean') return Boolean(value);
    if (typeof def === 'number') {
      const n = Number(value);
      const [min, max] = SETTING_LIMITS[key] ?? [-Infinity, Infinity];
      if (!Number.isInteger(n) || n < min || n > max) {
        throw new AppError('BAD_SETTING', `${labelOf(key)} must be a whole number between ${min} and ${max}.`);
      }
      return n;
    }
    const s = String(value ?? '').trim();
    switch (key) {
      case 'theme': if (!THEMES.includes(s)) throw new AppError('BAD_SETTING', 'Unknown theme.'); return s;
      case 'bindMode': if (!BIND_MODES.includes(s)) throw new AppError('BAD_SETTING', 'Unknown bind mode.'); return s;
      case 'manualIp':
        if (s && net.isIPv4(s) !== true) throw new AppError('BAD_SETTING', 'Manual IP must be an IPv4 address such as 192.168.1.20.');
        return s;
      case 'pin':
        if (s && !/^\d{6}$/.test(s)) throw new AppError('BAD_SETTING', 'The pairing PIN must be exactly 6 digits.');
        return s;
      case 'smbShareName':
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(s)) throw new AppError('BAD_SETTING', 'Share name may only use letters, digits, - and _ (max 32).');
        return s;
      case 'pcName': return s.slice(0, 64);
      case 'interfaceName': return s.slice(0, 128);
      default: return s;
    }
  }

  function labelOf(key) {
    return ({ port: 'Port', maxUploadMB: 'Maximum upload size', maxConcurrent: 'Simultaneous transfers',
      sessionHours: 'Session length', pairTokenMinutes: 'QR code lifetime' })[key] || key;
  }

  return {
    get: (key) => cache[key],
    all: () => ({ ...cache }),
    /** Public view for the renderer: hides the PIN value itself. */
    publicView: () => ({ ...cache, pin: cache.pin ? '••••••' : '', pinSet: Boolean(cache.pin) }),
    pcName: () => cache.pcName || os.hostname(),
    update(patch) {
      const next = {};
      for (const [k, v] of Object.entries(patch ?? {})) {
        if (k === 'pin' && v === '••••••') continue; // unchanged masked value from the UI
        next[k] = validate(k, v);
      }
      const merged = { ...cache, ...next };
      if (merged.pinEnabled && !merged.pin) throw new AppError('BAD_SETTING', 'Set a 6-digit PIN before enabling PIN pairing.');
      const changed = Object.keys(next).filter((k) => next[k] !== cache[k]);
      for (const k of changed) repos.settings.set(k, next[k]);
      cache = merged;
      if (changed.length) onChange(changed, { ...cache });
      return changed;
    },
  };
}
