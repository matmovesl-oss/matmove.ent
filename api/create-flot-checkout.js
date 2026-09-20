export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, amount, role, returnUrl } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: 'Missing required parameters.' });

    // Safely strip newlines from the key to prevent Node.js crashes
    let secretKey = process.env.FLOT_SECRET_KEY || process.env.FLOT_PRIVATE_KEY || '';
    secretKey = secretKey.replace(/(\r\n|\n|\r)/gm, "").trim();

    if (secretKey.includes('BEGIN PRIVATE KEY')) {
      throw new Error('Vercel Config Error: You pasted an RSA Key. Please check your Flot dashboard for the standard API Secret Key (e.g., sk_live_...).');
    }

    const transactionRef = `FLOT_${userId}_${Date.now()}`;
    const destinationDashboard = returnUrl || `${req.headers.origin}/customer/${role}`;
    const safeCallbackUrl = `${req.headers.origin}/api/unified-webhook?returnUrl=${encodeURIComponent(destinationDashboard)}&provider=flot&amount=${amount}`;

    const payload = {
      amount: Number(amount),
      currency: "SLE",
      methods: ["card"],
      callbackUrl: safeCallbackUrl,
      reference: transactionRef
    };

    // Native Flotme.ai Endpoint
    const flotRes = await fetch('https://api.flotme.ai/v1/payments', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${secretKey}` 
      },
      body: JSON.stringify(payload)
    });

    const rawData = await flotRes.json();
    if (!flotRes.ok) throw new Error(rawData.message || 'Flot gateway error');

    const checkoutUrl = rawData.checkout_url || rawData.url || rawData.data?.checkout_url || rawData.data?.link;
    if (!checkoutUrl) throw new Error('No checkout URL received from Flot');

    return res.status(200).json({ link: checkoutUrl });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}