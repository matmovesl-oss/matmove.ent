import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

function formatPemPrivateKey(keyString) {
  if (!keyString) return '';
  let cleaned = keyString.trim();
  if (cleaned.includes('\\n')) {
    cleaned = cleaned.replace(/\\n/g, '\n');
  }
  if (!cleaned.includes('-----BEGIN PRIVATE KEY-----') && !cleaned.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    const rawBody = cleaned.replace(/[\r\n\s]/g, '');
    const chunked = rawBody.match(/.{1,64}/g)?.join('\n') || rawBody;
    cleaned = `-----BEGIN PRIVATE KEY-----\n${chunked}\n-----END PRIVATE KEY-----`;
  }
  return cleaned;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { amount, userId, type } = req.body;
    const merchantId = process.env.VULT_MERCHANT_ID;
    const rawPrivateKey = process.env.VULT_PRIVATE_KEY;

    if (!merchantId || !rawPrivateKey) {
      console.error('Missing Vult Env Vars:', { hasMerchantId: !!merchantId, hasPrivateKey: !!rawPrivateKey });
      return res.status(500).json({ error: 'Vult environment configuration missing.' });
    }

    const privateKey = formatPemPrivateKey(rawPrivateKey);

    let vultType = 'card';
    if (type === 'momo') vultType = 'momo';
    if (type === 'vult' || type === 'in-app') vultType = 'vult';

    const orderId = `MM_${userId}_${Date.now()}`;
    const requestBody = {
      merchantId: merchantId,
      type: vultType,
      payload: {
        orderId: orderId,
        currency: 'SLE',
        amount: String(Number(amount))
      }
    };

    const bodyString = JSON.stringify(requestBody);

    // Compute signature using exact Node spec[cite: 1]
    const signer = crypto.createSign('RSA-SHA512');
    signer.update(bodyString);
    const signature = signer.sign({
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }, 'base64');

    console.log('Sending Body to Vult:', bodyString);
    console.log('Generated Signature (first 30 chars):', signature.substring(0, 30));

    const vultRes = await fetch('https://wallet.vultme.io/api/merchants/private/v1/payment-links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vult-Merchant-Signature': signature
      },
      body: bodyString
    });

    const resText = await vultRes.text();
    console.log(`Vult HTTP Response Code: ${vultRes.status}, Body:`, resText);

    let data;
    try { data = JSON.parse(resText); } catch { data = { raw: resText }; }

    if (!vultRes.ok) {
      return res.status(vultRes.status).json({
        error: `Vult Gateway Error (${vultRes.status}): ${data?.message || data?.error || resText || 'Forbidden'}`
      });
    }

    return res.status(200).json({
      link: data?.data?.link || data?.link || null,
      code: data?.data?.code || data?.code || null
    });

  } catch (err) {
    console.error('Checkout Exception:', err);
    return res.status(500).json({ error: err.message });
  }
}