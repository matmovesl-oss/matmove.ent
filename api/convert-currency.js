export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  return res.status(410).json({
    error:
      'Currency conversion is no longer available. Transfers must be USD to USD or SLE to SLE.',
  });
}