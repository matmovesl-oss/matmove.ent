export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const payload = req.body;
    
    // This logs Flot's exact message so we can see how they format their data
    console.log("Incoming Flot Webhook:", JSON.stringify(payload));
    
    // TODO: Add Supabase logic once we know Flot's payload structure

    // Flot needs a 200 OK response quickly, or they will think the webhook failed
    return res.status(200).json({ success: true, message: 'Flot webhook received' });

  } catch (error) {
    console.error('Flot Webhook Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}