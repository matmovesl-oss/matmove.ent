import { useState } from 'react';
import {
  Power,
  MapPin,
  Navigation,
  Wallet,
  Clock,
  ShieldCheck,
  Bell,
  Radio,
} from 'lucide-react';

type DriverBookingStatus =
  | 'pending'
  | 'accepted'
  | 'completed'
  | string;

export function DriverDashboard({
  profile,
  wallet,
  bookings = [],
  onAcceptBooking,
  onCompleteBooking,
  onOpenWithdraw,
}: any) {
  const [isOnline, setIsOnline] = useState(false);
  const [maxRadius, setMaxRadius] = useState<number>(5);

  const driverId = profile?.id;

  const firstName =
    profile?.first_name ||
    profile?.firstName ||
    profile?.full_name?.split(' ')?.[0] ||
    'Driver';

  const kycStatus = String(
    profile?.kyc_status || profile?.kycStatus || ''
  ).toLowerCase();

  const isKycPending =
    kycStatus === 'pending' ||
    kycStatus === 'submitted' ||
    kycStatus === 'under_review';

  const canReceiveTrips = !isKycPending;

  const filteredBookings = bookings.filter((booking: any) => {
    const isRelevantStatus =
      booking.status === 'pending' ||
      booking.driver_id === driverId;

    return isRelevantStatus;
  });

  const handleToggleOnline = () => {
    if (!canReceiveTrips) {
      alert(
        'Your driver account is still under review. You can go online after your verification is approved.'
      );
      return;
    }

    setIsOnline((current) => !current);
  };

  const handleAcceptBooking = (bookingId: string) => {
    if (!canReceiveTrips) {
      alert(
        'Your driver account is still under review. You cannot accept trips yet.'
      );
      return;
    }

    if (!isOnline) {
      alert('Please go online before accepting a trip.');
      return;
    }

    onAcceptBooking?.(bookingId);
  };

  return (
    <div className="flex-1 bg-slate-50 min-h-screen flex flex-col">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleToggleOnline}
            disabled={!canReceiveTrips}
            aria-label={
              isOnline
                ? 'Go offline'
                : 'Go online'
            }
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
              !canReceiveTrips
                ? 'bg-slate-200 cursor-not-allowed'
                : isOnline
                ? 'bg-emerald-500'
                : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                isOnline
                  ? 'translate-x-7'
                  : 'translate-x-1'
              }`}
            />
          </button>

          <div>
            <h2 className="font-bold text-slate-900 text-lg">
              {isOnline
                ? 'You are Online'
                : 'You are Offline'}
            </h2>

            <p className="text-xs text-slate-500">
              {!canReceiveTrips
                ? 'Verification required before receiving trips'
                : isOnline
                ? 'Finding trip requests near you...'
                : 'Go online to start receiving trips'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
            <Radio
              size={14}
              className="text-blue-600"
            />

            <span className="text-xs font-bold text-slate-700">
              Radius:
            </span>

            <select
              value={maxRadius}
              onChange={(e) =>
                setMaxRadius(Number(e.target.value))
              }
              disabled={!canReceiveTrips}
              className="bg-transparent text-xs font-bold text-blue-700 outline-none cursor-pointer disabled:cursor-not-allowed disabled:text-slate-400"
            >
              <option value={2}>2 km</option>
              <option value={5}>5 km</option>
              <option value={10}>10 km</option>
            </select>
          </div>

          <div className="text-right hidden sm:block ml-4">
            <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">
              Driver Wallet
            </div>

            <div className="text-lg font-bold text-slate-900">
              SLE{' '}
              {Number(
                wallet?.balance || 0
              ).toLocaleString()}
            </div>
          </div>

          <button
            type="button"
            aria-label="Notifications"
            className="p-2 text-slate-400 hover:text-slate-600 bg-slate-100 rounded-full relative ml-2"
          >
            <Bell size={20} />

            <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full" />
          </button>
        </div>
      </header>

      {/* Main Interface */}
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Sidebar Panel */}
        <div className="w-full lg:w-96 bg-white border-r border-slate-200 flex flex-col p-6 space-y-6 overflow-y-auto">
          {/* Driver Identity */}
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
            <p className="text-xs font-bold text-blue-600 uppercase tracking-wider">
              Driver account
            </p>

            <h3 className="text-xl font-bold text-slate-900 mt-1">
              Welcome, {firstName}
            </h3>

            <p className="text-xs text-slate-500 mt-1">
              MatMove Driver
            </p>
          </div>

          {/* KYC Status */}
          {isKycPending && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3">
              <Clock
                className="text-amber-500 mt-0.5 shrink-0"
                size={20}
              />

              <div>
                <h4 className="font-bold text-amber-900 text-sm">
                  Account Under Review
                </h4>

                <p className="text-xs text-amber-700 mt-1">
                  Live dispatch is restricted until your
                  driver documents are verified.
                </p>
              </div>
            </div>
          )}

          {/* Wallet & Trips */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
              <div className="text-slate-500 mb-1">
                <Wallet size={20} />
              </div>

              <div className="text-xl font-bold text-slate-900">
                SLE{' '}
                {Number(
                  wallet?.balance || 0
                ).toLocaleString()}
              </div>

              <div className="text-xs font-semibold text-slate-500 uppercase">
                Wallet Balance
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
              <div className="text-slate-500 mb-1">
                <Navigation size={20} />
              </div>

              <div className="text-xl font-bold text-slate-900">
                0
              </div>

              <div className="text-xs font-semibold text-slate-500 uppercase">
                Trips Finished
              </div>
            </div>
          </div>

          {/* Withdraw */}
          <button
            type="button"
            onClick={onOpenWithdraw}
            className="w-full bg-emerald-600 text-white font-bold p-3 rounded-xl hover:bg-emerald-700 transition"
          >
            Withdraw Cash
          </button>

          {/* Dispatch Radar */}
          <div className="flex-1">
            <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
              <MapPin
                size={18}
                className="text-blue-600"
              />
              Dispatch Radar
            </h3>

            {!canReceiveTrips ? (
              <div className="border-2 border-dashed border-amber-200 bg-amber-50 rounded-2xl p-8 text-center flex flex-col items-center justify-center h-48">
                <Clock
                  className="text-amber-500 mb-2"
                  size={32}
                />

                <p className="text-sm font-bold text-amber-700">
                  Verification in progress
                </p>

                <p className="text-xs text-amber-600 mt-1">
                  Trip requests will become available
                  after approval.
                </p>
              </div>
            ) : !isOnline ? (
              <div className="border-2 border-dashed border-slate-200 bg-slate-50 rounded-2xl p-8 text-center flex flex-col items-center justify-center h-48">
                <Power
                  className="text-slate-400 mb-2"
                  size={32}
                />

                <p className="text-sm font-bold text-slate-500">
                  You are offline
                </p>

                <p className="text-xs text-slate-400 mt-1">
                  Go online to receive trip requests.
                </p>
              </div>
            ) : filteredBookings.length === 0 ? (
              <div className="border-2 border-dashed border-emerald-200 bg-emerald-50 rounded-2xl p-8 text-center flex flex-col items-center justify-center h-48 animate-pulse">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-3">
                  <Power size={24} />
                </div>

                <p className="text-sm font-bold text-emerald-700">
                  Listening for requests...
                </p>

                <p className="text-xs text-emerald-600 mt-1">
                  Within {maxRadius} km radius
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredBookings.map(
                  (booking: any) => {
                    const status =
                      booking.status as DriverBookingStatus;

                    return (
                      <div
                        key={booking.id}
                        className="p-4 border border-slate-200 rounded-xl flex flex-col gap-3 bg-slate-50 shadow-sm"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-blue-700 uppercase text-xs bg-blue-100 px-2 py-0.5 rounded">
                              {booking.service_type ||
                                'Ride'}
                            </span>

                            <span className="text-sm font-bold text-slate-900">
                              SLE{' '}
                              {Number(
                                booking.fare_amount || 0
                              ).toLocaleString()}
                            </span>
                          </div>

                          <div className="text-xs text-slate-600 mt-3 flex flex-col gap-2">
                            <span className="flex items-start gap-1.5">
                              <MapPin
                                size={14}
                                className="text-emerald-600 shrink-0 mt-0.5"
                              />

                              <span>
                                {booking.pickup_location ||
                                  'Pickup location unavailable'}
                              </span>
                            </span>

                            <span className="flex items-start gap-1.5">
                              <Navigation
                                size={14}
                                className="text-blue-600 shrink-0 mt-0.5"
                              />

                              <span>
                                {booking.destination_location ||
                                  'Destination unavailable'}
                              </span>
                            </span>
                          </div>
                        </div>

                        {status === 'pending' && (
                          <button
                            type="button"
                            onClick={() =>
                              handleAcceptBooking(
                                booking.id
                              )
                            }
                            disabled={!isOnline}
                            className="w-full bg-emerald-600 text-white py-2.5 rounded-lg font-bold text-xs hover:bg-emerald-700 transition disabled:bg-slate-300 disabled:cursor-not-allowed"
                          >
                            {isOnline
                              ? 'Accept Trip'
                              : 'Go Online to Accept'}
                          </button>
                        )}

                        {status === 'accepted' && (
                          <button
                            type="button"
                            onClick={() =>
                              onCompleteBooking?.(
                                booking.id
                              )
                            }
                            className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-bold text-xs hover:bg-blue-700 transition"
                          >
                            Complete Trip
                          </button>
                        )}

                        {status === 'completed' && (
                          <div className="w-full text-center text-xs font-bold text-emerald-600 bg-emerald-50 py-2 rounded-lg">
                            Completed
                          </div>
                        )}
                      </div>
                    );
                  }
                )}
              </div>
            )}
          </div>
        </div>

        {/* Live Map Area */}
        <div className="flex-1 bg-slate-200 relative min-h-[400px]">
          <iframe
            title="Driver Map"
            width="100%"
            height="100%"
            className="absolute inset-0 border-0"
            src="https://maps.google.com/maps?q=Freetown,Sierra%20Leone&t=&z=14&ie=UTF8&iwloc=&output=embed"
          />

          <div className="absolute top-6 left-6 bg-white/95 backdrop-blur-sm px-4 py-3 rounded-2xl shadow-lg border border-slate-200">
            <p className="text-xs font-bold text-slate-900">
              {isOnline
                ? 'Driver status: Online'
                : 'Driver status: Offline'}
            </p>

            <p className="text-xs text-slate-500 mt-1">
              {canReceiveTrips
                ? `Dispatch radius: ${maxRadius} km`
                : 'Waiting for verification approval'}
            </p>
          </div>

          <div className="absolute bottom-6 right-6 bg-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 border border-slate-200">
            <ShieldCheck
              className="text-emerald-600"
              size={18}
            />

            <span className="text-xs font-bold text-slate-700">
              MatMove GPS Protected
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}