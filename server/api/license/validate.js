// Lemon Squeezy ライセンス検証 API
// POST /api/license/validate  { key: "LICENSE_KEY" }

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { key } = req.body || {};
  if (!key) {
    return res.status(400).json({ valid: false, error: 'License key is required' });
  }

  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ valid: false, error: 'Server configuration error' });
  }

  try {
    const response = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ license_key: key })
    });

    const data = await response.json();

    if (data.valid) {
      const meta = data.meta || {};
      const variantName = (meta.variant_name || '').toLowerCase();

      let plan = 'pro';
      if (variantName.includes('team')) {
        plan = 'team';
      }

      return res.status(200).json({
        valid: true,
        plan,
        expiresAt: meta.expires_at || null
      });
    }

    return res.status(200).json({
      valid: false,
      error: data.error || 'Invalid or expired license key'
    });
  } catch (err) {
    return res.status(500).json({
      valid: false,
      error: 'License validation service unavailable'
    });
  }
}
