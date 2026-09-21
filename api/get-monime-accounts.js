export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const monimeRes = await fetch('https://api.monime.io/v1/financial-accounts', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.MONIME_API_KEY}`,
        'Monime-Space-Id': process.env.MONIME_SPACE_ID,
        'Monime-Version': 'caph.2025-08-23'
      }
    });

    const rawData = await monimeRes.json();
    
    if (!monimeRes.ok || rawData.success === false) {
      throw new Error(rawData.message || 'Failed to fetch accounts from Monime.');
    }

    return res.status(200).json({ accounts: rawData.result || [] });
  } catch (error) {
    console.error('Fetch Accounts Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}