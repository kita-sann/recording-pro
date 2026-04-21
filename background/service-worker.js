import { uploadToDrive } from '../lib/drive-uploader.js';
import { analyzeRecording } from '../lib/ai-analyzer.js';

let isRecording = false;
let recordingStartTime = null;
let pendingRecording = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'get-status':
      sendResponse({
        isRecording,
        startTime: recordingStartTime
      });
      break;

    case 'start-capture':
      handleStartCapture(message.mode, message.audio);
      sendResponse({ success: true });
      break;

    case 'stop-capture':
      handleStopCapture();
      sendResponse({ success: true });
      break;

    case 'recording-started':
      isRecording = true;
      recordingStartTime = Date.now();
      updateIcon(true);
      break;

    case 'recording-complete':
      handleRecordingComplete(message.size);
      break;

    case 'confirm-save':
      if (pendingRecording) {
        processRecording(pendingRecording.filename, pendingRecording.size);
        pendingRecording = null;
      }
      sendResponse({ success: true });
      break;

    case 'discard-recording':
      pendingRecording = null;
      caches.delete('recording-pro-temp');
      sendResponse({ success: true });
      break;

    case 'recording-error':
      isRecording = false;
      recordingStartTime = null;
      updateIcon(false);
      notifyPopup({ type: 'error', message: message.error });
      break;
  }
  return true;
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
}

async function handleStartCapture(mode, audio) {
  try {
    await ensureOffscreenDocument();
    chrome.runtime.sendMessage({
      type: 'start-recording',
      mode,
      audio
    });
  } catch (error) {
    notifyPopup({ type: 'error', message: error.message });
  }
}

function handleStopCapture() {
  chrome.runtime.sendMessage({ type: 'stop-recording' });
  isRecording = false;
  recordingStartTime = null;
  updateIcon(false);
}

async function handleRecordingComplete(size) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `recording-${timestamp}.webm`;

  pendingRecording = { filename, size };

  notifyPopup({
    type: 'recording-pending',
    filename,
    size
  });
}

async function processRecording(filename, size) {
  notifyPopup({ type: 'recording-saved', filename, size });

  const cache = await caches.open('recording-pro-temp');
  const response = await cache.match('https://recording-pro.local/latest');
  if (!response) {
    notifyPopup({ type: 'error', message: '録画データの取得に失敗しました' });
    return;
  }
  const blob = await response.blob();
  await caches.delete('recording-pro-temp');

  const settings = await chrome.storage.local.get([
    'driveFolderId', 'driveEnabled', 'aiEnabled', 'aiProvider', 'aiApiKey'
  ]);

  if (settings.driveEnabled && settings.driveFolderId) {
    try {
      notifyPopup({ type: 'upload-start', filename });
      const fileId = await uploadToDrive(blob, filename, settings.driveFolderId);
      notifyPopup({ type: 'upload-complete', filename, fileId });

      if (settings.aiEnabled && settings.aiApiKey) {
        notifyPopup({ type: 'analysis-start', filename });
        const analysis = await analyzeRecording(blob, settings.aiProvider, settings.aiApiKey);
        const analysisFilename = `${filename.replace('.webm', '')}-analysis.txt`;
        const analysisBlob = new Blob([analysis], { type: 'text/plain' });
        await uploadToDrive(analysisBlob, analysisFilename, settings.driveFolderId);
        notifyPopup({ type: 'analysis-complete', filename, analysis });
      }
    } catch (error) {
      notifyPopup({ type: 'error', message: `アップロードエラー: ${error.message}` });
    }
  }
}

function updateIcon(recording) {
  chrome.action.setBadgeText({ text: recording ? 'REC' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#DC2626' });
}

function notifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}
