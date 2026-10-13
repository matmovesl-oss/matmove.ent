
import { supabase } from '@/lib/supabase';
export type CheckoutItem = { productId: string; quantity: number };
export type MerchantQuote = {
  productMinor: number; deliveryMinor: number; feeMinor: number; totalMinor: number;
  availableMinor: number; affordable: boolean; merchantId: string; escrowAccount: string;
  items: (CheckoutItem & { name: string; unitMinor: number })[];
};
export type MerchantPayment = Omit<MerchantQuote, 'availableMinor' | 'affordable' | 'merchantId'> & {
  id: string; state: string; error: string | null; deliveryState: string;
  merchantAccount: string; phone: string; address: string;
  receipts: { kind: string; id: string | null; status: string; amountMinor: number }[];
};
export type MerchantSubmit = {
  action: 'merchant_submit'; items: CheckoutItem[]; delivery: boolean; city: string;
  address: string; phone: string; acceptedTotalMinor: number; idempotencyKey: string;
};
export async function merchantPaymentRequest(body: Record<string, unknown>): Promise<{ quote?: MerchantQuote; payment?: MerchantPayment }> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Sign in again before making a payment.');
  const response = await fetch('/api/create-monime-transfer', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Payment API unavailable. Check this same payment again.');
  const result = await response.json();
  if (!response.ok) {
    const requestError = new Error(result.error || 'Unable to check merchant payment.') as Error & { code?: string };
    requestError.code = result.code;
    throw requestError;
  }
  return result;
}
