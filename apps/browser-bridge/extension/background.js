const DEFAULTS = { serverUrl: '', authToken: '', autoConnect: false };
const READ_ONLY = new Set([
  'browser_snapshot',
  'browser_get_text',
  'browser_screenshot',
  'browser_wait',
]);

const MCP_TOOLS = [
  mcpTool('browser_snapshot', 'Get current page URL, title, and page text.', {}, true),
  mcpTool(
    'browser_get_text',
    'Get visible text for selector, or page body text when omitted.',
    { selector: { type: 'string' } },
    true
  ),
  mcpTool('browser_screenshot', 'Capture visible tab screenshot as PNG.', {}, true),
  mcpTool('browser_navigate', 'Navigate active tab to URL.', { url: { type: 'string' } }, false, [
    'url',
  ]),
  mcpTool(
    'browser_click',
    'Click element matching selector or element description.',
    { selector: { type: 'string' }, element: { type: 'string' } },
    false
  ),
  mcpTool(
    'browser_type',
    'Type text into element matching selector or element description.',
    { selector: { type: 'string' }, element: { type: 'string' }, text: { type: 'string' } },
    false,
    ['text']
  ),
  mcpTool(
    'browser_press_key',
    'Press a keyboard key in active tab.',
    { key: { type: 'string' } },
    false,
    ['key']
  ),
  mcpTool('browser_wait', 'Wait specified seconds.', { time: { type: 'number' } }, true, ['time']),
];
function mcpTool(name, description, properties, readOnly, required = []) {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties, required },
    annotations: readOnly ? { readOnlyHint: true } : { destructiveHint: true },
  };
}
let socket;
const state = {
  status: 'disconnected',
  serverUrl: '',
  autoConnect: false,
  startedAt: 0,
  reconnectAttempt: 0,
  manualDisconnect: false,
  pendingApproval: null,
  history: [],
};
let reconnectTimer;
let approvalTimer;

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
chrome.alarms.create('browserBridgePing', { periodInMinutes: 25 / 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'browserBridgePing' && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'ping', time: Date.now() }));
  }
});
chrome.action.onClicked.addListener(async () => {
  await chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true });
  await chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'get_state') return snapshot();
    if (message?.type === 'save_settings') return saveSettings(message.settings || {});
    if (message?.type === 'connect') return connect({ manual: true });
    if (message?.type === 'disconnect') return disconnect(true);
    if (message?.type === 'approval') return resolveApproval(message.approved);
    return { ok: false, error: 'Unknown message' };
  })().then(sendResponse, (error) =>
    sendResponse({ ok: false, error: String(error?.message || error) })
  );
  return true;
});

init();

async function init() {
  const settings = await getSettings();
  state.serverUrl = settings.serverUrl;
  state.autoConnect = settings.autoConnect;
  broadcast();
  if (settings.autoConnect && settings.serverUrl) connect({ manual: false });
}

async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

async function saveSettings(settings) {
  const next = {
    serverUrl: String(settings.serverUrl || '').trim(),
    authToken: String(settings.authToken || '').trim(),
    autoConnect: !!settings.autoConnect,
  };
  await chrome.storage.sync.set(next);
  state.serverUrl = next.serverUrl;
  state.autoConnect = next.autoConnect;
  broadcast();
  return { ok: true, state: snapshot() };
}

async function connect({ manual }) {
  const settings = await getSettings();
  if (!settings.serverUrl) return { ok: false, error: 'Server URL missing' };
  if (manual) state.manualDisconnect = false;
  clearTimeout(reconnectTimer);
  setStatus(state.reconnectAttempt ? 'reconnecting' : 'connecting');
  const url = withToken(settings.serverUrl, settings.authToken);
  socket?.close();
  socket = new WebSocket(url);
  socket.onopen = () => {
    state.startedAt = Date.now();
    state.reconnectAttempt = 0;
    setStatus('connected');
  };
  socket.onmessage = (event) => handleServerMessage(event.data);
  socket.onclose = () => {
    setStatus('disconnected');
    if (!state.manualDisconnect && state.autoConnect) scheduleReconnect();
  };
  socket.onerror = () => {
    setStatus('disconnected');
  };
  return { ok: true, state: snapshot() };
}

async function disconnect(manual) {
  state.manualDisconnect = manual;
  clearTimeout(reconnectTimer);
  if (manual) await chrome.storage.sync.set({ autoConnect: false });
  state.autoConnect = manual ? false : state.autoConnect;
  socket?.close(1000, 'Disconnected by user');
  setStatus('disconnected');
  return { ok: true, state: snapshot() };
}

function scheduleReconnect() {
  state.reconnectAttempt += 1;
  setStatus('reconnecting');
  const delay = Math.min(60000, 2 ** state.reconnectAttempt * 1000);
  reconnectTimer = setTimeout(() => connect({ manual: false }), delay);
}

function withToken(rawUrl, token) {
  const url = new URL(rawUrl);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

function setStatus(status) {
  state.status = status;
  broadcast();
}

function snapshot() {
  return { ...state, uptimeMs: state.startedAt ? Date.now() - state.startedAt : 0 };
}

function broadcast() {
  chrome.runtime.sendMessage({ type: 'state_changed', state: snapshot() }).catch(() => {});
}

async function handleServerMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (message.type === 'ping') return send({ type: 'pong', time: Date.now() });
  if (message.type === 'mcp.request') return handleMcpRequest(message);
  if (message.type !== 'tool_call') return;
  const detail = await describeAction(message);
  addHistory({
    id: message.id,
    name: message.name,
    detail,
    status: READ_ONLY.has(message.name) || message.readOnly ? 'running' : 'waiting',
    time: Date.now(),
  });
  if (message.destructive && !READ_ONLY.has(message.name)) {
    state.pendingApproval = {
      id: message.id,
      name: message.name,
      args: message.arguments || {},
      detail,
      createdAt: Date.now(),
    };
    broadcast();
    clearTimeout(approvalTimer);
    approvalTimer = setTimeout(() => denyPending('Approval timed out after 60s'), 60000);
    return;
  }
  executeAndReply(message);
}

async function handleMcpRequest(message) {
  const request = message.payload || {};
  const id = request.id ?? null;
  try {
    if (request.method === 'initialize') {
      return sendMcpResponse(message, {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: request.params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'agor-browser-bridge-extension', version: '0.1.0' },
        },
      });
    }
    if (request.method === 'notifications/initialized') {
      return sendMcpResponse(message, { jsonrpc: '2.0', id, result: {} });
    }
    if (request.method === 'tools/list') {
      return sendMcpResponse(message, { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } });
    }
    if (request.method === 'tools/call') {
      const name = request.params?.name;
      const args = request.params?.arguments || {};
      const tool = MCP_TOOLS.find((item) => item.name === name);
      if (!tool)
        return sendMcpResponse(message, {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true },
        });
      const bridgeId = message.id || message.requestId;
      const detail = await describeAction({ name, arguments: args });
      addHistory({
        id: bridgeId,
        name,
        detail,
        status: tool.annotations?.readOnlyHint ? 'running' : 'waiting',
        time: Date.now(),
      });
      if (tool.annotations?.destructiveHint) {
        state.pendingApproval = {
          id: bridgeId,
          mcpId: id,
          name,
          args,
          detail,
          createdAt: Date.now(),
          mcpRequest: true,
        };
        broadcast();
        clearTimeout(approvalTimer);
        approvalTimer = setTimeout(() => denyPending('Approval timed out after 60s'), 60000);
        return;
      }
      const result = await executeTool(name, args);
      updateHistory(bridgeId, 'ok');
      return sendMcpResponse(message, { jsonrpc: '2.0', id, result: normalizeMcpResult(result) });
    }
    return sendMcpResponse(message, {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${request.method}` },
    });
  } catch (error) {
    updateHistory(message.id || message.requestId, 'error');
    return sendMcpResponse(message, {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: String(error?.message || error) }], isError: true },
    });
  } finally {
    broadcast();
  }
}

function sendMcpResponse(message, payload) {
  send({
    type: 'mcp.response',
    id: message.id || message.requestId,
    requestId: message.requestId || message.id,
    payload,
  });
}

function normalizeMcpResult(result) {
  if (result?.content) return result;
  if (result?.image)
    return { content: [{ type: 'image', data: result.image, mimeType: 'image/png' }] };
  return {
    content: [
      { type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) },
    ],
  };
}

async function resolveApproval(approved) {
  const pending = state.pendingApproval;
  if (!pending) return { ok: false, error: 'No pending approval' };
  clearTimeout(approvalTimer);
  state.pendingApproval = null;
  if (!approved) {
    updateHistory(pending.id, 'denied');
    if (pending.mcpRequest) {
      send({
        type: 'mcp.response',
        id: pending.id,
        requestId: pending.id,
        payload: {
          jsonrpc: '2.0',
          id: pending.mcpId ?? null,
          result: { content: [{ type: 'text', text: 'Denied by user' }], isError: true },
        },
      });
    } else {
      send({ type: 'tool_result', id: pending.id, ok: false, error: 'Denied by user' });
    }
    broadcast();
    return { ok: true };
  }
  updateHistory(pending.id, 'approved');
  if (pending.mcpRequest) {
    try {
      const result = await executeTool(pending.name, pending.args);
      updateHistory(pending.id, 'ok');
      send({
        type: 'mcp.response',
        id: pending.id,
        requestId: pending.id,
        payload: { jsonrpc: '2.0', id: pending.mcpId ?? null, result: normalizeMcpResult(result) },
      });
    } catch (error) {
      updateHistory(pending.id, 'error');
      send({
        type: 'mcp.response',
        id: pending.id,
        requestId: pending.id,
        payload: {
          jsonrpc: '2.0',
          id: pending.mcpId ?? null,
          result: {
            content: [{ type: 'text', text: String(error?.message || error) }],
            isError: true,
          },
        },
      });
    }
  } else {
    executeAndReply({ id: pending.id, name: pending.name, arguments: pending.args });
  }
  broadcast();
  return { ok: true };
}

function denyPending(error) {
  const pending = state.pendingApproval;
  if (!pending) return;
  state.pendingApproval = null;
  updateHistory(pending.id, 'timeout');
  if (pending.mcpRequest) {
    send({
      type: 'mcp.response',
      id: pending.id,
      requestId: pending.id,
      payload: {
        jsonrpc: '2.0',
        id: pending.mcpId ?? null,
        result: { content: [{ type: 'text', text: error }], isError: true },
      },
    });
  } else {
    send({ type: 'tool_result', id: pending.id, ok: false, error });
  }
  broadcast();
}

async function executeAndReply(message) {
  try {
    updateHistory(message.id, 'running');
    const result = await executeTool(message.name, message.arguments || {});
    updateHistory(message.id, 'ok');
    send({ type: 'tool_result', id: message.id, ok: true, result });
  } catch (error) {
    updateHistory(message.id, 'error');
    send({
      type: 'tool_result',
      id: message.id,
      ok: false,
      error: String(error?.message || error),
    });
  } finally {
    broadcast();
  }
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return tab;
}

async function executeTool(name, args) {
  if (name === 'browser_wait') {
    await new Promise((resolve) => setTimeout(resolve, Number(args.time || 1) * 1000));
    return `Waited ${args.time || 1}s`;
  }
  const tab = await activeTab();
  if (name === 'browser_navigate') {
    await chrome.tabs.update(tab.id, { url: args.url });
    return `Navigated to ${args.url}`;
  }
  if (name === 'browser_screenshot') {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { image: dataUrl.replace(/^data:image\/png;base64,/, '') };
  }
  if (name === 'browser_snapshot') return runScript(tab.id, pageSnapshot, []);
  if (name === 'browser_get_text') return runScript(tab.id, getText, [args.selector || 'body']);
  if (name === 'browser_click')
    return runScript(tab.id, clickElement, [args.selector, args.element]);
  if (name === 'browser_type')
    return runScript(tab.id, typeIntoElement, [args.selector, args.element, args.text || '']);
  if (name === 'browser_press_key') return runScript(tab.id, pressKey, [args.key || 'Enter']);
  throw new Error(`Unknown tool: ${name}`);
}

async function runScript(tabId, func, args) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  if (result?.result === undefined) throw new Error('Script returned no result');
  return result.result;
}

async function describeAction(message) {
  const tab = await activeTab().catch(() => null);
  return {
    action: message.name.replace(/^browser_/, '').toUpperCase(),
    element: message.arguments?.selector || message.arguments?.element || '',
    value: message.arguments?.text || message.arguments?.url || message.arguments?.key || '',
    pageUrl: tab?.url || '',
    title: tab?.title || '',
  };
}

function addHistory(item) {
  state.history = [item, ...state.history.filter((entry) => entry.id !== item.id)].slice(0, 20);
  broadcast();
}

function updateHistory(id, status) {
  state.history = state.history.map((entry) => (entry.id === id ? { ...entry, status } : entry));
}

function findElement(selector, description) {
  let element = selector ? document.querySelector(selector) : null;
  if (element) return element;
  const needle = String(description || '').toLowerCase();
  if (!needle) throw new Error('Selector or element description required');
  element = [
    ...document.querySelectorAll('button,a,input,textarea,select,[role="button"],[aria-label]'),
  ].find((candidate) =>
    `${candidate.textContent || ''} ${candidate.getAttribute('aria-label') || ''} ${candidate.id || ''}`
      .toLowerCase()
      .includes(needle)
  );
  if (!element) throw new Error(`Element not found: ${description || selector}`);
  return element;
}

function pageSnapshot() {
  return {
    url: location.href,
    title: document.title,
    text: document.body?.innerText?.slice(0, 12000) || '',
  };
}

function getText(selector) {
  return (
    document.querySelector(selector)?.innerText ||
    document.querySelector(selector)?.textContent ||
    ''
  ).slice(0, 12000);
}

function clickElement(selector, description) {
  const element = findElement(selector, description);
  element.scrollIntoView({ block: 'center', inline: 'center' });
  element.click();
  return `Clicked ${selector || description}`;
}

function typeIntoElement(selector, description, text) {
  const element = findElement(selector, description);
  element.scrollIntoView({ block: 'center', inline: 'center' });
  element.focus();
  element.value = text;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return `Typed into ${selector || description}`;
}

function pressKey(key) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true });
  (document.activeElement || document.body).dispatchEvent(event);
  return `Pressed ${key}`;
}
