// i18n: apply localized text to all data-i18n elements
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = chrome.i18n.getMessage(el.getAttribute('data-i18n-title'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = chrome.i18n.getMessage(el.getAttribute('data-i18n-placeholder'));
  });
}
applyI18n();

const msg = (key, ...subs) => chrome.i18n.getMessage(key, subs);

const recordBtn = document.getElementById('record-btn');
const statusBar = document.getElementById('status-bar');
const timerEl = document.getElementById('timer');
const settingsBtn = document.getElementById('settings-btn');
const logEl = document.getElementById('log');
const audioToggle = document.getElementById('audio-toggle');
const savePrompt = document.getElementById('save-prompt');
const saveInfo = document.getElementById('save-info');
const saveBtn = document.getElementById('save-btn');
const discardBtn = document.getElementById('discard-btn');
const staffSelect = document.getElementById('staff-select');
const staffSelectRow = document.getElementById('staff-select-row');
const audioLevelEl = document.getElementById('audio-level');
const audioIconEl = document.getElementById('audio-icon');
const transcriptionToggle = document.getElementById('transcription-toggle');
const aiAnalysisToggle = document.getElementById('ai-analysis-toggle');
const modeMinutes = document.getElementById('mode-minutes');
const modeFeedback = document.getElementById('mode-feedback');
const analysisModeRow = document.getElementById('analysis-mode-row');
const planBadge = document.getElementById('plan-badge');
const upgradeBanner = document.getElementById('upgrade-banner');
const upgradeLink = document.getElementById('upgrade-link');
const limitUpgradeLink = document.getElementById('limit-upgrade-link');
const planLimitMsg = document.getElementById('plan-limit-msg');
const lockTranscription = document.getElementById('lock-transcription');
const lockAi = document.getElementById('lock-ai');
const planLimitBadge = document.getElementById('plan-limit-badge');

const CHECKOUT_URL = 'https://recording-pro.lemonsqueezy.com/checkout';

let currentPlan = 'free';

function updateAiToggleState() {
  if (!transcriptionToggle.checked) {
    aiAnalysisToggle.checked = false;
    aiAnalysisToggle.disabled = true;
    aiAnalysisToggle.parentElement.setAttribute('data-disabled', '');
  } else {
    aiAnalysisToggle.disabled = false;
    aiAnalysisToggle.parentElement.removeAttribute('data-disabled');
  }
  analysisModeRow.classList.toggle('hidden', !aiAnalysisToggle.checked);
}

function saveOutputOptions() {
  chrome.storage.local.set({
    outputOptions: {
      transcription: transcriptionToggle.checked,
      aiAnalysis: aiAnalysisToggle.checked,
      modeMinutes: modeMinutes.checked,
      modeFeedback: modeFeedback.checked
    }
  });
}

transcriptionToggle.addEventListener('change', () => {
  updateAiToggleState();
  saveOutputOptions();
});

aiAnalysisToggle.addEventListener('change', () => {
  updateAiToggleState();
  saveOutputOptions();
});

modeMinutes.addEventListener('change', () => { saveOutputOptions(); });
modeFeedback.addEventListener('change', () => { saveOutputOptions(); });

function updatePlanUI(plan) {
  currentPlan = plan;
  const isFree = plan === 'free';

  // バッジ更新
  planBadge.textContent = plan.toUpperCase();
  planBadge.className = `plan-badge ${plan}`;
  planLimitBadge.textContent = isFree ? msg('freePlanLimit') : msg('proPlanLimit');

  // Pro機能ロック
  if (isFree) {
    transcriptionToggle.checked = false;
    transcriptionToggle.disabled = true;
    aiAnalysisToggle.checked = false;
    aiAnalysisToggle.disabled = true;
    lockTranscription.classList.remove('hidden');
    lockAi.classList.remove('hidden');
    upgradeBanner.classList.remove('hidden');
  } else {
    transcriptionToggle.disabled = false;
    aiAnalysisToggle.disabled = false;
    lockTranscription.classList.add('hidden');
    lockAi.classList.add('hidden');
    upgradeBanner.classList.add('hidden');
  }

  updateAiToggleState();
}

// プラン状態を取得
chrome.runtime.sendMessage({ type: 'get-plan-status' }, (response) => {
  if (response?.plan) {
    updatePlanUI(response.plan);
  }
});

// アップグレードリンク
upgradeLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: CHECKOUT_URL });
});
limitUpgradeLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: CHECKOUT_URL });
});

let selectedMode = 'screen';
let isRecording = false;
let timerInterval = null;

chrome.storage.local.get(['staffList', 'outputOptions'], (settings) => {
  // 出力オプションの復元
  const opts = settings.outputOptions || {};
  if (opts.transcription) transcriptionToggle.checked = true;
  if (opts.aiAnalysis) aiAnalysisToggle.checked = true;
  if (opts.modeMinutes !== undefined) modeMinutes.checked = opts.modeMinutes;
  if (opts.modeFeedback !== undefined) modeFeedback.checked = opts.modeFeedback;
  updateAiToggleState();

  const list = settings.staffList || [];
  if (list.length > 0) {
    staffSelectRow.classList.remove('hidden');
    list.forEach(staff => {
      const opt = document.createElement('option');
      opt.value = staff.folderId;
      opt.textContent = staff.name;
      staffSelect.appendChild(opt);
    });
  }
});

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (isRecording) return;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMode = btn.dataset.mode;
  });
});

recordBtn.addEventListener('click', () => {
  if (isRecording) {
    chrome.runtime.sendMessage({ type: 'stop-capture' });
    stopUI();
  } else {
    const req = {
      type: 'start-capture',
      mode: selectedMode,
      audio: audioToggle.checked
    };
    if (staffSelect.value) {
      req.staffFolderId = staffSelect.value;
    }
    chrome.runtime.sendMessage(req);
    addLog(msg('preparing'), 'info');
  }
});

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'recording-started':
      startUI();
      addLog(msg('recordingStarted'), 'success');
      break;
    case 'recording-pending':
      showSavePrompt(message.filename, message.size);
      break;
    case 'recording-saved':
      addLog(msg('saved', message.filename, formatSize(message.size)), 'success');
      break;
    case 'upload-start':
      addLog(msg('uploading', message.filename), 'info');
      break;
    case 'upload-complete':
      addLog(msg('uploadComplete', message.filename), 'success');
      break;
    case 'analysis-start':
      addLog(msg('analysisRunning'), 'info');
      break;
    case 'analysis-complete':
      addLog(msg('analysisComplete'), 'success');
      break;
    case 'audio-level':
      if (audioLevelEl) {
        audioLevelEl.style.width = message.level + '%';
        if (message.level > 50) {
          audioLevelEl.style.backgroundColor = '#f59e0b';
        } else {
          audioLevelEl.style.backgroundColor = '#34d399';
        }
      }
      if (audioIconEl) {
        audioIconEl.textContent = message.level > 3 ? '\u{1f50a}' : '\u{1f507}';
      }
      break;
    case 'plan-info':
      if (message.plan) updatePlanUI(message.plan);
      break;
    case 'plan-limit-reached':
      planLimitMsg.classList.remove('hidden');
      break;
    case 'capture-cancelled':
      addLog(msg('captureCancelled'), 'info');
      break;
    case 'error':
      if (message.message && message.message.includes('Permission dismissed')) {
        chrome.tabs.create({ url: chrome.runtime.getURL(`permissions/camera.html?audio=${audioToggle.checked}`) });
        addLog(msg('cameraPermission'), 'info');
      } else {
        addLog(msg('error', message.message), 'error');
      }
      stopUI();
      break;
  }
});

function startUI(startTime) {
  isRecording = true;
  recordBtn.classList.add('recording');
  recordBtn.querySelector('[data-i18n]').textContent = msg('stopRecording');
  statusBar.classList.remove('hidden');
  let seconds = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
  const updateTimer = () => {
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
  };
  updateTimer();
  timerInterval = setInterval(() => {
    seconds++;
    updateTimer();
  }, 1000);
}

function stopUI() {
  isRecording = false;
  recordBtn.classList.remove('recording');
  recordBtn.querySelector('[data-i18n]').textContent = msg('startRecording');
  statusBar.classList.add('hidden');
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerEl.textContent = '00:00';
}

saveBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'confirm-save',
    transcription: transcriptionToggle.checked,
    aiAnalysis: aiAnalysisToggle.checked,
    modeMinutes: modeMinutes.checked,
    modeFeedback: modeFeedback.checked
  });
  savePrompt.classList.add('hidden');
  addLog(msg('saving'), 'info');
});

discardBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'discard-recording' });
  savePrompt.classList.add('hidden');
  addLog(msg('discarded'), 'info');
});

function showSavePrompt(filename, size) {
  saveInfo.textContent = msg('saveConfirm', filename, formatSize(size));
  savePrompt.classList.remove('hidden');
}

function addLog(text, type = '') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `${new Date().toLocaleTimeString('ja-JP')} ${text}`;
  logEl.prepend(entry);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

chrome.runtime.sendMessage({ type: 'get-status' }, (response) => {
  if (response?.isRecording) {
    startUI(response.startTime);
  } else if (response?.pending) {
    showSavePrompt(response.pending.filename, response.pending.size);
  }
});
