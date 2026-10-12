import {
  protectedWallet
} from '../server/wallet-security.js';

import {
  liveWallet
} from '../server/live-wallet.js';

export default protectedWallet(
  'read',
  async (req, res) =>
    res.status(200).json(
      await liveWallet(req.matmove)
    )
);