export default function handler(req, res) {
  const role = req.query.role || 'rider';
  let path = '/rider-dashboard';

  if (role === 'driver') {
    path = '/driver-dashboard';
  } else if (role === 'merchant' || role === 'vendor') {
    path = '/merchant-dashboard';
  }

  res.writeHead(303, { Location: path });
  res.end();
}