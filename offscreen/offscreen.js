let mediaRecorder = null;
let recordedChunks = [];
let activeStreams = [];
let audioRecorder = null;
let audioChunks = [];
let audioLevelInterval = null;
let audioAnalyserCtx = null;
let mixerCtx = null;
let pipCanvas = null;
let pipAnimationId = null;

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

    // 前回の録画キャッシュをクリア（古い音声データの再利用を防止）
    const prevCache = await caches.open('recording-pro-temp');
    await prevCache.delete(new Request('https://recording-pro.local/audio'));
    await prevCache.delete(new Request('https://recording-pro.local/latest'));

    const audioSources = [];
    let screenStream = null;
    let cameraStream = null;

    if (mode === 'screen' || mode === 'both') {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: includeAudio
      });
      activeStreams.push(screenStream);
      if (screenStream.getAudioTracks().length > 0) {
        audioSources.push(screenStream);
      }

      // マイク音声も取得（ユーザーの声を録音するため）
      if (includeAudio) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          activeStreams.push(micStream);
          audioSources.push(micStream);
        } catch (_) { /* マイク利用不可 */ }
      }
    }

    if (mode === 'camera' || mode === 'both') {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: mode === 'camera' && includeAudio
      });
      activeStreams.push(cameraStream);
      if (cameraStream.getAudioTracks().length > 0) {
        audioSources.push(cameraStream);
      }
    }

    // ビデオトラックの構築
    let videoTrack;
    if (mode === 'both' && screenStream && cameraStream) {
      // Canvas PiP合成：画面全体 + カメラを右下に小さく重ねる
      const screenVideo = document.createElement('video');
      screenVideo.srcObject = screenStream;
      screenVideo.muted = true;
      screenVideo.play();

      const cameraVideo = document.createElement('video');
      cameraVideo.srcObject = cameraStream;
      cameraVideo.muted = true;
      cameraVideo.play();

      // 画面解像度に合わせてCanvasを作成
      const screenTrack = screenStream.getVideoTracks()[0];
      const screenSettings = screenTrack.getSettings();
      const canvasW = screenSettings.width || 1920;
      const canvasH = screenSettings.height || 1080;

      pipCanvas = document.createElement('canvas');
      pipCanvas.width = canvasW;
      pipCanvas.height = canvasH;
      const ctx = pipCanvas.getContext('2d');

      // PiPサイズ（画面の1/5、右下に配置、マージン16px）
      const pipW = Math.round(canvasW / 5);
      const pipH = Math.round(pipW * 3 / 4);
      const pipMargin = 16;
      const pipX = canvasW - pipW - pipMargin;
      const pipY = canvasH - pipH - pipMargin;
      const pipRadius = 12;

      function drawFrame() {
        ctx.drawImage(screenVideo, 0, 0, canvasW, canvasH);

        // PiPの丸角クリッピング
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(pipX, pipY, pipW, pipH, pipRadius);
        ctx.clip();
        ctx.drawImage(cameraVideo, pipX, pipY, pipW, pipH);
        ctx.restore();

        // PiPの枠線
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(pipX, pipY, pipW, pipH, pipRadius);
        ctx.stroke();

        pipAnimationId = requestAnimationFrame(drawFrame);
      }
      drawFrame();

      const canvasStream = pipCanvas.captureStream(30);
      videoTrack = canvasStream.getVideoTracks()[0];
    } else if (screenStream) {
      videoTrack = screenStream.getVideoTracks()[0];
    } else if (cameraStream) {
      videoTrack = cameraStream.getVideoTracks()[0];
    }

    // 音声ミックス
    const combinedTracks = videoTrack ? [videoTrack] : [];
    if (audioSources.length > 0) {
      mixerCtx = new AudioContext();
      const destination = mixerCtx.createMediaStreamDestination();
      for (const src of audioSources) {
        const source = mixerCtx.createMediaStreamSource(src);
        source.connect(destination);
      }
      destination.stream.getAudioTracks().forEach(t => combinedTracks.push(t));
    }

    const combinedStream = new MediaStream(combinedTracks);

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
      // 音声レベル監視を停止
      if (audioLevelInterval) {
        clearInterval(audioLevelInterval);
        audioLevelInterval = null;
      }
      if (audioAnalyserCtx) {
        audioAnalyserCtx.close().catch(() => {});
        audioAnalyserCtx = null;
      }
      if (mixerCtx) {
        mixerCtx.close().catch(() => {});
        mixerCtx = null;
      }
      if (pipAnimationId) {
        cancelAnimationFrame(pipAnimationId);
        pipAnimationId = null;
      }
      pipCanvas = null;

      // 音声レコーダーを停止
      if (audioRecorder && audioRecorder.state === 'recording') {
        await new Promise(resolve => {
          audioRecorder.onstop = resolve;
          audioRecorder.stop();
        });
      }

      const blob = new Blob(recordedChunks, { type: 'video/webm' });

      const cache = await caches.open('recording-pro-temp');
      await cache.put(
        new Request('https://recording-pro.local/latest'),
        new Response(blob)
      );

      // 音声をWAVに変換してキャッシュに保存（AI文字起こし用）
      if (audioChunks.length > 0) {
        try {
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          const wavBlob = await convertToWav(audioBlob);
          await cache.put(
            new Request('https://recording-pro.local/audio'),
            new Response(wavBlob)
          );
        } catch (e) {
          console.error('WAV変換失敗、元の映像から音声抽出を試みます:', e);
          try {
            const wavBlob = await convertToWav(blob);
            await cache.put(
              new Request('https://recording-pro.local/audio'),
              new Response(wavBlob)
            );
          } catch (e2) {
            console.error('映像からの音声抽出も失敗:', e2);
          }
        }
      } else {
        // 音声専用録音がない場合、映像から抽出を試みる
        try {
          const wavBlob = await convertToWav(blob);
          await cache.put(
            new Request('https://recording-pro.local/audio'),
            new Response(wavBlob)
          );
        } catch (e) {
          console.error('映像からの音声抽出失敗:', e);
        }
      }

      chrome.runtime.sendMessage({
        type: 'recording-complete',
        size: blob.size
      }).catch(() => {});

      activeStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
      // クローンした音声トラックも停止
      if (audioRecorder && audioRecorder.stream) {
        audioRecorder.stream.getTracks().forEach(t => t.stop());
      }
      activeStreams = [];
      recordedChunks = [];
      mediaRecorder = null;
      audioRecorder = null;
      audioChunks = [];
    };

    // 音声専用の録音（AI文字起こし用、64kbps — 60分で~28MB、ai-analyzer.jsで自動分割してWhisperに送信）
    const audioTracks = combinedStream.getAudioTracks();
    if (audioTracks.length > 0) {
      // トラックをクローンしてメイン録画と干渉しないようにする
      const clonedTracks = audioTracks.map(t => t.clone());
      const audioStream = new MediaStream(clonedTracks);
      audioChunks = [];
      audioRecorder = new MediaRecorder(audioStream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 64000
      });
      audioRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };
      audioRecorder.start(1000);
    }

    // 音声レベル監視（ポップアップに表示用）
    const audioTracksForLevel = combinedStream.getAudioTracks();
    if (audioTracksForLevel.length > 0) {
      try {
        audioAnalyserCtx = new AudioContext();
        const source = audioAnalyserCtx.createMediaStreamSource(new MediaStream(audioTracksForLevel));
        const analyser = audioAnalyserCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        audioLevelInterval = setInterval(() => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length;
          const level = Math.min(100, Math.round(avg * 100 / 128));
          chrome.runtime.sendMessage({ type: 'audio-level', level }).catch(() => {});
        }, 200);
      } catch (_) { /* AudioContext利用不可 */ }
    }

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
    mediaRecorder.stop(); // onstop内でaudioRecorderも停止される
  }
}

async function convertToWav(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  await audioContext.close();

  // モノラルにダウンミックス
  const length = audioBuffer.length;
  const monoData = new Float32Array(length);
  const channels = audioBuffer.numberOfChannels;
  for (let ch = 0; ch < channels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      monoData[i] += channelData[i] / channels;
    }
  }

  // WAVエンコード（16bit PCM）
  const wavBuffer = encodeWav(monoData, 16000);
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return buffer;
}
