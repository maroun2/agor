#!/usr/bin/env node
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { WebSocketServer } from 'ws';

const HOST = process.env.BROWSER_BRIDGE_HOST ?? '127.0.0.1';
const PORT = Number(process.env.BROWSER_BRIDGE_PORT ?? 3001);
const TOKEN_PATH =
  process.env.BROWSER_BRIDGE_TOKEN_PATH ?? join(homedir(), '.agor', 'browser-bridge.token');
const REQUEST_TIMEOUT_MS = Number(process.env.BROWSER_BRIDGE_REQUEST_TIMEOUT_MS ?? 60_000);
const HEARTBEAT_MS = Number(process.env.BROWSER_BRIDGE_HEARTBEAT_MS ?? 25_000);

const sseClients = new Map();
const pendingRequests = new Map();
let bridgeSocket;
let bridgeConnectedAt;

function getToken() {
  if (process.env.BROWSER_BRIDGE_TOKEN) {
    return process.env.BROWSER_BRIDGE_TOKEN.trim();
  }

  if (existsSync(TOKEN_PATH)) {
    return readFileSync(TOKEN_PATH, 'utf8').trim();
  }

  const token = randomBytes(32).toString('base64url');
  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  writeFileSync(TOKEN_PATH, `${token}\n`, { mode: 0o600 });
  return token;
}

const AUTH_TOKEN = getToken();

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function tokenFromRequest(request) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const header = request.headers.authorization ?? '';

  if (header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }

  return url.searchParams.get('token') ?? request.headers['x-browser-bridge-token'] ?? '';
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function sendSse(client, event, data) {
  if (client.response.destroyed) {
    sseClients.delete(client.id);
    return;
  }

  if (event) {
    client.response.write(`event: ${event}\n`);
  }
  client.response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendMcpMessage(sessionId, message) {
  const client = sseClients.get(sessionId);
  if (!client) {
    return false;
  }

  sendSse(client, 'message', message);
  return true;
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  };
}

function closePending(reason) {
  for (const [requestId, pending] of pendingRequests) {
    clearTimeout(pending.timeout);
    sendMcpMessage(pending.sessionId, jsonRpcError(pending.rpcId, -32000, reason));
    pendingRequests.delete(requestId);
  }
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        reject(new Error('Request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : undefined);
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function normalizeBridgeResponse(message, pending) {
  const payload = message.payload ?? message.response;
  if (payload?.jsonrpc) {
    return { ...payload, id: pending.rpcId ?? payload.id ?? null };
  }

  if (message.error) {
    return {
      jsonrpc: '2.0',
      id: pending.rpcId ?? null,
      error:
        typeof message.error === 'object'
          ? message.error
          : { code: -32000, message: String(message.error) },
    };
  }

  return {
    jsonrpc: '2.0',
    id: pending.rpcId ?? null,
    result: message.result ?? payload ?? null,
  };
}

function handleBridgeMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return;
  }

  if (message.type === 'pong' || message.type === 'bridge.pong') {
    bridgeSocket.isAlive = true;
    return;
  }

  const requestId = message.requestId ?? message.id;
  if (!requestId || !pendingRequests.has(requestId)) {
    return;
  }

  const pending = pendingRequests.get(requestId);
  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);
  sendMcpMessage(pending.sessionId, normalizeBridgeResponse(message, pending));
}

function forwardMcpRequest(sessionId, payload) {
  if (!payload || typeof payload !== 'object') {
    sendMcpMessage(sessionId, jsonRpcError(null, -32700, 'Invalid JSON-RPC payload'));
    return;
  }

  if (!bridgeSocket || bridgeSocket.readyState !== bridgeSocket.OPEN) {
    if (payload.id !== undefined) {
      sendMcpMessage(
        sessionId,
        jsonRpcError(payload.id, -32000, 'No browser bridge extension connected')
      );
    }
    return;
  }

  const requestId = randomUUID();
  const timeout = setTimeout(() => {
    pendingRequests.delete(requestId);
    sendMcpMessage(sessionId, jsonRpcError(payload.id, -32001, 'Browser bridge request timed out'));
  }, REQUEST_TIMEOUT_MS);

  pendingRequests.set(requestId, { sessionId, rpcId: payload.id, timeout });
  bridgeSocket.send(
    JSON.stringify({ type: 'mcp.request', id: requestId, requestId, sessionId, payload })
  );
}

function handleSse(request, response) {
  const sessionId = randomUUID();
  response.writeHead(200, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
    'x-accel-buffering': 'no',
  });
  response.write(': connected\n\n');

  const endpoint = `/messages?sessionId=${encodeURIComponent(sessionId)}`;
  const client = { id: sessionId, response };
  sseClients.set(sessionId, client);
  sendSse(client, 'endpoint', endpoint);

  request.on('close', () => {
    sseClients.delete(sessionId);
    for (const [requestId, pending] of pendingRequests) {
      if (pending.sessionId === sessionId) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(requestId);
      }
    }
  });
}

async function handleMcpPost(request, response, url) {
  const sessionId = url.searchParams.get('sessionId') ?? url.searchParams.get('session_id');
  if (!sessionId || !sseClients.has(sessionId)) {
    sendJson(response, 404, { error: 'Unknown SSE session' });
    return;
  }

  try {
    const payload = await parseBody(request);
    forwardMcpRequest(sessionId, payload);
    response.writeHead(202, { 'access-control-allow-origin': '*' });
    response.end('Accepted');
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

function handleHttp(request, response) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-headers': 'authorization, content-type, x-browser-bridge-token',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-origin': '*',
    });
    response.end();
    return;
  }

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    sendJson(response, 200, {
      ok: true,
      extensionConnected: !!bridgeSocket,
      extensionUptimeSeconds: bridgeConnectedAt
        ? Math.floor((Date.now() - bridgeConnectedAt) / 1000)
        : 0,
      sseClients: sseClients.size,
      pendingRequests: pendingRequests.size,
    });
    return;
  }

  if (
    request.method === 'GET' &&
    (url.pathname === '/sse' || url.pathname === '/browser-bridge/sse')
  ) {
    handleSse(request, response);
    return;
  }

  if (
    request.method === 'POST' &&
    (url.pathname === '/messages' ||
      url.pathname === '/message' ||
      url.pathname === '/browser-bridge/messages')
  ) {
    void handleMcpPost(request, response, url);
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}

const server = createServer(handleHttp);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const isBridgePath =
    url.pathname === '/browser-bridge' || url.pathname === '/ws' || url.pathname === '/';

  if (!isBridgePath || !safeEqual(String(tokenFromRequest(request)), AUTH_TOKEN)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws) => {
  if (bridgeSocket && bridgeSocket.readyState === bridgeSocket.OPEN) {
    bridgeSocket.close(1012, 'Replaced by newer browser bridge connection');
  }

  bridgeSocket = ws;
  bridgeSocket.isAlive = true;
  bridgeConnectedAt = Date.now();

  ws.on('message', handleBridgeMessage);
  ws.on('close', () => {
    if (bridgeSocket === ws) {
      bridgeSocket = undefined;
      bridgeConnectedAt = undefined;
      closePending('Browser bridge extension disconnected');
    }
  });
  ws.on('error', () => {});
  ws.send(JSON.stringify({ type: 'bridge.ready' }));
});

setInterval(() => {
  if (!bridgeSocket) {
    return;
  }

  if (bridgeSocket.isAlive === false) {
    bridgeSocket.terminate();
    return;
  }

  bridgeSocket.isAlive = false;
  bridgeSocket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
}, HEARTBEAT_MS).unref();

server.listen(PORT, HOST, () => {
  console.log(`Browser Bridge relay listening at http://${HOST}:${PORT}`);
  console.log(`Extension WebSocket path: /browser-bridge`);
  console.log(`MCP SSE endpoint: http://${HOST}:${PORT}/sse`);
  console.log(`Auth token: ${TOKEN_PATH}`);
});

function shutdown() {
  closePending('Browser Bridge relay shutting down');
  for (const client of sseClients.values()) {
    client.response.end();
  }
  bridgeSocket?.close(1001, 'Server shutting down');
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
