// Values shared by the main process, the server process and the tests.

export const APP_NAME = 'ENiShare';
export const SESSION_COOKIE = 'enishare_sid';
export const CSRF_HEADER = 'x-enishare-csrf';

export const DEFAULT_PORT = 8080;
export const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB per upload chunk
export const SMALL_UPLOAD_LIMIT = CHUNK_SIZE; // POST /api/upload (multipart) is meant for files up to one chunk
export const DISK_SPACE_RESERVE = 200 * 1024 * 1024; // keep 200 MiB free after an upload
export const DEVICE_ONLINE_WINDOW_MS = 60_000;
export const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const NETWORK_POLL_MS = 5_000;
export const PROGRESS_THROTTLE_MS = 250;

export const STORAGE_DIRS = ['Received', 'Shared', 'Thumbnails', 'Temp', 'Database'];

// Settings stored in SQLite. The storage root is the only setting kept outside the
// database (in userData/config.json), because the database lives inside it.
export const DEFAULT_SETTINGS = Object.freeze({
  port: DEFAULT_PORT,
  autoDetectIp: true,
  interfaceName: '', // '' = automatic
  manualIp: '',
  bindMode: 'lan', // 'lan' = all interfaces + private-address filter, 'selected' = only the selected IP
  maxUploadMB: 4096,
  maxConcurrent: 3,
  theme: 'system', // system | dark | light | glass
  autoStart: false,
  pinEnabled: false,
  pin: '',
  sessionHours: 24,
  pairTokenMinutes: 5,
  copySharedFiles: false, // false = share files in place (linked), true = copy into Shared/
  notifyOnReceive: true,
  notifyOnConnect: true,
  smbShareName: 'ENiShare',
  pcName: '', // '' = use the computer's host name
});

export const SETTING_LIMITS = Object.freeze({
  port: [1024, 65535],
  maxUploadMB: [1, 1024 * 1024],
  maxConcurrent: [1, 8],
  sessionHours: [1, 24 * 30],
  pairTokenMinutes: [1, 60],
});

export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'avif', 'bmp', 'tif', 'tiff'];
export const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', '3gp'];
export const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'];
export const DOC_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf', 'odt', 'ods', 'odp', 'pages', 'numbers', 'key', 'md'];
export const ARCHIVE_EXT = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'];

export function fileKind(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (['xls', 'xlsx', 'csv', 'ods', 'numbers'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) return 'slides';
  if (DOC_EXT.includes(ext)) return 'document';
  if (ARCHIVE_EXT.includes(ext)) return 'archive';
  return 'other';
}
