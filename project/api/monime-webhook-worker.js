import { timingSafeEqual } from 'node:crypto';
import { processMonimeWebhookBatch } from '../server/monime-webhook-worker.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret || ''}`);
  const actual = Buffer.from(String(req.headers.authorization || ''));

  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const result = await processMonimeWebhookBatch({ limit: 10 });
    return res.status(result.failed > 0 ? 503 : 200).json(result);
  } catch (error) {
    console.error('Monime webhook worker failed', { message: error?.message });
    return res.status(503).json({ error: 'Webhook worker unavailable.' });
  }
}
