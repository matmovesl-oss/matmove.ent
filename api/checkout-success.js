export default function handler(req: any, res: any) {
  // Redirect back to the dashboard. The frontend session check will automatically lock if needed.
  res.writeHead(302, { Location: '/dashboard' });
  res.end();
}