export async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);

  if (error) {
    console.error('MatMove ride payment RPC failed', {
      function: name,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });

    const known =
      /^(FORBIDDEN|NOT_FOUND|INVALID_STATE|PAYMENT_PENDING|LEGACY_PAYMENT|INVALID_FARE|ACCOUNT_CHANGED):/;

    throw new HttpError(
      known.test(error.message) ? 409 : 503,
      known.test(error.message)
        ? error.message.replace(/^[A-Z_]+: /, '')
        : 'Ride payment storage is unavailable. Please try again.'
    );
  }

  return data;
}