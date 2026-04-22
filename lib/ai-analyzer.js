export async function analyzeRecording(blob, provider, apiKey, anthropicKey, { transcription = true, aiAnalysis = true, modeMinutes = true, modeFeedback = false } = {}) {
  if (!transcription && !aiAnalysis) return null;

  const transcript = await transcribeAudio(apiKey);

  if (!aiAnalysis) {
    return `=== 文字起こし ===\n${transcript}`;
  }

  const modes = [];
  if (modeMinutes) modes.push('minutes');
  if (modeFeedback) modes.push('feedback');
  if (modes.length === 0) modes.push('minutes');

  const analysis = await analyzeTranscript(transcript, provider, apiKey, anthropicKey, modes);

  return `=== 文字起こし ===\n${transcript}\n\n=== AI分析 ===\n${analysis}`;
}

const WHISPER_MAX_SIZE = 24 * 1024 * 1024; // 24MB（25MB制限に余裕を持たせる）
const WAV_HEADER_SIZE = 44;

async function transcribeAudio(apiKey) {
  const cache = await caches.open('recording-pro-temp');

  const audioResponse = await cache.match('https://recording-pro.local/audio');
  if (!audioResponse) {
    throw new Error('音声データが見つかりません。音声を含めて録画してください。');
  }
  const audioBlob = await audioResponse.blob();

  // 24MB以下ならそのまま送信
  if (audioBlob.size <= WHISPER_MAX_SIZE) {
    return await whisperRequest(audioBlob, apiKey);
  }

  // 24MB超: WAV PCMデータをチャンク分割して順次文字起こし
  const chunks = splitWavBlob(audioBlob);
  const transcripts = [];
  for (let i = 0; i < chunks.length; i++) {
    const text = await whisperRequest(chunks[i], apiKey);
    if (text) transcripts.push(text);
  }
  return transcripts.join('\n');
}

async function whisperRequest(blob, apiKey) {
  const formData = new FormData();
  formData.append('file', blob, 'recording.wav');
  formData.append('model', 'whisper-1');
  formData.append('language', 'ja');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
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
  // WAV: 44バイトヘッダー + 16bit PCM 16kHz mono = 32000 bytes/sec
  const pcmDataSize = blob.size - WAV_HEADER_SIZE;
  const chunkPcmSize = WHISPER_MAX_SIZE - WAV_HEADER_SIZE;
  const numChunks = Math.ceil(pcmDataSize / chunkPcmSize);
  const chunks = [];

  for (let i = 0; i < numChunks; i++) {
    const start = WAV_HEADER_SIZE + (i * chunkPcmSize);
    const end = Math.min(start + chunkPcmSize, blob.size);
    const pcmSlice = blob.slice(start, end);
    const actualPcmSize = end - start;

    // チャンクごとにWAVヘッダーを再構築（データサイズを更新）
    const header = buildWavHeader(actualPcmSize);
    chunks.push(new Blob([header, pcmSlice], { type: 'audio/wav' }));
  }

  return chunks;
}

function buildWavHeader(dataSize) {
  // 16kHz, mono, 16bit PCM WAVヘッダー
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

const PROMPT_SECTIONS = {
  minutes: `【議事録】以下の形式で整理してください。
## 議題
## 参加者（発言から推定）
## 決定事項
## アクションアイテム（担当者・期限があれば明記）
## 次回の予定`,
  feedback: `【フィードバック】以下の観点で分析してください。
## 内容に対するフィードバック
打ち合わせの進め方や議論の質について、主観的な評価とコメントを述べてください。
## 課題点の分析
参加者の発言や対応から見える課題点を具体的に指摘してください。
## 改善提案
上記の課題に対して「こうしたほうがいい」という具体的な提案をしてください。コミュニケーション、進行方法、準備の仕方など、実践的なアドバイスを含めてください。`
};

async function analyzeTranscript(transcript, provider, apiKey, anthropicKey, modes) {
  const sections = modes.map(m => PROMPT_SECTIONS[m]).filter(Boolean).join('\n\n');
  const prompt = `以下の会議の文字起こしを分析してください。\n\n${sections}\n\n文字起こし:\n${transcript}`;

  if (provider === 'anthropic' && anthropicKey) {
    return await callClaude(prompt, anthropicKey);
  }
  return await callOpenAI(prompt, apiKey);
}

async function callOpenAI(prompt, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI分析エラー (${response.status}): ${error}`);
  }

  const result = await response.json();
  return result.choices[0].message.content;
}

async function callClaude(prompt, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude分析エラー (${response.status}): ${error}`);
  }

  const result = await response.json();
  return result.content[0].text;
}
