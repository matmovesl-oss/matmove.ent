import {
  protectedWallet,
} from '../server/wallet-security.js';

import {
  createWallet,
} from '../server/create-wallet.js';

export default protectedWallet(
  'create',
  async (req, res) =>
    createWallet(req, res, 'USD')
);