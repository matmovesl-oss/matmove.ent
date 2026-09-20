import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, amount } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: 'Missing required parameters.' });

    const merchantId = process.env.FLOT_MERCHANT_ID;
    let privateKey = process.env.FLOT_PRIVATE_KEY || '';
    
    // Safely reconstruct the RSA key from Vercel's environment variables
    privateKey = privateKey.replace(/\\n/g, '\n');

    if (!merchantId || !privateKey) {
      throw new Error('Vercel Config Error: Missing FLOT_MERCHANT_ID or FLOT_PRIVATE_KEY.');
    }

    const transactionRef = `FLOT_${userId}_${Date.now()}`;
    const requestBody = {
      merchantId: merchantId,
      type: "in-app",
      payload: {
        orderId: transactionRef,
        currency: "SLE",
        amount: String(amount)
      }
    };

    const stringifiedBody = JSON.stringify(requestBody);

    const signer = crypto.createSign('RSA-SHA512');
    signer.update(stringifiedBody);
    
    const signature = signer.sign({
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }, 'base64');

    const flotRes = await fetch('https://api.app.flotme.ai/merchants/private/v1/payment-links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flot-Merchant-Signature': signature
      },
      body: stringifiedBody
    });

    const rawData = await flotRes.json();
    
    if (!flotRes.ok) {
      throw new Error(rawData.message || `Flot gateway error: ${JSON.stringify(rawData)}`);
    }

    const checkoutUrl = rawData.url || rawData.link || rawData.data?.url || rawData.paymentLink;
    if (!checkoutUrl) throw new Error('Missing checkout URL in Flot response.');

    return res.status(200).json({ link: checkoutUrl });
  } catch (error) {
    console.error('Flot Checkout Error:', error);
    return res.status(500).json({ error: error.message });
  }
}