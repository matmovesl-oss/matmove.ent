export default function handler(req, res) {
  // Use the path provided in the query, or default to the rider dashboard
  const path = req.query.path || '/customer/rider';

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Payment Successful</title>
        <style>
          body { 
            font-family: system-ui, -apple-system, sans-serif; 
            display: flex; justify-content: center; align-items: center; 
            height: 100vh; background-color: #f8fafc; margin: 0; 
          }
          .card { 
            background: white; padding: 2.5rem; border-radius: 1rem; 
            box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); text-align: center; 
            max-width: 400px; width: 90%; 
          }
          .spinner { 
            border: 4px solid #f3f3f3; border-top: 4px solid #10B981; 
            border-radius: 50%; width: 40px; height: 40px; 
            animation: spin 1s linear infinite; margin: 20px auto; 
          }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          h2 { margin: 0 0 0.5rem 0; color: #10B981; }
          p { margin: 0; color: #64748b; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Payment Authorized!</h2>
          <p>Monime is syncing your funds to your MatMove wallet.</p>
          <div class="spinner"></div>
          <p style="font-size: 14px;">Returning to your dashboard in a few seconds...</p>
        </div>
        <script>
          // Buffer time: Wait 3.5 seconds so the webhook can update the Supabase balance
          setTimeout(() => { 
            window.location.href = '${path}'; 
          }, 3500);
        </script>
      </body>
    </html>
  `);
}