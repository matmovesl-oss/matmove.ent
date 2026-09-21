import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, amount, email, phone, name, role, returnUrl } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: 'Missing required parameters.' });

    const merchantId = process.env.FLOT_MERCHANT_ID || process.env.FLOT_CLIENT_ID || 'matmove-merchant';
    let privateKey = process.env.FLOT_PRIVATE_KEY || process.env.FLOT_SECRET_KEY || '';

    // Clean and normalize line breaks for RSA key format
    privateKey = privateKey.replace(/\\n/g, '\n').trim();

    const transactionRef = `FLOT_${userId}_${Date.now()}`;
    const destinationDashboard = returnUrl || `${req.headers.origin}/customer/${role || 'rider'}`;
    const safeCallbackUrl = `${req.headers.origin}/api/unified-webhook?returnUrl=${encodeURIComponent(destinationDashboard)}&provider=flot&amount=${amount}`;

    // Mode A: RSA Private Key signature (Official Flot V2.0 Integration)
    if (privateKey.includes('BEGIN PRIVATE KEY')) {
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
      if (!checkoutUrl) throw new Error(`Missing checkout URL in Flot response: ${JSON.stringify(rawData)}`);

      return res.status(200).json({ link: checkoutUrl });
    } 
    // Mode B: Standard API Secret Key fallback
    else if (privateKey.length > 0) {
      const payload = {
        tx_ref: transactionRef,
        amount: amount,
        currency: "SLE",
        redirect_url: safeCallbackUrl,
        customer: { email: email || "user@matmove.com", phonenumber: phone || "", name: name || "MatMove User" },
        customizations: { title: "MatMove Wallet Top-Up", description: "Fund your MatMove Wallet" }
      };

      const flotRes = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${privateKey}` },
        body: JSON.stringify(payload)
      });

      const rawData = await flotRes.json();
      if (!flotRes.ok || rawData.status !== "success") throw new Error(rawData.message || 'Flot card checkout failed');

      return res.status(200).json({ link: rawData.data.link });
    } else {
      throw new Error('Vercel Config Error: Missing FLOT_PRIVATE_KEY or FLOT_SECRET_KEY in Environment Variables.');
    }
  } catch (error) {
    console.error('Flot Checkout Error:', error);
    return res.status(500).json({ error: error.message });
  }
}