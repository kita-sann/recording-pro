const driveEnabled = document.getElementById('drive-enabled');
const driveFolderId = document.getElementById('drive-folder-id');
const aiEnabled = document.getElementById('ai-enabled');
const aiProvider = document.getElementById('ai-provider');
const aiApiKey = document.getElementById('ai-api-key');
const anthropicApiKey = document.getElementById('anthropic-api-key');
const anthropicKeyField = document.getElementById('anthropic-key-field');
const videoQuality = document.getElementById('video-quality');
const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');

const driveStatusEl = document.getElementById('drive-status');
const aiStatusEl = document.getElementById('ai-status');

function updateToggleStatus(checkbox, statusEl) {
  if (checkbox.checked) {
    statusEl.textContent = 'ON';
    statusEl.className = 'toggle-status on';
  } else {
    statusEl.textContent = 'OFF';
    statusEl.className = 'toggle-status off';
  }
}

driveEnabled.addEventListener('change', () => updateToggleStatus(driveEnabled, driveStatusEl));
aiEnabled.addEventListener('change', () => updateToggleStatus(aiEnabled, aiStatusEl));

aiProvider.addEventListener('change', () => {
  anthropicKeyField.style.display = aiProvider.value === 'anthropic' ? 'block' : 'none';
});

chrome.storage.local.get([
  'driveEnabled', 'driveFolderId',
  'aiEnabled', 'aiProvider', 'aiApiKey', 'anthropicApiKey',
  'videoQuality'
], (settings) => {
  driveEnabled.checked = settings.driveEnabled || false;
  driveFolderId.value = settings.driveFolderId || '';
  aiEnabled.checked = settings.aiEnabled || false;
  aiProvider.value = settings.aiProvider || 'openai';
  aiApiKey.value = settings.aiApiKey || '';
  anthropicApiKey.value = settings.anthropicApiKey || '';
  videoQuality.value = settings.videoQuality || '2500000';

  if (settings.aiProvider === 'anthropic') {
    anthropicKeyField.style.display = 'block';
  }

  updateToggleStatus(driveEnabled, driveStatusEl);
  updateToggleStatus(aiEnabled, aiStatusEl);
});

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set({
    driveEnabled: driveEnabled.checked,
    driveFolderId: driveFolderId.value.trim(),
    aiEnabled: aiEnabled.checked,
    aiProvider: aiProvider.value,
    aiApiKey: aiApiKey.value.trim(),
    anthropicApiKey: anthropicApiKey.value.trim(),
    videoQuality: videoQuality.value
  }, () => {
    saveStatus.textContent = '保存しました';
    setTimeout(() => {
      saveStatus.textContent = '';
    }, 2000);
  });
});
