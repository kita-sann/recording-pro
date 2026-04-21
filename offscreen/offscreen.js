let mediaRecorder = null;
let recordedChunks = [];
let activeStreams = [];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'start-recording':
      startRecording(message.mode, message.audio);
      sendResponse({ success: true });
      break;
    case 'stop-recording':
      stopRecording();
      sendResponse({ success: true });
      break;
  }
  return true;
});

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
    mediaRecorder = new MediaRecorder(combinedStream, {
      mimeType: 'video/webm;codecs=vp9',
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
      });

      activeStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
      activeStreams = [];
      recordedChunks = [];
      mediaRecorder = null;
    };

    mediaRecorder.start(1000);
    chrome.runtime.sendMessage({ type: 'recording-started' });
  } catch (error) {
    chrome.runtime.sendMessage({
      type: 'recording-error',
      error: error.message
    });
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}
