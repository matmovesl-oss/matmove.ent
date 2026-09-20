import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, amount } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: 'Missing required parameters.' });

    // 1. Prepare Keys
    const merchantId = process.env.FLOT_MERCHANT_ID;
    let privateKey = process.env.FLOT_PRIVATE_KEY || '';
    
    // Format the RSA key correctly for Node.js
    privateKey = privateKey.replace(/\\n/g, '\n');

    if (!merchantId || !privateKey.includes('BEGIN PRIVATE KEY')) {
      throw new Error('Vercel Config Error: FLOT_MERCHANT_ID or FLOT_PRIVATE_KEY is missing. You must use the RSA Private Key.');
    }

    // 2. Build the STRICT payload structure dictated by Flot docs (NO extra fields allowed)
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

    // 3. Generate Flot RSA Signature (RSA-SHA512 with PSS Padding)
    const signer = crypto.createSign('RSA-SHA512');
    signer.update(stringifiedBody);
    
    const signature = signer.sign({
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }, 'base64');

    // 4. Send to Flot Production API
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

    // 5. Extract Link
    const checkoutUrl = rawData.url || rawData.link || rawData.data?.url || rawData.paymentLink;
    if (!checkoutUrl) throw new Error(`Missing checkout URL in Flot response: ${JSON.stringify(rawData)}`);

    return res.status(200).json({ link: checkoutUrl });
  } catch (error) {
    console.error('Flot Checkout Error:', error);
    return res.status(500).json({ error: error.message });
  }
}