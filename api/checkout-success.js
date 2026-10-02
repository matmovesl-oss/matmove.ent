export default function handler(req, res) {
  // Catch the POST request from Monime and redirect to the frontend root
  res.writeHead(302, { Location: '/' });
  res.end();
}