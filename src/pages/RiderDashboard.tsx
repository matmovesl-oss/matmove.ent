import { useState, useEffect } from 'react';
import {
  Car,
  Package,
  Truck,
  Navigation,
  MapPin,
  ShieldCheck,
  CreditCard,
  Smartphone,
  X,
  Wallet,
  Bell,
} from 'lucide-react';

type VehicleType = 'car' | 'keke' | 'bike' | 'truck';

export function RiderDashboard({
  profile,
  wallet,
  onOpenBooking,
  onOpenTopUp,
}: any) {
  const [selectedVehicle, setSelectedVehicle] =
    useState<VehicleType>('car');

  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [fareEstimate, setFareEstimate] = useState<number | null>(null);

  // Fallback Top-Up Modal
  // PortalApp normally controls the wallet top-up flow.
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [provider, setProvider] = useState<
    'orange' | 'africell' | 'flot' | 'vult'
  >('orange');
  const [topUpAmount, setTopUpAmount] = useState('');
  const [phone, setPhone] = useState('');

  const vehicleOptions = [
    {
      id: 'car',
      name: 'MatMove Comfort',
      icon: Car,
      base: 15,
      perKm: 7,
    },
    {
      id: 'keke',
      name: 'Keke Tricycle',
      icon: Package,
      base: 10,
      perKm: 4,
    },
    {
      id: 'bike',
      name: 'Express Bike',
      icon: Navigation,
      base: 8,
      perKm: 3,
    },
    {
      id: 'truck',
      name: 'Haulage Truck',
      icon: Truck,
      base: 80,
      perKm: 20,
    },
  ];

  /*
   * Temporary visual fare estimate.
   *
   * The production fare will eventually come from the backend
   * using the actual route distance. The rider cannot manually
   * change the calculated amount.
   */
  useEffect(() => {
    if (!pickup || !destination) {
      setFareEstimate(null);
      return;
    }

    const activeVehicle = vehicleOptions.find(
      (vehicle) => vehicle.id === selectedVehicle
    );

    const simulatedDistanceKm = 6.5;

    const calculated =
      (activeVehicle?.base || 15) +
      simulatedDistanceKm * (activeVehicle?.perKm || 7);

    setFareEstimate(Math.round(calculated));
  }, [pickup, destination, selectedVehicle]);

  const handleTriggerTopUp = () => {
    if (onOpenTopUp) {
      onOpenTopUp();
      return;
    }

    setIsTopUpModalOpen(true);
  };

  const firstName =
    profile?.first_name ||
    profile?.firstName ||
    profile?.full_name?.split(' ')?.[0] ||
    'Rider';

  return (
    <div className="flex-1 bg-slate-50 min-h-screen">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="w-1/2">
          <input
            type="text"
            placeholder="Search rides, destinations, receipts..."
            className="w-full bg-slate-100 border-none rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-600 outline-none"
          />
        </div>

        <div className="flex items-center gap-6">
          <button
            className="relative text-slate-400 hover:text-slate-600"
            aria-label="Notifications"
          >
            <Bell size={20} />
          </button>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full uppercase">
              Rider
            </span>

            <span className="text-sm font-bold text-slate-800">
              {firstName}
            </span>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-6xl mx-auto space-y-8">
        {/* User Greeting & Quick Actions */}
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">
              Where to, {firstName}? 👋
            </h1>

            <p className="text-slate-500 mt-1">
              Book a ride or delivery across Sierra Leone
            </p>
          </div>

          <button
            onClick={handleTriggerTopUp}
            className="bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-emerald-700 transition shadow-sm"
          >
            + Load Wallet
          </button>
        </div>

        {/* Balance & Protection Banner */}
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 bg-blue-700 rounded-3xl p-6 text-white relative overflow-hidden shadow-lg flex justify-between items-center">
            <div>
              <span className="text-blue-200 text-xs font-bold uppercase tracking-wider">
                Available Rider Wallet
              </span>

              <div className="text-4xl font-bold mt-1">
                SLE {Number(wallet?.balance || 0).toLocaleString()}
              </div>

              <button
                onClick={handleTriggerTopUp}
                className="mt-4 bg-white/20 hover:bg-white/30 transition px-5 py-2 rounded-xl text-xs font-bold backdrop-blur-sm"
              >
                Top-Up via Merchant
              </button>
            </div>

            <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-sm">
              <Wallet size={36} className="text-white" />
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
            <ShieldCheck
              size={32}
              className="text-emerald-600 mb-2"
            />

            <h3 className="font-bold text-slate-900 text-base">
              Protected Journeys
            </h3>

            <p className="text-slate-500 text-xs mt-1">
              Verified drivers with GPS journey tracking and automated
              wallet settlement.
            </p>
          </div>
        </div>

        {/* Trip Request & Map */}
        <div className="grid grid-cols-3 gap-8 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="col-span-1 space-y-4">
            <h3 className="font-bold text-slate-900 text-lg">
              Request a Trip
            </h3>

            {/* Pickup */}
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">
                Pickup Location
              </label>

              <div className="flex items-center gap-2 border border-slate-300 rounded-xl p-3 mt-1">
                <MapPin
                  size={16}
                  className="text-emerald-600 shrink-0"
                />

                <input
                  type="text"
                  placeholder="e.g. Lumley Junction, Freetown"
                  value={pickup}
                  onChange={(e) => setPickup(e.target.value)}
                  className="w-full text-sm outline-none bg-transparent"
                />
              </div>
            </div>

            {/* Destination */}
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">
                Destination
              </label>

              <div className="flex items-center gap-2 border border-slate-300 rounded-xl p-3 mt-1">
                <Navigation
                  size={16}
                  className="text-blue-600 shrink-0"
                />

                <input
                  type="text"
                  placeholder="e.g. Cotton Tree, Central Freetown"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  className="w-full text-sm outline-none bg-transparent"
                />
              </div>
            </div>

            {/* Vehicle Options */}
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">
                Select Vehicle Option
              </label>

              <div className="grid grid-cols-2 gap-2 mt-2">
                {vehicleOptions.map((vehicle) => {
                  const VehicleIcon = vehicle.icon;
                  const isSelected =
                    selectedVehicle === vehicle.id;

                  return (
                    <button
                      key={vehicle.id}
                      type="button"
                      onClick={() =>
                        setSelectedVehicle(
                          vehicle.id as VehicleType
                        )
                      }
                      className={`p-3 rounded-xl border text-left transition ${
                        isSelected
                          ? 'border-blue-600 bg-blue-50/50 ring-2 ring-blue-600/20'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <VehicleIcon
                        size={18}
                        className={
                          isSelected
                            ? 'text-blue-600'
                            : 'text-slate-500'
                        }
                      />

                      <div className="font-bold text-xs text-slate-900 mt-1">
                        {vehicle.name}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Estimated Fare */}
            {fareEstimate !== null && (
              <div className="p-4 bg-slate-900 text-white rounded-2xl flex justify-between items-center">
                <div>
                  <span className="text-xs text-slate-400 block uppercase font-bold">
                    Estimated Fare
                  </span>

                  <span className="text-2xl font-bold text-emerald-400">
                    SLE {fareEstimate.toLocaleString()}
                  </span>
                </div>

                <span className="text-xs bg-white/10 px-2 py-1 rounded text-slate-300 font-semibold">
                  Read-Only
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={onOpenBooking}
              className="w-full bg-blue-600 text-white font-bold p-3.5 rounded-xl hover:bg-blue-700 transition shadow-sm"
            >
              Confirm{' '}
              {
                vehicleOptions.find(
                  (vehicle) => vehicle.id === selectedVehicle
                )?.name
              }{' '}
              Request
            </button>
          </div>

          {/* Current Map */}
          <div className="col-span-2 bg-slate-100 rounded-2xl relative overflow-hidden border border-slate-200 min-h-[380px] flex items-center justify-center">
            <iframe
              title="Sierra Leone Map"
              width="100%"
              height="100%"
              className="absolute inset-0 border-0"
              src="https://maps.google.com/maps?q=Freetown,Sierra%20Leone&t=&z=13&ie=UTF8&iwloc=&output=embed"
            />

            <div className="absolute bottom-4 left-4 right-4 bg-white/95 backdrop-blur-sm rounded-xl px-4 py-3 shadow-lg border border-slate-200">
              <p className="text-xs font-bold text-slate-700">
                Route selection
              </p>

              <p className="text-xs text-slate-500 mt-1">
                Enter your pickup and destination above. Interactive
                map selection will be connected to the live booking
                system in the next stage.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Fallback Direct Payment Channel Modal */}
      {isTopUpModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setIsTopUpModalOpen(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full"
              aria-label="Close top-up modal"
            >
              <X size={20} />
            </button>

            <h2 className="text-2xl font-bold text-slate-900 mb-1">
              Top-Up MatMove Wallet
            </h2>

            <p className="text-xs text-slate-500 mb-6">
              Select your payment merchant partner to load funds.
            </p>

            <div className="space-y-4">
              <label className="block text-xs font-bold text-slate-700 uppercase">
                Payment Channel
              </label>

              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    id: 'orange',
                    name: 'Orange Money',
                    icon: Smartphone,
                    color: 'text-orange-600',
                    bg: 'bg-orange-50',
                  },
                  {
                    id: 'africell',
                    name: 'Afrimoney',
                    icon: Smartphone,
                    color: 'text-purple-600',
                    bg: 'bg-purple-50',
                  },
                  {
                    id: 'flot',
                    name: 'Flot Pay',
                    icon: CreditCard,
                    color: 'text-emerald-600',
                    bg: 'bg-emerald-50',
                  },
                  {
                    id: 'vult',
                    name: 'Vult Pay',
                    icon: ShieldCheck,
                    color: 'text-indigo-600',
                    bg: 'bg-indigo-50',
                  },
                ].map((paymentProvider) => {
                  const ProviderIcon = paymentProvider.icon;

                  return (
                    <button
                      key={paymentProvider.id}
                      type="button"
                      onClick={() =>
                        setProvider(
                          paymentProvider.id as
                            | 'orange'
                            | 'africell'
                            | 'flot'
                            | 'vult'
                        )
                      }
                      className={`p-3 border rounded-xl cursor-pointer transition flex items-center gap-3 ${
                        provider === paymentProvider.id
                          ? 'border-blue-600 bg-blue-50/50 ring-2 ring-blue-600/20'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div
                        className={`p-2 rounded-lg ${paymentProvider.bg} ${paymentProvider.color}`}
                      >
                        <ProviderIcon size={18} />
                      </div>

                      <span className="text-xs font-bold text-slate-900">
                        {paymentProvider.name}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mt-4 mb-1">
                  Amount (SLE)
                </label>

                <input
                  type="number"
                  min="1"
                  placeholder="e.g. 200"
                  value={topUpAmount}
                  onChange={(e) =>
                    setTopUpAmount(e.target.value)
                  }
                  className="w-full border border-slate-300 p-3 rounded-xl text-lg font-bold outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {(provider === 'orange' ||
                provider === 'africell') && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Mobile Money Number
                  </label>

                  <input
                    type="text"
                    placeholder="e.g. 076 123456 / 088 123456"
                    value={phone}
                    onChange={(e) =>
                      setPhone(e.target.value)
                    }
                    className="w-full border border-slate-300 p-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  alert(
                    `Processing SLE ${
                      topUpAmount || '0'
                    } top-up via ${
                      provider === 'vult'
                        ? 'VULT PAY'
                        : provider === 'flot'
                        ? 'FLOT PAY'
                        : provider.toUpperCase()
                    }`
                  );

                  setIsTopUpModalOpen(false);
                }}
                className="w-full bg-blue-600 text-white font-bold p-3.5 rounded-xl hover:bg-blue-700 transition mt-4"
              >
                Pay via{' '}
                {provider === 'vult'
                  ? 'VULT PAY'
                  : provider === 'flot'
                  ? 'FLOT PAY'
                  : provider.toUpperCase()}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}