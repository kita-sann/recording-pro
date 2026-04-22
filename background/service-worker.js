import { uploadToDrive } from '../lib/drive-uploader.js';
import { analyzeRecording } from '../lib/ai-analyzer.js';
import { getLicenseStatus, activateLicense, deactivateLicense } from '../lib/license.js';

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!isRecording) return;
  if (alarm.name === 'recording-warning') {
    notifyPopup({ type: 'error', message: '残り10分で録画が自動停止します' });
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Recording Pro',
      message: '残り10分で録画が自動停止します'
    });
  } else if (alarm.name === 'recording-auto-stop') {
    autoStopTriggered = true;
    getLicenseStatus().then(({ plan, features }) => {
      const maxMin = features.maxMinutes || 25;
      const msg = `${maxMin}分経過のため録画を自動停止しました`;
      handleStopCapture();
      notifyPopup({ type: 'error', message: msg });
      if (plan === 'free') {
        notifyPopup({ type: 'plan-limit-reached', maxMinutes: maxMin });
      }
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Recording Pro',
        message: msg
      });
    });
  }
});

let isRecording = false;
let recordingStartTime = null;
let pendingRecording = null;
let downloadResolve = null;
let currentStaffFolderId = null;
let autoStopTriggered = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'offscreen-ready':
    case 'recording-started':
      isRecording = true;
      recordingStartTime = Date.now();
      updateIcon(true);
      // アラームは handleStartCapture でプラン別に設定済み。ここでは上書きしない。
      return false;

    case 'recording-complete':
      handleRecordingComplete(message.size);
      return false;

    case 'recording-error':
      isRecording = false;
      recordingStartTime = null;
      updateIcon(false);
      notifyPopup({ type: 'error', message: message.error });
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Recording Pro - 録画エラー',
        message: message.error || '不明なエラー'
      });
      return false;

    case 'download-result':
      if (downloadResolve) {
        downloadResolve(message.success);
        downloadResolve = null;
      }
      return false;

    case 'get-status':
      sendResponse({
        isRecording,
        startTime: recordingStartTime,
        pending: pendingRecording
          ? { filename: pendingRecording.filename, size: pendingRecording.size }
          : null
      });
      return false;

    case 'start-capture':
      handleStartCapture(message.mode, message.audio, message.staffFolderId);
      sendResponse({ success: true });
      return false;

    case 'stop-capture':
      handleStopCapture();
      sendResponse({ success: true });
      return false;

    case 'confirm-save':
      if (pendingRecording) {
        processRecording(pendingRecording.filename, pendingRecording.size, pendingRecording.staffFolderId, {
          transcription: message.transcription || false,
          aiAnalysis: message.aiAnalysis || false,
          modeMinutes: message.modeMinutes !== false,
          modeFeedback: message.modeFeedback || false
        });
        pendingRecording = null;
      }
      sendResponse({ success: true });
      return false;

    case 'discard-recording':
      pendingRecording = null;
      caches.delete('recording-pro-temp');
      sendResponse({ success: true });
      return false;

    case 'get-plan-status':
      getLicenseStatus().then(status => sendResponse(status));
      return true; // async sendResponse

    case 'activate-license':
      activateLicense(message.key).then(result => sendResponse(result));
      return true;

    case 'deactivate-license':
      deactivateLicense().then(() => sendResponse({ success: true }));
      return true;

    default:
      return false;
  }
});

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'],
    justification: 'Recording screen and camera'
  });

  for (let i = 0; i < 20; i++) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'ping' });
      if (resp?.ready) return;
    } catch (_) { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
}

async function handleStartCapture(mode, audio, staffFolderId) {
  try {
    currentStaffFolderId = staffFolderId || null;

    // プラン別の録画時間制限
    const { plan, features } = await getLicenseStatus();
    const maxMin = features.maxMinutes || 25;
    const warnMin = Math.max(maxMin - 10, 1);

    await ensureOffscreenDocument();
    chrome.runtime.sendMessage({
      type: 'start-recording',
      mode,
      audio
    });

    // プランに応じたアラーム設定（recording-started でセットしていたものを上書き）
    chrome.alarms.clear('recording-warning');
    chrome.alarms.clear('recording-auto-stop');
    chrome.alarms.create('recording-warning', { delayInMinutes: warnMin });
    chrome.alarms.create('recording-auto-stop', { delayInMinutes: maxMin });

    notifyPopup({ type: 'plan-info', plan, maxMinutes: maxMin });
  } catch (error) {
    notifyPopup({ type: 'error', message: error.message });
  }
}

function handleStopCapture() {
  chrome.runtime.sendMessage({ type: 'stop-recording' });
  isRecording = false;
  recordingStartTime = null;
  updateIcon(false);
  chrome.alarms.clear('recording-warning');
  chrome.alarms.clear('recording-auto-stop');
}

async function handleRecordingComplete(size) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `recording-${timestamp}.webm`;
  const staffFolderId = currentStaffFolderId;
  currentStaffFolderId = null;

  if (autoStopTriggered) {
    autoStopTriggered = false;
    processRecording(filename, size, staffFolderId, {
      transcription: false,
      aiAnalysis: false,
      modeMinutes: false,
      modeFeedback: false
    });
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Recording Pro',
      message: '自動停止した録画をDriveに保存しています'
    });
    return;
  }

  pendingRecording = { filename, size, staffFolderId };

  notifyPopup({
    type: 'recording-pending',
    filename,
    size
  });
}

async function processRecording(filename, size, staffFolderId, outputOptions = {}) {
  // ローカルダウンロード（offscreenドキュメント経由でBlob URL使用）
  try {
    await ensureOffscreenDocument();
    const downloadOk = await new Promise((resolve) => {
      downloadResolve = resolve;
      chrome.runtime.sendMessage({ type: 'download-recording', filename }).catch(() => {});
      setTimeout(() => { if (downloadResolve) { downloadResolve(false); downloadResolve = null; } }, 10000);
    });
    if (!downloadOk) {
      notifyPopup({ type: 'error', message: '録画データの取得に失敗しました' });
      return;
    }
    notifyPopup({ type: 'recording-saved', filename, size });
  } catch (error) {
    notifyPopup({ type: 'error', message: `ダウンロードエラー: ${error.message}` });
    return;
  }

  // プランチェック
  const { features } = await getLicenseStatus();

  // Drive アップロード（設定時のみ）
  const settings = await chrome.storage.local.get([
    'driveFolderId', 'driveEnabled', 'aiEnabled', 'aiProvider', 'aiApiKey', 'anthropicApiKey'
  ]);

  const targetFolderId = staffFolderId || settings.driveFolderId;

  if (settings.driveEnabled && targetFolderId && features.drive) {
    try {
      const cache = await caches.open('recording-pro-temp');
      const response = await cache.match('https://recording-pro.local/latest');
      if (!response) {
        notifyPopup({ type: 'error', message: 'Drive: キャッシュからデータを取得できませんでした' });
        return;
      }
      const blob = await response.blob();

      notifyPopup({ type: 'upload-start', filename });
      const fileId = await uploadToDrive(blob, filename, targetFolderId);
      notifyPopup({ type: 'upload-complete', filename, fileId });

      if (features.ai && settings.aiApiKey && (outputOptions.transcription || outputOptions.aiAnalysis)) {
        const label = outputOptions.aiAnalysis ? 'AI分析' : '文字起こし';
        notifyPopup({ type: 'analysis-start', filename });
        const result = await analyzeRecording(blob, settings.aiProvider, settings.aiApiKey, settings.anthropicApiKey, {
          transcription: outputOptions.transcription || outputOptions.aiAnalysis,
          aiAnalysis: outputOptions.aiAnalysis,
          modeMinutes: outputOptions.modeMinutes,
          modeFeedback: outputOptions.modeFeedback
        });
        if (result) {
          const suffix = outputOptions.aiAnalysis ? '-analysis.txt' : '-transcript.txt';
          const resultFilename = `${filename.replace('.webm', '')}${suffix}`;
          const resultBlob = new Blob([result], { type: 'text/plain' });
          await uploadToDrive(resultBlob, resultFilename, targetFolderId);
          notifyPopup({ type: 'analysis-complete', filename, analysis: result });
        }
      }

      await caches.delete('recording-pro-temp');
    } catch (error) {
      notifyPopup({ type: 'error', message: `アップロードエラー: ${error.message}` });
    }
  } else {
    await caches.delete('recording-pro-temp');
  }
}

function updateIcon(recording) {
  chrome.action.setBadgeText({ text: recording ? 'REC' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#DC2626' });
}

function notifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    if (message.type === 'error' || message.type === 'upload-complete' || message.type === 'recording-saved') {
      const text = message.type === 'error'
        ? `エラー: ${message.message}`
        : message.type === 'upload-complete'
          ? `Drive アップロード完了: ${message.filename}`
          : `保存完了: ${message.filename}`;
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Recording Pro',
        message: text
      });
    }
  });
}
