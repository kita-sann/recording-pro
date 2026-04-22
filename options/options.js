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

const staffListEl = document.getElementById('staff-list');
const staffNameInput = document.getElementById('staff-name-input');
const staffFolderInput = document.getElementById('staff-folder-input');
const staffAddBtn = document.getElementById('staff-add-btn');

// License elements
const optionsPlanBadge = document.getElementById('options-plan-badge');
const licenseActivateSection = document.getElementById('license-activate');
const licenseActiveSection = document.getElementById('license-active');
const licenseKeyInput = document.getElementById('license-key-input');
const licenseActivateBtn = document.getElementById('license-activate-btn');
const licenseDeactivateBtn = document.getElementById('license-deactivate-btn');
const licenseError = document.getElementById('license-error');
const licensePlanName = document.getElementById('license-plan-name');
const licenseExpires = document.getElementById('license-expires');
const licenseExpiresRow = document.getElementById('license-expires-row');
const optionsUpgradeLink = document.getElementById('options-upgrade-link');
const proTagDrive = document.getElementById('pro-tag-drive');
const proTagAi = document.getElementById('pro-tag-ai');
const sectionDrive = document.getElementById('section-drive');

const CHECKOUT_URL = 'https://recording-pro.lemonsqueezy.com/checkout';

let staffList = [];
let currentPlan = 'free';

function updateOptionsPlanUI(plan, expiresAt) {
  currentPlan = plan;
  const isFree = plan === 'free';

  optionsPlanBadge.textContent = plan.toUpperCase();
  optionsPlanBadge.className = `plan-badge-lg ${plan}`;

  if (isFree) {
    licenseActivateSection.classList.remove('hidden');
    licenseActiveSection.classList.add('hidden');
    proTagDrive.classList.remove('hidden');
    proTagAi.classList.remove('hidden');
    sectionDrive.classList.add('section-disabled');
  } else {
    licenseActivateSection.classList.add('hidden');
    licenseActiveSection.classList.remove('hidden');
    licensePlanName.textContent = plan === 'pro' ? 'Pro' : 'Team';
    if (expiresAt) {
      licenseExpires.textContent = new Date(expiresAt).toLocaleDateString('ja-JP');
      licenseExpiresRow.style.display = '';
    } else {
      licenseExpiresRow.style.display = 'none';
    }
    proTagDrive.classList.add('hidden');
    proTagAi.classList.add('hidden');
    sectionDrive.classList.remove('section-disabled');
  }
}

// Load plan status
chrome.runtime.sendMessage({ type: 'get-plan-status' }, (response) => {
  if (response?.plan) {
    updateOptionsPlanUI(response.plan, response.expiresAt);
  }
});

// Activate license
licenseActivateBtn.addEventListener('click', () => {
  const key = licenseKeyInput.value.trim();
  if (!key) return;

  licenseActivateBtn.disabled = true;
  licenseActivateBtn.textContent = '認証中...';
  licenseError.classList.add('hidden');

  chrome.runtime.sendMessage({ type: 'activate-license', key }, (result) => {
    licenseActivateBtn.disabled = false;
    licenseActivateBtn.textContent = '認証';

    if (result?.valid) {
      updateOptionsPlanUI(result.plan, result.expiresAt);
      licenseKeyInput.value = '';
    } else {
      licenseError.textContent = result?.error || 'ライセンスキーが無効です';
      licenseError.classList.remove('hidden');
    }
  });
});

// Deactivate license
licenseDeactivateBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'deactivate-license' }, () => {
    updateOptionsPlanUI('free');
  });
});

// Upgrade link
optionsUpgradeLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: CHECKOUT_URL });
});

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
  'videoQuality', 'staffList'
], (settings) => {
  driveEnabled.checked = settings.driveEnabled || false;
  driveFolderId.value = settings.driveFolderId || '';
  aiEnabled.checked = settings.aiEnabled || false;
  aiProvider.value = settings.aiProvider || 'openai';
  aiApiKey.value = settings.aiApiKey || '';
  anthropicApiKey.value = settings.anthropicApiKey || '';
  videoQuality.value = settings.videoQuality || '2500000';
  staffList = settings.staffList || [];

  if (settings.aiProvider === 'anthropic') {
    anthropicKeyField.style.display = 'block';
  }

  updateToggleStatus(driveEnabled, driveStatusEl);
  updateToggleStatus(aiEnabled, aiStatusEl);
  renderStaffList();
});

function renderStaffList() {
  staffListEl.innerHTML = '';
  staffList.forEach((staff, index) => {
    const item = document.createElement('div');
    item.className = 'staff-item';
    item.innerHTML = `
      <span class="staff-name">${escapeHtml(staff.name)}</span>
      <span class="staff-folder">${escapeHtml(staff.folderId)}</span>
      <button class="btn-remove" data-index="${index}" title="削除">&times;</button>
    `;
    staffListEl.appendChild(item);
  });
  staffListEl.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      staffList.splice(Number(btn.dataset.index), 1);
      renderStaffList();
    });
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

staffAddBtn.addEventListener('click', () => {
  const name = staffNameInput.value.trim();
  const folderId = staffFolderInput.value.trim();
  if (!name || !folderId) return;
  staffList.push({ name, folderId });
  staffNameInput.value = '';
  staffFolderInput.value = '';
  renderStaffList();
});

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set({
    driveEnabled: driveEnabled.checked,
    driveFolderId: driveFolderId.value.trim(),
    aiEnabled: aiEnabled.checked,
    aiProvider: aiProvider.value,
    aiApiKey: aiApiKey.value.trim(),
    anthropicApiKey: anthropicApiKey.value.trim(),
    videoQuality: videoQuality.value,
    staffList
  }, () => {
    saveStatus.textContent = '保存しました';
    setTimeout(() => {
      saveStatus.textContent = '';
    }, 2000);
  });
});
