export default function handler(req, res) {
  const role = req.query.role || 'rider';
  let path = '/rider-dashboard';

  if (role === 'driver') path = '/driver-dashboard';
  else if (role === 'merchant' || role === 'vendor') path = '/merchant-dashboard';

  // Return a smart HTML page that delays the redirect just long enough for Auth to load
  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Payment Successful</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f8fafc; margin: 0; }
          .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); text-align: center; }
          .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #10b981; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 1rem auto; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="spinner"></div>
          <h2 style="margin: 0 0 0.5rem 0; color: #0f172a;">Payment Successful!</h2>
          <p style="margin: 0; color: #64748b;">Securely returning to your dashboard...</p>
        </div>
        <script>
          // Wait 1.5 seconds so Supabase Auth can load, preventing the login screen kick-out
          setTimeout(() => { window.location.href = '${path}'; }, 1500);
        </script>
      </body>
    </html>
  `);
}