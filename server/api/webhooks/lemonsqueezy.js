// Lemon Squeezy Webhook 受信
// POST /api/webhooks/lemonsqueezy

import { createHmac } from 'crypto';

export const config = {
  api: { bodyParser: false }
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function verifySignature(rawBody, signature, secret) {
  const hmac = createHmac('sha256', secret);
  hmac.update(rawBody);
  const digest = hmac.digest('hex');
  return digest === signature;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const rawBody = await readBody(req);
  const signature = req.headers['x-signature'];

  if (!signature || !verifySignature(rawBody, signature, secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventName = event.meta?.event_name;

  switch (eventName) {
    case 'subscription_created':
    case 'subscription_updated':
    case 'subscription_resumed':
      // Phase 1: ログのみ。Phase 2でDB連携予定
      console.log(`[webhook] ${eventName} - customer: ${event.data?.attributes?.user_email}`);
      break;

    case 'subscription_expired':
    case 'subscription_cancelled':
    case 'subscription_paused':
      console.log(`[webhook] ${eventName} - customer: ${event.data?.attributes?.user_email}`);
      break;

    default:
      console.log(`[webhook] unhandled event: ${eventName}`);
  }

  return res.status(200).json({ received: true });
}
