export async function analyzeRecording(blob, provider, apiKey) {
  const transcript = await transcribeAudio(blob, apiKey);

  const analysis = await analyzeTranscript(transcript, provider, apiKey);

  return `=== 文字起こし ===\n${transcript}\n\n=== AI分析 ===\n${analysis}`;
}

async function transcribeAudio(blob, apiKey) {
  const formData = new FormData();
  formData.append('file', blob, 'recording.webm');
  formData.append('model', 'whisper-1');
  formData.append('language', 'ja');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`文字起こしエラー (${response.status}): ${error}`);
  }

  const result = await response.json();
  return result.text;
}

async function analyzeTranscript(transcript, provider, apiKey) {
  const prompt = `以下の録画の文字起こしを分析してください。
要点の要約、重要なポイント、アクションアイテムがあれば抽出してください。

文字起こし:
${transcript}`;

  if (provider === 'anthropic') {
    return await callClaude(prompt, apiKey);
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
