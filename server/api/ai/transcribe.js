// AIプロキシ — Whisper文字起こし
// POST /api/ai/transcribe
// Body: FormData with 'file' (audio blob)
// ライセンスキー検証後、サーバー側のOpenAI APIキーで文字起こしを実行

export const config = {
  api: { bodyParser: false }
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

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

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return res.status(500).json({ error: 'AI service not configured' });
  }

  try {
    // クライアントからのFormDataをそのままOpenAIに転送
    const rawBody = await readRawBody(req);
    const contentType = req.headers['content-type'];

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': contentType
      },
      body: rawBody
    });

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({
        error: `Whisper API error: ${error}`
      });
    }

    const result = await response.json();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: `Transcription failed: ${err.message}` });
  }
}
