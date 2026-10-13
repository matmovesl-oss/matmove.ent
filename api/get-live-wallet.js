import {
  protectedWallet,
} from '../server/wallet-security.js';

import {
  liveWallet,
} from '../server/live-wallet.js';

import {
  activityAnalyticsAction,
} from '../server/activity-analytics.js';

export default protectedWallet(
  'read',
  async (req, res) => {
    if (
      req.body.action ===
      'activity_analytics'
    ) {
      return activityAnalyticsAction(
        req,
        res
      );
    }

    const result = await liveWallet(
      req.matmove
    );

    return res.status(200).json(result);
  }
);