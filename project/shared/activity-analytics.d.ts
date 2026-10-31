export type ActivityAnalytics = {
  role: 'rider' | 'driver';

  primaryMinor: number;
  previousPrimaryMinor: number;
  growthPercent: number | null;

  paidTrips: number;
  averageTripMinor: number;

  requestedTrips: number;
  completedRequests: number;
  cancelledRequests: number;
  activeRequests: number;

  ridePaymentsMinor: number;
  rideRefundsMinor: number;

  shoppingMinor: number;
  shoppingCount: number;

  productsMinor: number;
  deliveryMinor: number;
  shoppingFeeMinor: number;

  withdrawalsMinor: number;
  withdrawalFeesMinor: number;
  providerFeesMinor: number;
  feeRefundsMinor: number;

  unconfirmedProviderFees: number;
  missingDates: number;

  services: {
    name: string;
    count: number;
    amountMinor: number;
  }[];

  buckets: {
    date: string;
    amountMinor: number;
  }[];

  from: string;
  to: string;
};

export function activityAnalytics(
  data: any,
  role: 'rider' | 'driver',
  userId: string,
  period: string,
  now?: Date
): ActivityAnalytics;