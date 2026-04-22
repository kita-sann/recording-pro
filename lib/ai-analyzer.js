// ========================================
// Recording Pro — AI分析モジュール（プロキシ経由）
// ========================================
// ProユーザーはサーバーサイドプロキシでAI APIを呼び出し
// ユーザーがAPIキーを用意する必要なし

const API_BASE = 'https://server-bice-omega.vercel.app';

const WHISPER_MAX_SIZE = 24 * 1024 * 1024; // 24MB（25MB制限に余裕を持たせる）
const WAV_HEADER_SIZE = 44;

export async function analyzeRecording(blob, provider, licenseKey, { transcription = true, aiAnalysis = true, modeMinutes = true, modeFeedback = false } = {}) {
  if (!transcription && !aiAnalysis) return null;

  const transcript = await transcribeAudio(licenseKey);

  if (!aiAnalysis) {
    return `=== 文字起こし ===\n${transcript}`;
  }

  const modes = [];
  if (modeMinutes) modes.push('minutes');
  if (modeFeedback) modes.push('feedback');
  if (modes.length === 0) modes.push('minutes');

  const analysis = await analyzeTranscript(transcript, provider, licenseKey, modes);

  return `=== 文字起こし ===\n${transcript}\n\n=== AI分析 ===\n${analysis}`;
}

async function transcribeAudio(licenseKey) {
  const cache = await caches.open('recording-pro-temp');

  const audioResponse = await cache.match('https://recording-pro.local/audio');
  if (!audioResponse) {
    throw new Error('音声データが見つかりません。音声を含めて録画してください。');
  }
  const audioBlob = await audioResponse.blob();

  // 24MB以下ならそのまま送信
  if (audioBlob.size <= WHISPER_MAX_SIZE) {
    return await whisperRequest(audioBlob, licenseKey);
  }

  // 24MB超: WAV PCMデータをチャンク分割して順次文字起こし
  const chunks = splitWavBlob(audioBlob);
  const transcripts = [];
  for (let i = 0; i < chunks.length; i++) {
    const text = await whisperRequest(chunks[i], licenseKey);
    if (text) transcripts.push(text);
  }
  return transcripts.join('\n');
}

async function whisperRequest(blob, licenseKey) {
  const formData = new FormData();
  formData.append('file', blob, 'recording.wav');
  formData.append('model', 'whisper-1');
  formData.append('language', 'ja');

  const response = await fetch(`${API_BASE}/api/ai/transcribe`, {
    method: 'POST',
    headers: { 'X-License-Key': licenseKey },
    body: formData
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`文字起こしエラー (${response.status}): ${error}`);
  }

  const result = await response.json();
  return result.text;
}

function splitWavBlob(blob) {
  const pcmDataSize = blob.size - WAV_HEADER_SIZE;
  const chunkPcmSize = WHISPER_MAX_SIZE - WAV_HEADER_SIZE;
  const numChunks = Math.ceil(pcmDataSize / chunkPcmSize);
  const chunks = [];

  for (let i = 0; i < numChunks; i++) {
    const start = WAV_HEADER_SIZE + (i * chunkPcmSize);
    const end = Math.min(start + chunkPcmSize, blob.size);
    const pcmSlice = blob.slice(start, end);
    const actualPcmSize = end - start;

    const header = buildWavHeader(actualPcmSize);
    chunks.push(new Blob([header, pcmSlice], { type: 'audio/wav' }));
  }

  return chunks;
}

function buildWavHeader(dataSize) {
  const buffer = new ArrayBuffer(WAV_HEADER_SIZE);
  const view = new DataView(buffer);
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  function writeStr(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  return buffer;
}

async function analyzeTranscript(transcript, provider, licenseKey, modes) {
  const response = await fetch(`${API_BASE}/api/ai/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-License-Key': licenseKey
    },
    body: JSON.stringify({ transcript, provider, modes })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI分析エラー (${response.status}): ${error}`);
  }

  const result = await response.json();
  return result.analysis;
}
