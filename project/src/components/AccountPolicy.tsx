export function AccountPolicy() {
  return (
    <details className="rounded-3xl border border-slate-200 bg-white p-6 mb-6">
      <summary className="cursor-pointer text-lg font-bold text-slate-900">
        MatMove Safety & Compliance Policy
      </summary>

      <div className="mt-4 text-sm text-slate-600 space-y-4">
        <p>
          <strong>1. Compliance with SLRSA:</strong>{' '}
          All users (Drivers, Riders, and Merchants)
          must strictly adhere to the traffic rules
          and regulations set forth by the Sierra
          Leone Road Safety Authority (SLRSA).
        </p>

        <p>
          <strong>2. Liability & Accidents:</strong>{' '}
          MatMove Enterprise acts solely as a
          technology platform connecting users.
          MatMove is not liable for any road traffic
          accidents, injuries, loss of property, or
          damages that occur during transit.
        </p>

        <p>
          <strong>3. Vehicle Safety:</strong>{' '}
          Drivers must ensure their vehicles
          (Keke, Bike, Car, Van) are roadworthy,
          insured, and licensed.
        </p>

        <p>
          <strong>4. Account Suspension:</strong>{' '}
          Any violation of these safety policies
          or reports of reckless behavior will
          result in immediate wallet freezing
          and account suspension.
        </p>

        <p className="font-bold text-slate-900 pt-2 border-t">
          This is the safety policy displayed during
          onboarding. For questions, contact
          MatMove support.
        </p>
      </div>
    </details>
  );
}