let mediaRecorder = null;
let recordedChunks = [];
let activeStreams = [];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'ping':
      sendResponse({ ready: true });
      return false;
    case 'start-recording':
      startRecording(message.mode, message.audio);
      sendResponse({ success: true });
      return false;
    case 'stop-recording':
      stopRecording();
      sendResponse({ success: true });
      return false;
    case 'download-recording':
      downloadFromCache(message.filename);
      return false;
  }
});

async function downloadFromCache(filename) {
  try {
    const cache = await caches.open('recording-pro-temp');
    const response = await cache.match('https://recording-pro.local/latest');
    if (!response) {
      chrome.runtime.sendMessage({ type: 'download-result', success: false }).catch(() => {});
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    chrome.runtime.sendMessage({ type: 'download-result', success: true }).catch(() => {});
  } catch (_) {
    chrome.runtime.sendMessage({ type: 'download-result', success: false }).catch(() => {});
  }
}

async function startRecording(mode, includeAudio) {
  try {
    activeStreams = [];
    const tracks = [];

    if (mode === 'screen' || mode === 'both') {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: includeAudio
      });
      activeStreams.push(screenStream);
      screenStream.getTracks().forEach(t => tracks.push(t));
    }

    if (mode === 'camera' || mode === 'both') {
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: mode === 'camera' && includeAudio
      });
      activeStreams.push(cameraStream);
      cameraStream.getTracks().forEach(t => tracks.push(t));
    }

    const combinedStream = new MediaStream(tracks);

    recordedChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm';
    mediaRecorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 2500000
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });

      const cache = await caches.open('recording-pro-temp');
      await cache.put(
        new Request('https://recording-pro.local/latest'),
        new Response(blob)
      );

      chrome.runtime.sendMessage({
        type: 'recording-complete',
        size: blob.size
      }).catch(() => {});

      activeStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
      activeStreams = [];
      recordedChunks = [];
      mediaRecorder = null;
    };

    mediaRecorder.start(1000);
    chrome.runtime.sendMessage({ type: 'recording-started' }).catch(() => {});
  } catch (error) {
    chrome.runtime.sendMessage({
      type: 'recording-error',
      error: error.message
    }).catch(() => {});
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}
