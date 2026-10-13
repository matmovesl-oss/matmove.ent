import {
  useEffect,
  useRef,
  useState
} from 'react';

import {
  payoutRequest,
  type PayoutQuote,
  type PayoutRequest,
  type Withdrawal
} from '@/services/payoutService';

const sle = (minor: number) =>
  `SLE ${(minor / 100).toFixed(2)}`;

const terminal = (state: string) =>
  [
    'completed',
    'fee_failed',
    'refunded',
    'review_required'
  ].includes(state);

type Saved = {
  request: PayoutRequest;
  withdrawal?: Withdrawal;
};

export default function PayoutPanel({
  userId,
  allowed,
  onClose,
  onBalanceChange
}: {
  userId: string;
  allowed: boolean;
  onClose: () => void;
  onBalanceChange: () => unknown;
}) {
  const storageKey =
    `matmove-payout:${userId}`;

  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [network, setNetwork] =
    useState('orange');

  const [quote, setQuote] =
    useState<PayoutQuote | null>(null);

  const [saved, setSaved] =
    useState<Saved | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [
    storageAvailable,
    setStorageAvailable
  ] = useState(true);

  const panel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    panel.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });

    try {
      const raw =
        localStorage.getItem(storageKey);

      if (raw) {
        const value =
          JSON.parse(raw) as Saved;

        if (
          value.request?.action === 'submit' &&
          typeof value.request.idempotencyKey ===
            'string'
        ) {
          setSaved(value);
          setAmount(value.request.amount);
          setPhone(
            value.request.destinationPhone
          );
          setNetwork(
            value.request.networkProvider
          );
        }
      }
    } catch {
      setStorageAvailable(false);
      setError(
        'Browser storage is unavailable. Enable storage before submitting a payout.'
      );
    }

    return () => {
      mounted.current = false;
    };
  }, [storageKey]);

  function persist(value: Saved) {
    localStorage.setItem(
      storageKey,
      JSON.stringify(value)
    );

    setSaved(value);
  }

  function resetQuote() {
    setQuote(null);
    setError('');
  }

  async function preview() {
    if (inFlight.current || !allowed) {
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setError('');

    try {
      const result = await payoutRequest({
        action: 'quote',
        amount,
        currency: 'SLE',
        destinationPhone: phone,
        networkProvider: network,
        idempotencyKey:
          crypto.randomUUID()
      });

      if (!result.quote) {
        throw new Error(
          'No payout fee quote was returned.'
        );
      }

      setQuote(result.quote);
    } catch (e: any) {
      setError(e.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function check(value: Saved) {
    const result = await payoutRequest(
      value.withdrawal
        ? {
            action: 'status',
            withdrawalId:
              value.withdrawal.id
          }
        : value.request
    );

    if (!result.withdrawal) {
      throw new Error(
        'No withdrawal receipt was returned. Check this same request again.'
      );
    }

    const next = {
      ...value,
      withdrawal: result.withdrawal
    };

    if (mounted.current) {
      persist(next);
    }

    await onBalanceChange();
  }

  async function submitOrCheck() {
    if (inFlight.current) return;

    if (
      !saved &&
      (
        !quote?.affordable ||
        !allowed ||
        !storageAvailable
      )
    ) {
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setError('');

    try {
      const value: Saved = saved || {
        request: {
          action: 'submit',
          amount,
          currency: 'SLE',
          destinationPhone: phone,
          networkProvider: network,
          acceptedTotalMinor:
            quote!.totalMinor,
          idempotencyKey:
            crypto.randomUUID()
        }
      };

      // Save the request key before sending money.
      if (!saved) persist(value);

      await check(value);
    } catch (e: any) {
      if (mounted.current) {
        setError(
          `${e.message} Use Check status for this same request; do not submit another payout.`
        );
      }
    } finally {
      inFlight.current = false;

      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  function newWithdrawal() {
    if (busy) return;

    const state =
      saved?.withdrawal?.state;

    if (
      !state ||
      ![
        'completed',
        'fee_failed',
        'refunded'
      ].includes(state)
    ) {
      return;
    }

    try {
      localStorage.removeItem(storageKey);
    } catch {
      setError(
        'Could not clear this request.'
      );
      return;
    }

    setSaved(null);
    setQuote(null);
    setAmount('');
    setPhone('');
    setError('');
  }

  const withdrawal = saved?.withdrawal;
  const breakdown = withdrawal || quote;

  return (
    <div
      ref={panel}
      className="my-6 rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold">
          Withdraw to Mobile Money
        </h2>

        <button
          disabled={busy}
          onClick={onClose}
          className="rounded-lg border px-3 py-2 disabled:opacity-50"
        >
          Close
        </button>
      </div>

      <p className="mt-2 text-sm text-slate-500">
        Enter the amount the recipient will receive.
        Monime charges 1% and MatMove charges 0.58%,
        added on top and rounded to cents.
      </p>

      {!saved && (
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold">
            Amount recipient receives (SLE)

            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              disabled={busy}
              onChange={e => {
                setAmount(e.target.value);
                resetQuote();
              }}
              className="mt-1 w-full rounded-xl border p-3"
            />
          </label>

          <label className="block text-sm font-semibold">
            Mobile money provider

            <select
              value={network}
              disabled={busy}
              onChange={e => {
                setNetwork(e.target.value);
                resetQuote();
              }}
              className="mt-1 w-full rounded-xl border p-3"
            >
              <option value="orange">
                Orange Money
              </option>
              <option value="afrimoney">
                AfriMoney
              </option>
            </select>
          </label>

          <label className="block text-sm font-semibold">
            Recipient phone

            <input
              type="tel"
              value={phone}
              disabled={busy}
              placeholder="077123456 or 030123456"
              onChange={e => {
                setPhone(e.target.value);
                resetQuote();
              }}
              className="mt-1 w-full rounded-xl border p-3"
            />
          </label>

          <button
            disabled={
              busy ||
              !allowed ||
              !amount ||
              !phone
            }
            onClick={() => void preview()}
            className="rounded-xl border px-4 py-3 font-bold disabled:opacity-50"
          >
            {busy
              ? 'Checking...'
              : 'Review fees'}
          </button>
        </div>
      )}

      {breakdown && (
        <dl className="mt-4 space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between">
            <dt>Recipient receives</dt>
            <dd className="font-bold">
              {sle(breakdown.amountMinor)}
            </dd>
          </div>

          <div className="flex justify-between">
            <dt>Monime fee (1%)</dt>
            <dd>
              {sle(breakdown.monimeFeeMinor)}
            </dd>
          </div>

          <div className="flex justify-between">
            <dt>MatMove fee (0.58%)</dt>
            <dd>
              {sle(breakdown.platformFeeMinor)}
            </dd>
          </div>

          <div className="flex justify-between border-t pt-2 font-bold">
            <dt>
              {withdrawal
                ? 'Quoted total wallet debit'
                : 'Total wallet debit'}
            </dt>
            <dd>
              {sle(breakdown.totalMinor)}
            </dd>
          </div>

          {!withdrawal && quote && (
            <div className="flex justify-between">
              <dt>Available balance</dt>
              <dd>
                {sle(quote.availableMinor)}
              </dd>
            </div>
          )}

          {withdrawal && (
            <div className="flex justify-between">
              <dt>Recipient phone</dt>
              <dd>{withdrawal.phone}</dd>
            </div>
          )}

          {withdrawal?.actualTotalMinor != null && (
            <div className="flex justify-between font-bold">
              <dt>Confirmed total wallet debit</dt>
              <dd>
                {sle(withdrawal.actualTotalMinor)}
              </dd>
            </div>
          )}
        </dl>
      )}

      {quote &&
        !quote.affordable &&
        !saved && (
          <p
            role="alert"
            className="mt-3 text-red-700"
          >
            Insufficient balance for the amount
            and both fees.
          </p>
        )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-red-50 p-3 text-red-700"
        >
          {error}
        </p>
      )}

      {!allowed && !saved && (
        <p
          role="alert"
          className="mt-3 text-amber-800"
        >
          Your wallet must be unfrozen and approved
          where required before withdrawing.
        </p>
      )}

      {withdrawal && (
        <div
          role="status"
          className={`mt-4 rounded-xl p-4 ${
            withdrawal.state === 'completed'
              ? 'bg-emerald-50 text-emerald-800'
              : 'bg-amber-50 text-amber-900'
          }`}
        >
          <p className="font-bold">
            {withdrawal.state === 'completed'
              ? 'Payout completed'
              : withdrawal.state === 'refunded'
                ? 'Payout not completed; MatMove fee refunded'
                : withdrawal.state === 'fee_failed'
                  ? 'Fee transfer failed; no payout sent'
                  : withdrawal.state === 'review_required'
                    ? 'Support review required'
                    : 'Withdrawal processing'}
          </p>

          {withdrawal.state === 'completed' && (
            <p>
              {sle(withdrawal.amountMinor)} sent to
              your mobile money number. Total wallet
              debit: {sle(withdrawal.totalMinor)}.
            </p>
          )}

          {withdrawal.error && (
            <p className="mt-2">
              {withdrawal.error}
            </p>
          )}

          {withdrawal.actualMonimeFeeMinor !== null &&
            withdrawal.actualMonimeFeeMinor !==
              withdrawal.monimeFeeMinor && (
              <p className="mt-2">
                Monime reported{' '}
                {sle(withdrawal.actualMonimeFeeMinor)}
                {' '}in fees instead of the quoted{' '}
                {sle(withdrawal.monimeFeeMinor)}.
                Support must reconcile this difference.
              </p>
            )}

          <p className="mt-2 break-all text-xs">
            Withdrawal ID: {withdrawal.id}
          </p>

          {withdrawal.receipts.map(receipt => (
            <p
              key={receipt.kind}
              className="mt-1 break-all text-xs"
            >
              {receipt.kind}: {receipt.status}
              {receipt.id
                ? ` — ${receipt.id}`
                : ''}
            </p>
          ))}

          {withdrawal.state === 'review_required' && (
            <p className="mt-2">
              Do not submit another withdrawal
              for this payment.
            </p>
          )}
        </div>
      )}

      {(
        !withdrawal ||
        !terminal(withdrawal.state)
      ) &&
        (saved || quote) && (
          <button
            disabled={
              busy ||
              (
                !saved &&
                (
                  !quote?.affordable ||
                  !allowed ||
                  !storageAvailable
                )
              )
            }
            onClick={() =>
              void submitOrCheck()
            }
            className="mt-4 rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white disabled:opacity-50"
          >
            {busy
              ? 'Processing...'
              : saved
                ? 'Check status'
                : `Confirm — debit ${sle(quote!.totalMinor)}`}
          </button>
        )}

      {withdrawal &&
        [
          'completed',
          'fee_failed',
          'refunded'
        ].includes(withdrawal.state) && (
          <button
            disabled={busy}
            onClick={newWithdrawal}
            className="mt-4 rounded-xl border px-4 py-3 font-bold"
          >
            New withdrawal
          </button>
        )}
    </div>
  );
}