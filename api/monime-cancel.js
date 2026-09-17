export default function handler(req, res) {
  const role = req.query.role || 'rider';
  let path = '/rider-dashboard';

  if (role === 'driver') path = '/driver-dashboard';
  else if (role === 'merchant' || role === 'vendor') path = '/merchant-dashboard';

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Payment Cancelled</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f8fafc; margin: 0; }
          .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); text-align: center; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2 style="margin: 0 0 0.5rem 0; color: #ef4444;">Payment Cancelled</h2>
          <p style="margin: 0; color: #64748b;">Returning to your dashboard...</p>
        </div>
        <script>
          setTimeout(() => { window.location.href = '${path}'; }, 1000);
        </script>
      </body>
    </html>
  `);
}