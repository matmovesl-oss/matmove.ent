export function analyticsWindow(
  period: string,
  now?: Date
): {
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  days: number;
};

export function merchantAnalytics(
  rows: any[],
  period: string,
  now?: Date
): {
  revenueMinor: number;
  previousRevenueMinor: number;

  paidOrders: number;
  previousPaidOrders: number;

  averageOrderMinor: number;
  customers: number;

  unpaidOrders: number;
  pendingItems: number;
  completedItems: number;
  cancelledItems: number;

  growthPercent: number | null;

  products: {
    name: string;
    units: number;
    revenueMinor: number;
  }[];

  buckets: {
    date: string;
    revenueMinor: number;
  }[];

  from: string;
  to: string;
};