import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { Loader2, X } from 'lucide-react';
import { walletFetch } from '@/lib/apiFetch';

type PaymentCode = {
  id: string;
  ussdCode: string;
  amount: {
    currency: string;
    value: number;
  };
  expireTime: string;
  status: string;
  confirmed: boolean;
};

type Saved = {
  amount: string;
  code?: PaymentCode;
};

export function WalletTopUp({
  userId,
  allowed,
  onClose,
  onPaid
}: {
  userId: string;
  allowed: boolean;
  onClose: () => void;
  onPaid: () => void | Promise<void>;
}) {
  const storage = `matmove-topup:${userId}`;

  const [saved] = useState<Saved | null>(() => {
    try {
      return JSON.parse(
        sessionStorage.getItem(storage) || 'null'
      );
    } catch {
      return null;
    }
  });

  const [amount, setAmount] = useState(saved?.amount || '');
  const [code, setCode] =
    useState<PaymentCode | null>(saved?.code || null);
  const [uncertain, setUncertain] =
    useState(!!saved && !saved.code);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const mounted = useRef(true);
  const inFlight = useRef(false);
  const notified = useRef(false);
  const paidCallback = useRef(onPaid);

  paidCallback.current = onPaid;

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const save = useCallback((value: Saved) => {
    try {
      sessionStorage.setItem(storage, JSON.stringify(value));
    } catch {
      // Optional browser storage.
    }
  }, [storage]);

  const clearRequest = useCallback((value: string) => {
    try {
      sessionStorage.removeItem(storage);

      const fingerprint = JSON.stringify({
        user: userId,
        url: '/api/create-wallet-payment-code',
        body: {
          amount: value,
          currency: 'SLE'
        }
      });

      sessionStorage.removeItem(
        `matmove-request:${fingerprint}`
      );
    } catch {
      // Optional browser storage.
    }
  }, [storage, userId]);

  const refresh = useCallback(async () => {
    if (!code || inFlight.current) return;

    inFlight.current = true;

    if (mounted.current) setChecking(true);

    try {
      const { response, data, finish } = await walletFetch(
        '/api/create-wallet-payment-code',
        {
          operation: 'status',
          paymentCodeId: code.id
        }
      );

      finish();

      if (!response.ok) {
        throw new Error(
          data.error || 'Unable to check payment.'
        );
      }

      const next: PaymentCode = data.paymentCode;

      save({ amount, code: next });

      if (!mounted.current) return;

      setCode(next);
      setError('');

      if (next.confirmed) {
        clearRequest(amount);

        if (!notified.current) {
          notified.current = true;
          await paidCallback.current();
        }
      }
    } catch (err: any) {
      if (mounted.current) {
        setError(
          err.message ||
          'Payment status is unavailable. Try checking again.'
        );
      }
    } finally {
      inFlight.current = false;

      if (mounted.current) setChecking(false);
    }
  }, [code, amount, save, clearRequest]);

  useEffect(() => {
    if (
      !code ||
      code.confirmed ||
      ['expired', 'cancelled'].includes(code.status)
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      void refresh();
    }, 8000);

    return () => window.clearInterval(timer);
  }, [
    code?.id,
    code?.status,
    code?.confirmed,
    refresh
  ]);

  const create = async () => {
    if (busy || !allowed) return;

    if (
      !/^\d+(\.\d{1,2})?$/.test(amount) ||
      Number(amount) <= 0
    ) {
      setError(
        'Enter a positive SLE amount with at most two decimal places.'
      );
      return;
    }

    setBusy(true);
    setError('');
    setUncertain(true);
    save({ amount });

    try {
      const { response, data } = await walletFetch(
        '/api/create-wallet-payment-code',
        {
          amount,
          currency: 'SLE'
        }
      );

      if (!response.ok) {
        if (
          [400, 401, 403, 409, 423].includes(
            response.status
          )
        ) {
          clearRequest(amount);

          if (mounted.current) setUncertain(false);
        }

        throw new Error(
          data.error || 'Unable to create payment code.'
        );
      }

      save({
        amount,
        code: data.paymentCode
      });

      if (mounted.current) {
        setCode(data.paymentCode);
        setUncertain(false);
      }
    } catch (err: any) {
      if (mounted.current) {
        setError(
          (err.message || 'Request interrupted.') +
          ' Retry this same request to recover its result.'
        );
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const newPayment = () => {
    clearRequest(amount);
    setCode(null);
    setAmount('');
    setUncertain(false);
    setError('');
    setNotice('');
    notified.current = false;
  };

  const terminal =
    code &&
    (
      code.confirmed ||
      ['expired', 'cancelled'].includes(code.status)
    );

  return (
    <section
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-50 p-4 sm:p-8"
      aria-label="MatMove wallet top-up"
    >
      <div className="mx-auto max-w-lg space-y-5 rounded-3xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">
            MatMove Wallet Top-up
          </h2>

          <button
            onClick={onClose}
            aria-label="Close top-up"
            className="rounded-xl p-2"
          >
            <X size={22} />
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 p-3 text-red-700"
          >
            {error}
          </p>
        )}

        {notice && (
          <p role="status" className="text-blue-700">
            {notice}
          </p>
        )}

        {!code ? (
          <>
            <p className="text-slate-600">
              Generate a mobile-money payment code and
              complete the payment on your phone.
            </p>

            <label className="block font-bold">
              Amount (SLE)
              <input
                inputMode="decimal"
                value={amount}
                disabled={busy || uncertain}
                onChange={e => setAmount(e.target.value)}
                className="mt-2 w-full rounded-xl border p-4 text-xl"
              />
            </label>

            {!allowed && (
              <p className="text-red-700">
                Wallet transactions are unavailable until
                your account is approved and unfrozen.
              </p>
            )}

            <button
              onClick={() => void create()}
              disabled={busy || !allowed || !amount}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 p-4 font-bold text-white disabled:opacity-50"
            >
              {busy && (
                <Loader2 className="animate-spin" size={20} />
              )}

              {uncertain
                ? 'Retry same request'
                : 'Checkout'}
            </button>
          </>
        ) : (
          <>
            <p className="text-xl font-bold">
              SLE {(code.amount.value / 100).toFixed(2)}
            </p>

            <p className="text-slate-600">
              Dial this code using your Orange Money or
              Afrimoney SIM, then follow the prompts on
              your phone.
            </p>

            <p className="break-all rounded-xl bg-slate-100 p-5 text-center font-mono text-3xl font-bold">
              {code.ussdCode}
            </p>

            <div className="flex gap-3">
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      code.ussdCode
                    );
                    setNotice('Payment code copied.');
                  } catch {
                    setNotice(
                      'Select and copy the code shown above.'
                    );
                  }
                }}
                className="flex-1 rounded-xl border p-3 font-bold"
              >
                Copy code
              </button>

              {!terminal && code.status === 'pending' && (
                <a
                  href={`tel:${encodeURIComponent(code.ussdCode)}`}
                  className="flex-1 rounded-xl bg-blue-600 p-3 text-center font-bold text-white"
                >
                  Open dialler
                </a>
              )}
            </div>

            <p>
              Expires:{' '}
              {new Date(code.expireTime).toLocaleString()}
            </p>

            <p role="status" className="font-bold">
              {code.confirmed
                ? 'Payment confirmed. Your wallet balance is being refreshed.'
                : `Payment status: ${code.status}`}
            </p>

            {code.status === 'completed' &&
              !code.confirmed && (
                <p>
                  Final payment details are still being
                  verified. Check again before starting
                  another payment.
                </p>
              )}

            <button
              onClick={() => void refresh()}
              disabled={checking}
              className="w-full rounded-xl border p-3 font-bold disabled:opacity-50"
            >
              {checking
                ? 'Checking...'
                : 'Check payment status'}
            </button>

            {terminal && (
              <button
                onClick={newPayment}
                className="w-full rounded-xl bg-slate-900 p-3 font-bold text-white"
              >
                Start another top-up
              </button>
            )}

            <p className="text-sm text-slate-500">
              Closing this screen does not cancel a pending
              payment. Reopen Load to check it.
            </p>
          </>
        )}
      </div>
    </section>
  );
}