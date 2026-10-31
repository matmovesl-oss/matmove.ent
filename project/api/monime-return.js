export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const role =
    ['rider', 'driver', 'merchant'].includes(
      req.query?.role
    )
      ? req.query.role
      : null;

  // Navigation only. A redirect never proves payment
  // and must never credit a wallet.
  return res.redirect(
    303,
    `${
      role
        ? `/customer/${role}`
        : '/customer'
    }?payment=returned`
  );
}