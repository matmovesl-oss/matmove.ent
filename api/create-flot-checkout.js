export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, amount, email, phone, name, role, returnUrl } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: 'Missing required parameters.' });

    const transactionRef = `FLOT_${userId}_${Date.now()}`;
    const destinationDashboard = returnUrl || `${req.headers.origin}/customer/${role}`;
    const safeCallbackUrl = `${req.headers.origin}/api/unified-webhook?returnUrl=${encodeURIComponent(destinationDashboard)}&provider=flot&amount=${amount}`;

    // CRITICAL FIX: Strip all newlines and carriage returns to prevent Node.js Header crashes
    let secretKey = process.env.FLOT_PRIVATE_KEY || process.env.FLOT_SECRET_KEY || '';
    secretKey = secretKey.replace(/(\r\n|\n|\r)/gm, "").trim();

    const payload = {
      tx_ref: transactionRef,
      amount: amount,
      currency: "SLE",
      redirect_url: safeCallbackUrl,
      customer: {
        email: email || "user@matmove.com",
        phonenumber: phone || "",
        name: name || "MatMove User"
      },
      customizations: {
        title: "MatMove Wallet Top-Up",
        description: "Fund your MatMove Wallet using Credit/Debit Card",
        logo: "https://your-matmove-logo-url.com/logo.png"
      }
    };

    const flotRes = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`
      },
      body: JSON.stringify(payload)
    });

    const rawData = await flotRes.json();
    if (!flotRes.ok || rawData.status !== "success") {
      throw new Error(rawData.message || `Flot checkout failed: ${JSON.stringify(rawData)}`);
    }

    return res.status(200).json({ link: rawData.data.link });
  } catch (error) {
    console.error('Flot Checkout Error:', error);
    return res.status(500).json({ error: error.message });
  }
}