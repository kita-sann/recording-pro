// AIプロキシ — テキスト分析（GPT-4o / Claude）
// POST /api/ai/analyze
// Body: { transcript, provider, modes }
// ライセンスキー検証後、サーバー側のAPIキーで分析を実行

function parseLicenseKey(req) {
  return req.headers['x-license-key'] || '';
}

async function validateLicense(key) {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  if (!apiKey) return false;

  try {
    const res = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ license_key: key })
    });
    const data = await res.json();
    return data.valid === true;
  } catch {
    return false;
  }
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
上記の課題に対して「こうしたほうがいい」という具体的な提案をしてください。`
};

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
    throw new Error(`OpenAI error (${response.status}): ${error}`);
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
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude error (${response.status}): ${error}`);
  }

  const result = await response.json();
  return result.content[0].text;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ライセンス検証
  const licenseKey = parseLicenseKey(req);
  if (!licenseKey) {
    return res.status(401).json({ error: 'License key required' });
  }

  const valid = await validateLicense(licenseKey);
  if (!valid) {
    return res.status(403).json({ error: 'Invalid or expired license' });
  }

  const { transcript, provider, modes } = req.body || {};

  if (!transcript) {
    return res.status(400).json({ error: 'transcript is required' });
  }

  const selectedModes = Array.isArray(modes) && modes.length > 0 ? modes : ['minutes'];
  const sections = selectedModes.map(m => PROMPT_SECTIONS[m]).filter(Boolean).join('\n\n');
  const prompt = `以下の会議の文字起こしを分析してください。\n\n${sections}\n\n文字起こし:\n${transcript}`;

  try {
    let result;

    if (provider === 'anthropic') {
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        return res.status(500).json({ error: 'Anthropic API not configured' });
      }
      result = await callClaude(prompt, anthropicKey);
    } else {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        return res.status(500).json({ error: 'OpenAI API not configured' });
      }
      result = await callOpenAI(prompt, openaiKey);
    }

    return res.status(200).json({ analysis: result });
  } catch (err) {
    return res.status(500).json({ error: `Analysis failed: ${err.message}` });
  }
}
