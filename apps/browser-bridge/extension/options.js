const fields = ['serverUrl', 'authToken', 'autoConnect'];
chrome.storage.sync.get({ serverUrl: '', authToken: '', autoConnect: false }).then((settings) => {
  for (const key of fields) {
    const el = document.getElementById(key);
    if (el.type === 'checkbox') el.checked = settings[key];
    else el.value = settings[key] || '';
  }
});
document.getElementById('save').addEventListener('click', async () => {
  const settings = {
    serverUrl: document.getElementById('serverUrl').value.trim(),
    authToken: document.getElementById('authToken').value.trim(),
    autoConnect: document.getElementById('autoConnect').checked,
  };
  await chrome.runtime.sendMessage({ type: 'save_settings', settings });
  document.getElementById('status').textContent = 'Saved';
});
