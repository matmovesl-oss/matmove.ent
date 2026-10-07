export default function handler(req, res) {
  // This catches Monime's POST/GET requests and safely redirects to the frontend homepage
  // which instantly triggers the PortalApp.tsx passcode lock.
  res.redirect(302, '/?payment=done');
}