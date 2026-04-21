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

let selectedMode = 'screen';
let isRecording = false;
let timerInterval = null;

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
    chrome.runtime.sendMessage({
      type: 'start-capture',
      mode: selectedMode,
      audio: audioToggle.checked
    });
    addLog('録画を準備中...', 'info');
  }
});

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'recording-started':
      startUI();
      addLog('録画を開始しました', 'success');
      break;
    case 'recording-pending':
      showSavePrompt(message.filename, message.size);
      break;
    case 'recording-saved':
      addLog(`保存: ${message.filename} (${formatSize(message.size)})`, 'success');
      break;
    case 'upload-start':
      addLog(`Driveにアップロード中: ${message.filename}`, 'info');
      break;
    case 'upload-complete':
      addLog(`アップロード完了: ${message.filename}`, 'success');
      break;
    case 'analysis-start':
      addLog('AI分析を実行中...', 'info');
      break;
    case 'analysis-complete':
      addLog('AI分析が完了しました', 'success');
      break;
    case 'capture-cancelled':
      addLog('録画がキャンセルされました', 'info');
      break;
    case 'error':
      if (message.message && message.message.includes('Permission dismissed')) {
        chrome.tabs.create({ url: chrome.runtime.getURL(`permissions/camera.html?audio=${audioToggle.checked}`) });
        addLog('カメラ許可が必要です。許可ページを開きました。', 'info');
      } else {
        addLog(`エラー: ${message.message}`, 'error');
      }
      stopUI();
      break;
  }
});

function startUI(startTime) {
  isRecording = true;
  recordBtn.classList.add('recording');
  recordBtn.lastChild.textContent = '録画停止';
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
  recordBtn.lastChild.textContent = '録画開始';
  statusBar.classList.add('hidden');
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerEl.textContent = '00:00';
}

saveBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'confirm-save' });
  savePrompt.classList.add('hidden');
  addLog('録画を保存しています...', 'info');
});

discardBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'discard-recording' });
  savePrompt.classList.add('hidden');
  addLog('録画を破棄しました', 'info');
});

function showSavePrompt(filename, size) {
  saveInfo.textContent = `${filename} (${formatSize(size)}) を保存しますか？`;
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
