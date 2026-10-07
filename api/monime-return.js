export default function handler(req, res) {
  // Safely converts Monime's POST into a standard GET redirect back to the app passcode screen
  res.redirect(302, '/?payment=done');
}