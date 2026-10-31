import { supabase } from '@/lib/supabase';

export type PayoutQuote = {
  amountMinor: number;
  monimeFeeMinor: number;
  platformFeeMinor: number;
  totalMinor: number;
  availableMinor: number;
  affordable: boolean;
};

export type Withdrawal = {
  id: string;
  state: string;
  amountMinor: number;
  monimeFeeMinor: number;
  platformFeeMinor: number;
  totalMinor: number;
  actualMonimeFeeMinor: number | null;
  actualTotalMinor: number | null;
  platformAccountId: string;
  phone: string;
  networkProvider: string;
  error: string | null;

  receipts: {
    kind: string;
    id: string | null;
    status: string;
    amountMinor: number;
  }[];
};

export type PayoutRequest = {
  action: 'submit';
  amount: string;
  currency: 'SLE';
  destinationPhone: string;
  networkProvider: string;
  acceptedTotalMinor: number;
  idempotencyKey: string;
};

export async function payoutRequest(
  body: Record<string, unknown>
): Promise<{
  quote?: PayoutQuote;
  withdrawal?: Withdrawal;
  success?: boolean;
  pending?: boolean;
}> {
  const {
    data: { session },
    error
  } = await supabase.auth.getSession();

  if (error || !session) {
    throw new Error(
      'Sign in again before using your wallet.'
    );
  }

  const response = await fetch(
    '/api/create-monime-payout',
    {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        Authorization:
          `Bearer ${session.access_token}`
      },

      body: JSON.stringify(body)
    }
  );

  if (
    !(
      response.headers.get('content-type') || ''
    ).includes('application/json')
  ) {
    throw new Error(
      'Payout API unavailable. Check this same request again.'
    );
  }

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.error ||
      'Unable to check this payout.'
    );
  }

  return result;
}