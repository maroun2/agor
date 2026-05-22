const connection = document.querySelector('#connection');
const approval = document.querySelector('#approval');
const history = document.querySelector('#history');
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'state_changed') render(message.state);
});
document.addEventListener('click', (event) => {
  const action = event.target?.dataset?.action;
  if (action === 'connect') chrome.runtime.sendMessage({ type: 'connect' });
  if (action === 'disconnect') chrome.runtime.sendMessage({ type: 'disconnect' });
  if (action === 'approve') chrome.runtime.sendMessage({ type: 'approval', approved: true });
  if (action === 'deny') chrome.runtime.sendMessage({ type: 'approval', approved: false });
});
chrome.runtime.sendMessage({ type: 'get_state' }, render);
function render(state) {
  if (!state) return;
  const server = hostLabel(state.serverUrl);
  connection.innerHTML = `<h2>Connection</h2>
    <div class="row"><span class="label">Server</span><code>${esc(server)}</code></div>
    <div class="row"><span class="label">Status</span><span class="status ${state.status}">${label(state)}</span></div>
    <div class="row"><span class="label">Auto-connect</span><span>${state.autoConnect ? 'ON' : 'OFF'}</span></div>
    <div class="actions"><button class="primary" data-action="connect">Connect</button><button data-action="disconnect">Disconnect</button></div>`;
  if (state.pendingApproval) {
    const d = state.pendingApproval.detail || {};
    approval.classList.remove('hidden');
    approval.innerHTML = `<h2>Pending approval</h2>
      <div class="row"><span class="label">Action</span><strong>${esc(d.action || state.pendingApproval.name)}</strong></div>
      <div class="row"><span class="label">Element</span><code>${esc(d.element || '—')}</code></div>
      <div class="row"><span class="label">Value</span><code>${esc(d.value || '—')}</code></div>
      <div class="row"><span class="label">Page</span><code>${esc(d.pageUrl || '—')}</code></div>
      <div class="actions"><button class="primary" data-action="approve">Approve</button><button class="danger" data-action="deny">Deny</button></div>`;
  } else {
    approval.classList.add('hidden');
    approval.innerHTML = '';
  }
  history.innerHTML =
    (state.history || [])
      .map(
        (item) =>
          `<li><span class="${item.status}">${esc(item.status.toUpperCase())}</span> ${esc(item.detail?.action || item.name)} <code>${esc(item.detail?.element || item.detail?.value || '')}</code></li>`
      )
      .join('') || '<li>No actions yet</li>';
}
function label(state) {
  if (state.status === 'connected') return `CONNECTED (${uptime(state.uptimeMs)})`;
  if (state.status === 'reconnecting') return `RECONNECTING (attempt ${state.reconnectAttempt})`;
  return state.status.toUpperCase();
}
function uptime(ms) {
  const s = Math.floor((ms || 0) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}
function esc(value) {
  return String(value ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
}

function hostLabel(raw) {
  try {
    return raw ? new URL(raw).host : 'not configured';
  } catch {
    return raw || 'not configured';
  }
}
