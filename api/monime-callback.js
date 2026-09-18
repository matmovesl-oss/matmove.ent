export default async function handler(req, res) {
  // This absorbs Monime's POST request (avoiding the 405 error)
  // and safely forces a clean GET redirect back to the frontend.
  
  const { returnUrl } = req.query;
  const destination = returnUrl ? decodeURIComponent(returnUrl) : '/';
  
  // 302 Found tells the browser to perform a standard GET request to the destination
  res.redirect(302, destination);
}