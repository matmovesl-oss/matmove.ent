const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PaymentRequest {
  bookingId: string;
  amount: number;
  method: 'wallet' | 'mobile_money' | 'card';
}

export interface PaymentResult {
  id: string;
  status: 'Completed' | 'Pending' | 'Failed';
  amount: number;
  method: string;
}

export async function createPayment(req: PaymentRequest): Promise<PaymentResult> {
  await delay(1000);
  return {
    id: `PAY-${Date.now().toString().slice(-6)}`,
    status: 'Completed',
    amount: req.amount,
    method: req.method,
  };
}
