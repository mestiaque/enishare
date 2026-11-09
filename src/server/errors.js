// Errors with a stable code, an HTTP status and a message that is safe to show to users.
export class AppError extends Error {
  constructor(code, userMessage, status = 400, cause) {
    super(userMessage);
    this.code = code;
    this.status = status;
    this.userMessage = userMessage;
    if (cause) this.cause = cause;
  }
}

export const Errors = {
  notFound: (what = 'File') => new AppError('NOT_FOUND', `${what} not found.`, 404),
  unauthorized: () => new AppError('UNAUTHORIZED', 'This device is not paired. Scan the QR code on your PC again.', 401),
  forbidden: (msg = 'This action is not allowed.') => new AppError('FORBIDDEN', msg, 403),
  badRequest: (msg) => new AppError('BAD_REQUEST', msg, 400),
  tooLarge: (maxMB) => new AppError('UPLOAD_TOO_LARGE', `This file is larger than the ${maxMB} MB limit set on the PC.`, 413),
  diskFull: () => new AppError('DISK_FULL', 'The PC does not have enough free disk space for this file.', 507),
  busy: () => new AppError('BUSY', 'The PC is busy with other transfers. Retrying…', 429),
};

/** Turns low-level Node errors into friendly messages. */
export function friendlyFsError(err, action = 'access the file') {
  if (err instanceof AppError) return err;
  switch (err?.code) {
    case 'ENOENT': return new AppError('NOT_FOUND', 'The file no longer exists on the PC.', 404, err);
    case 'EACCES':
    case 'EPERM': return new AppError('PERMISSION_DENIED', `Permission denied: ENiShare could not ${action}.`, 403, err);
    case 'ENOSPC': return Errors.diskFull();
    case 'EBUSY': return new AppError('FILE_BUSY', 'The file is in use by another program.', 409, err);
    default: return new AppError('INTERNAL', `Could not ${action}.`, 500, err);
  }
}
