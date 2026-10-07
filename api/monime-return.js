export default function handler(req, res) {
  const { role } = req.query;
  
  // Dynamically route the user back to their specific dashboard
  const redirectPath = role ? `/customer/${role}?payment=done` : `/customer?payment=done`;
  
  res.redirect(302, redirectPath);
}