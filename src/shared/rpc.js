// Two-way request/response + events over a message channel.
// Used between the Electron main process and the server utility process.
//
//   const rpc = createRpc({ send: (msg) => child.postMessage(msg), handlers: { ping: () => 'pong' } });
//   child.on('message', rpc.receive);
//   await rpc.call('files.list', { direction: 'shared' });
//   rpc.emit('server:state', {...});  rpc.onEvent((name, payload) => ...)

export class RpcError extends Error {
  constructor(message, code = 'INTERNAL', userMessage) {
    super(message);
    this.code = code;
    this.userMessage = userMessage || message;
  }
}

export function createRpc({ send, handlers = {}, timeoutMs = 120_000, logger }) {
  let seq = 0;
  const pending = new Map();
  const eventListeners = new Set();

  function call(method, params) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new RpcError(`RPC timeout: ${method}`, 'TIMEOUT', 'The background service did not respond in time.'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        send({ kind: 'call', id, method, params });
      } catch (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(err);
      }
    });
  }

  function emit(name, payload) {
    try { send({ kind: 'event', name, payload }); } catch (err) { logger?.warn(`emit ${name} failed`, err); }
  }

  async function handleCall(msg) {
    const fn = handlers[msg.method];
    if (!fn) {
      send({ kind: 'result', id: msg.id, error: { code: 'NO_METHOD', message: `Unknown method ${msg.method}` } });
      return;
    }
    try {
      const result = await fn(msg.params ?? {});
      send({ kind: 'result', id: msg.id, result });
    } catch (err) {
      if (!(err instanceof RpcError) && !err?.userMessage) logger?.error(`RPC ${msg.method} failed`, err);
      send({
        kind: 'result', id: msg.id,
        error: { code: err?.code || 'INTERNAL', message: err?.message || String(err), userMessage: err?.userMessage },
      });
    }
  }

  function receive(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind === 'call') return void handleCall(msg);
    if (msg.kind === 'result') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new RpcError(msg.error.message, msg.error.code, msg.error.userMessage));
      else p.resolve(msg.result);
      return;
    }
    if (msg.kind === 'event') for (const l of eventListeners) l(msg.name, msg.payload);
  }

  function failAll(reason) {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new RpcError(reason, 'DISCONNECTED', 'The background service stopped.'));
      pending.delete(id);
    }
  }

  return {
    call, emit, receive, failAll,
    onEvent(fn) { eventListeners.add(fn); return () => eventListeners.delete(fn); },
    setHandlers(h) { Object.assign(handlers, h); },
  };
}
