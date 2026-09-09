import {
  useState,
  useEffect,
  useCallback,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { RiderDashboard } from './RiderDashboard';
import { DriverDashboard } from './DriverDashboard';
import { MerchantDashboard } from './MerchantDashboard';
import { WalletPage } from './WalletPage';
import {
  X,
  CheckCircle2,
  Calculator,
  AlertCircle,
  Home,
  Wallet,
  Navigation,
  Headphones,
  UserCircle,
  Smartphone,
  CreditCard,
  Landmark,
  LogOut,
  Mail,
  Phone,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';

type WalletAction =
  | 'topup'
  | 'withdraw';

type TopUpMethod =
  | 'mobile_money'
  | 'card'
  | 'vault_float';

type PortalSection =
  | 'home'
  | 'wallet'
  | 'trips'
  | 'support'
  | 'account';

type CustomerRole =
  | 'rider'
  | 'driver'
  | 'merchant';

function getRoleFromPath(
  pathname: string
): CustomerRole | null {
  const normalized =
    pathname.toLowerCase();

  if (
    normalized.startsWith(
      '/customer/driver'
    )
  ) {
    return 'driver';
  }

  if (
    normalized.startsWith(
      '/customer/merchant'
    )
  ) {
    return 'merchant';
  }

  if (
    normalized.startsWith(
      '/customer/rider'
    )
  ) {
    return 'rider';
  }

  return null;
}

function isCustomerRole(
  value: string
): value is CustomerRole {
  return (
    value === 'rider' ||
    value === 'driver' ||
    value === 'merchant'
  );
}

function getCanonicalPortalPath(
  role: CustomerRole
): string {
  return `/customer/${role}`;
}

export function PortalApp() {
  const navigate = useNavigate();
  const location = useLocation();

  const [profile, setProfile] =
    useState<any>(null);

  const [wallet, setWallet] =
    useState<any>(null);

  const [bookings, setBookings] =
    useState<any[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [portalError, setPortalError] =
    useState('');

  const [activeSection, setActiveSection] =
    useState<PortalSection>('home');

  const [isWalletModalOpen, setIsWalletModalOpen] =
    useState(false);

  const [walletAction, setWalletAction] =
    useState<WalletAction>('topup');

  const [amount, setAmount] =
    useState('');

  const [topUpMethod, setTopUpMethod] =
    useState<TopUpMethod | null>(null);

  const [isBookingOpen, setIsBookingOpen] =
    useState(false);

  const [serviceType, setServiceType] =
    useState<
      'ride' | 'delivery' | 'truck' | 'bus'
    >('ride');

  const [pickup, setPickup] =
    useState('');

  const [destination, setDestination] =
    useState('');

  const [calculatedFare, setCalculatedFare] =
    useState<number>(30);

  const [processing, setProcessing] =
    useState(false);

  const [successMsg, setSuccessMsg] =
    useState('');

  const [loggingOut, setLoggingOut] =
    useState(false);

  const fetchUserData =
    useCallback(async () => {
      try {
        setPortalError('');
        setLoading(true);

        const {
          data: {
            session,
          },
          error: sessionError,
        } =
          await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        if (!session?.user) {
          setPortalError(
            'No active user session found. Please sign in again.'
          );
          return;
        }

        const userId =
          session.user.id;

        const pathRole =
          getRoleFromPath(
            location.pathname
          );

        const {
          data: profileData,
          error: profileError,
        } =
          await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle();

        if (profileError) {
          console.warn(
            'Could not load profile:',
            profileError.message
          );
        }

        const {
          data: rolesData,
          error: rolesError,
        } =
          await supabase
            .from('user_roles')
            .select('role')
            .eq('profile_id', userId);

        if (rolesError) {
          console.warn(
            'Could not load user roles:',
            rolesError.message
          );
        }

        const databaseRoles =
          (rolesData || [])
            .map(
              (item) =>
                String(
                  item.role || ''
                ).toLowerCase()
            )
            .filter(
              isCustomerRole
            ) as CustomerRole[];

        const profileRole =
          profileData?.role
            ? String(
                profileData.role
              ).toLowerCase()
            : '';

        let resolvedRole: CustomerRole | '' =
          '';

        if (
          isCustomerRole(
            profileRole
          )
        ) {
          resolvedRole =
            profileRole;
        } else if (
          databaseRoles.length > 0
        ) {
          resolvedRole =
            databaseRoles[0];
        } else if (
          pathRole
        ) {
          resolvedRole =
            pathRole;
        }

        if (
          profileRole ===
          'admin'
        ) {
          setPortalError(
            'This is an administrator account. Please use the MatMove Admin system.'
          );
          return;
        }

        if (
          !resolvedRole
        ) {
          setPortalError(
            'Your customer role has not been configured yet. Please complete account setup.'
          );
          return;
        }

        const canonicalPath =
          getCanonicalPortalPath(
            resolvedRole
          );

        if (
          location.pathname !==
          canonicalPath
        ) {
          navigate(
            canonicalPath,
            {
              replace: true,
            }
          );
        }

        const {
          data: walletData,
          error: walletError,
        } =
          await supabase
            .from('wallets')
            .select('*')
            .eq(
              'user_id',
              userId
            )
            .order(
              'currency',
              {
                ascending: true,
              }
            );

        if (walletError) {
          console.warn(
            'Could not load wallets:',
            walletError.message
          );
        }

        const wallets =
          walletData || [];

        const sleWallet =
          wallets.find(
            (item) =>
              String(
                item.currency ||
                  ''
              ).toUpperCase() ===
              'SLE'
          );

        const primaryWallet =
          sleWallet ||
          wallets[0] ||
          {
            balance: 0,
            reserved_balance: 0,
            currency: 'SLE',
          };

        const resolvedWallet = {
          ...primaryWallet,
          wallets,
        };

        let bookingQuery =
          supabase
            .from('bookings')
            .select('*')
            .order(
              'created_at',
              {
                ascending: false,
              }
            );

        if (
          resolvedRole ===
          'driver'
        ) {
          bookingQuery =
            bookingQuery.or(
              `status.eq.pending,driver_id.eq.${userId}`
            );
        } else if (
          resolvedRole ===
          'rider'
        ) {
          bookingQuery =
            bookingQuery.eq(
              'rider_id',
              userId
            );
        } else {
          bookingQuery =
            bookingQuery.eq(
              'rider_id',
              '00000000-0000-0000-0000-000000000000'
            );
        }

        const {
          data: bookingData,
          error: bookingError,
        } =
          await bookingQuery;

        if (bookingError) {
          console.warn(
            'Could not load bookings:',
            bookingError.message
          );
        }

        const resolvedProfile =
          {
            ...(profileData || {}),
            id: userId,
            email:
              profileData?.email ||
              session.user.email ||
              '',
            phone:
              profileData?.phone ||
              session.user.phone ||
              '',
            role:
              resolvedRole,
          };

        setProfile(
          resolvedProfile
        );

        setWallet(
          resolvedWallet
        );

        setBookings(
          bookingData || []
        );
      } catch (err: any) {
        console.error(
          'Error fetching portal state:',
          err
        );

        setPortalError(
          err?.message ||
            'Unable to load your MatMove account.'
        );
      } finally {
        setLoading(false);
      }
    }, [
      location.pathname,
      navigate,
    ]);

  useEffect(() => {
    fetchUserData();

    const bookingChannel =
      supabase
        .channel(
          `portal-booking-changes-${Date.now()}`
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'bookings',
          },
          () => {
            fetchUserData();
          }
        )
        .subscribe();

    const walletChannel =
      supabase
        .channel(
          `portal-wallet-changes-${Date.now()}`
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'wallets',
          },
          () => {
            fetchUserData();
          }
        )
        .subscribe();

    return () => {
      supabase.removeChannel(
        bookingChannel
      );

      supabase.removeChannel(
        walletChannel
      );
    };
  }, [
    fetchUserData,
  ]);

  useEffect(() => {
    const fetchEstimatedFare =
      async () => {
        const estimatedDistanceKm =
          pickup &&
          destination
            ? 8.5
            : 4.0;

        const {
          data,
          error,
        } =
          await supabase.rpc(
            'calculate_trip_fare',
            {
              p_service_type:
                serviceType,
              p_distance_km:
                estimatedDistanceKm,
            }
          );

        if (
          !error &&
          data !== null &&
          data !== undefined
        ) {
          setCalculatedFare(
            Number(data)
          );
        }
      };

    if (
      isBookingOpen &&
      profile?.role ===
        'rider'
    ) {
      fetchEstimatedFare();
    }
  }, [
    serviceType,
    pickup,
    destination,
    isBookingOpen,
    profile?.role,
  ]);

  const handleCreateBooking =
    async (
      e: FormEvent
    ) => {
      e.preventDefault();

      if (!profile?.id) {
        alert(
          'Your account is still loading. Please try again.'
        );
        return;
      }

      const role =
        String(
          profile?.role ||
            ''
        ).toLowerCase();

      if (
        role !== 'rider'
      ) {
        alert(
          'Only rider accounts can create customer bookings.'
        );
        return;
      }

      setProcessing(true);

      try {
        const {
          error,
        } =
          await supabase
            .from('bookings')
            .insert({
              rider_id:
                profile.id,
              service_type:
                serviceType,
              pickup_location:
                pickup,
              destination_location:
                destination,
              fare_amount:
                calculatedFare,
              status:
                'pending',
            });

        if (error) {
          throw error;
        }

        setSuccessMsg(
          'Booking requested! Nearby drivers have been notified.'
        );

        setPickup('');
        setDestination('');

        await fetchUserData();

        setTimeout(() => {
          setIsBookingOpen(
            false
          );
          setSuccessMsg('');
        }, 2000);
      } catch (err: any) {
        alert(
          err.message ||
            'Booking request failed.'
        );
      } finally {
        setProcessing(false);
      }
    };

  const handleAcceptTrip =
    async (
      bookingId: string
    ) => {
      if (!profile?.id) {
        return;
      }

      const role =
        String(
          profile?.role ||
            ''
        ).toLowerCase();

      if (
        role !== 'driver'
      ) {
        alert(
          'Only driver accounts can accept trips.'
        );
        return;
      }

      try {
        const {
          error,
        } =
          await supabase
            .from('bookings')
            .update({
              status:
                'accepted',
              driver_id:
                profile.id,
            })
            .eq(
              'id',
              bookingId
            )
            .eq(
              'status',
              'pending'
            );

        if (error) {
          throw error;
        }

        await fetchUserData();
      } catch (err: any) {
        alert(
          err.message ||
            'Could not accept trip.'
        );
      }
    };

  const handleCompleteTrip =
    async (
      bookingId: string
    ) => {
      if (!profile?.id) {
        return;
      }

      const role =
        String(
          profile?.role ||
            ''
        ).toLowerCase();

      if (
        role !== 'driver'
      ) {
        alert(
          'Only driver accounts can complete trips.'
        );
        return;
      }

      try {
        const {
          error,
        } =
          await supabase.rpc(
            'complete_and_settle_trip',
            {
              p_booking_id:
                bookingId,
              p_driver_id:
                profile.id,
            }
          );

        if (error) {
          throw error;
        }

        alert(
          'Trip completed successfully! The system has processed the trip settlement.'
        );

        await fetchUserData();
      } catch (err: any) {
        alert(
          err.message ||
            'Failed to settle trip payment.'
        );
      }
    };

  const openWalletPage =
    () => {
      setSuccessMsg('');
      setActiveSection(
        'wallet'
      );
    };

  const closeWalletPage =
    () => {
      setActiveSection(
        'home'
      );
      setSuccessMsg('');
    };

  const openRiderTopUp =
    () => {
      const role =
        String(
          profile?.role ||
            ''
        ).toLowerCase();

      if (
        role !== 'rider'
      ) {
        alert(
          'Only riders can fund their MatMove wallet.'
        );
        return;
      }

      setWalletAction(
        'topup'
      );
      setTopUpMethod(null);
      setAmount('');
      setSuccessMsg('');
      setIsWalletModalOpen(
        true
      );
    };

  const openWalletWithdrawal =
    () => {
      const role =
        String(
          profile?.role ||
            ''
        ).toLowerCase();

      if (
        role !== 'driver' &&
        role !== 'merchant'
      ) {
        alert(
          'Only drivers and merchants can withdraw wallet funds.'
        );
        return;
      }

      /*
        Important:
        The backend remains the final authority for withdrawal
        eligibility. The UI does not modify wallet balances.
      */
      const kycStatus =
        String(
          profile?.kyc_status ||
            ''
        ).toLowerCase();

      if (
        kycStatus !==
          'approved'
      ) {
        alert(
          'Cash withdrawal is available only after your account has been verified and approved by MatMove Admin.'
        );
        return;
      }

      setWalletAction(
        'withdraw'
      );
      setTopUpMethod(null);
      setAmount('');
      setSuccessMsg('');
      setIsWalletModalOpen(
        true
      );
    };

  const handleSendMoney =
    () => {
      alert(
        'Wallet-to-wallet payments are being connected to the secure MatMove payment system.'
      );
    };

  const handleLogout =
    async () => {
      if (loggingOut) {
        return;
      }

      setLoggingOut(true);

      try {
        const {
          error,
        } =
          await supabase.auth.signOut();

        if (error) {
          throw error;
        }

        setProfile(null);
        setWallet(null);
        setBookings([]);

        navigate(
          '/login',
          {
            replace: true,
          }
        );
      } catch (err: any) {
        console.error(
          'Logout failed:',
          err
        );

        alert(
          err?.message ||
            'Unable to sign out. Please try again.'
        );
      } finally {
        setLoggingOut(false);
      }
    };

  const handleNavigation =
    (
      section: PortalSection
    ) => {
      setSuccessMsg('');

      if (
        section === 'home'
      ) {
        setActiveSection(
          'home'
        );
        return;
      }

      if (
        section === 'wallet'
      ) {
        setActiveSection(
          'wallet'
        );
        return;
      }

      if (
        section === 'trips'
      ) {
        alert(
          profile?.role ===
            'merchant'
            ? 'Merchant Orders will be connected to the live order system in the next portal phase.'
            : 'Trips and order history will be connected to the live trip system in the next portal phase.'
        );
        return;
      }

      if (
        section === 'support'
      ) {
        alert(
          'MatMove Support will be connected to the live support system in the next portal phase.'
        );
        return;
      }

      if (
        section === 'account'
      ) {
        setActiveSection(
          'account'
        );
      }
    };

  const handleTransaction =
    async (
      e: FormEvent
    ) => {
      e.preventDefault();

      const role =
        String(
          profile?.role ||
            ''
        ).toLowerCase();

      const numAmount =
        parseFloat(
          amount
        );

      if (
        !Number.isFinite(
          numAmount
        ) ||
        numAmount <= 0
      ) {
        alert(
          'Please enter a valid amount.'
        );
        return;
      }

      const isRider =
        role === 'rider';

      const isReceiver =
        role === 'driver' ||
        role === 'merchant';

      if (
        walletAction ===
          'topup' &&
        !isRider
      ) {
        alert(
          'Only riders can fund their MatMove wallet.'
        );
        return;
      }

      if (
        walletAction ===
          'withdraw' &&
        !isReceiver
      ) {
        alert(
          'Only drivers and merchants can withdraw wallet funds.'
        );
        return;
      }

      if (
        walletAction ===
          'withdraw'
      ) {
        const kycStatus =
          String(
            profile?.kyc_status ||
              ''
          ).toLowerCase();

        if (
          kycStatus !==
          'approved'
        ) {
          alert(
            'Cash withdrawal requires MatMove Admin verification approval.'
          );
          return;
        }
      }

      if (
        walletAction ===
          'topup' &&
        !topUpMethod
      ) {
        alert(
          'Please select a funding method.'
        );
        return;
      }

      setProcessing(true);

      try {
        if (
          walletAction ===
          'withdraw'
        ) {
          setSuccessMsg(
            `Withdrawal request for SLE ${numAmount.toLocaleString()} is ready for secure provider processing.`
          );
        } else {
          const methodLabel =
            topUpMethod ===
            'mobile_money'
              ? 'Mobile Money'
              : topUpMethod ===
                  'card'
                ? 'Bank Card'
                : 'MatMove Vault / Float';

          setSuccessMsg(
            `${methodLabel} funding is ready for secure provider checkout. Your wallet will only be credited after authoritative payment confirmation.`
          );
        }

        setAmount('');

        setTimeout(() => {
          setIsWalletModalOpen(
            false
          );
          setTopUpMethod(null);
          setSuccessMsg('');
        }, 2500);
      } finally {
        setProcessing(false);
      }
    };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />

          <p className="text-slate-500 font-medium">
            Loading MatMove portal...
          </p>
        </div>
      </div>
    );
  }

  if (portalError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-sm">
          <div className="w-14 h-14 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle
              size={28}
            />
          </div>

          <h2 className="text-xl font-bold text-slate-900">
            Account setup incomplete
          </h2>

          <p className="text-sm text-slate-500 mt-2">
            {portalError}
          </p>

          <button
            onClick={() =>
              window.location.reload()
            }
            className="mt-6 bg-blue-600 text-white px-5 py-3 rounded-xl font-bold text-sm hover:bg-blue-700 transition flex items-center justify-center gap-2 mx-auto"
          >
            <RefreshCw
              size={16}
            />
            Refresh portal
          </button>
        </div>
      </div>
    );
  }

  const role =
    String(
      profile?.role ||
        ''
    ).toLowerCase();

  const isRider =
    role === 'rider';

  const isDriver =
    role === 'driver';

  const isMerchant =
    role === 'merchant';

  if (
    !isRider &&
    !isDriver &&
    !isMerchant
  ) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-sm">
          <div className="w-14 h-14 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle
              size={28}
            />
          </div>

          <h2 className="text-xl font-bold text-slate-900">
            Customer portal unavailable
          </h2>

          <p className="text-sm text-slate-500 mt-2">
            Your account does not have a valid rider, driver, or merchant role.
          </p>

          <button
            onClick={() =>
              navigate('/')
            }
            className="mt-6 bg-blue-600 text-white px-5 py-3 rounded-xl font-bold text-sm hover:bg-blue-700 transition"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  if (
    activeSection ===
    'account'
  ) {
    return (
      <div className="min-h-screen bg-slate-50 pb-28">
        <AccountSection
          profile={profile}
          role={
            role as CustomerRole
          }
          loggingOut={
            loggingOut
          }
          onLogout={
            handleLogout
          }
          onBack={() =>
            setActiveSection(
              'home'
            )
          }
        />

        <PortalNavigation
          activeSection={
            activeSection
          }
          onNavigate={
            handleNavigation
          }
          isRider={isRider}
          isDriver={isDriver}
          isMerchant={isMerchant}
        />
      </div>
    );
  }

  if (
    activeSection ===
    'wallet'
  ) {
    return (
      <div className="relative min-h-screen bg-slate-50">
        <WalletPage
          profile={profile}
          wallet={wallet}
          onClose={
            closeWalletPage
          }
          onTopUp={
            openRiderTopUp
          }
          onWithdraw={
            openWalletWithdrawal
          }
          onSendMoney={
            handleSendMoney
          }
        />

        <PortalNavigation
          activeSection={
            activeSection
          }
          onNavigate={
            handleNavigation
          }
          isRider={isRider}
          isDriver={isDriver}
          isMerchant={isMerchant}
        />

        {isWalletModalOpen && (
          <WalletTransactionModal
            walletAction={
              walletAction
            }
            topUpMethod={
              topUpMethod
            }
            setTopUpMethod={
              setTopUpMethod
            }
            amount={amount}
            setAmount={
              setAmount
            }
            processing={
              processing
            }
            successMsg={
              successMsg
            }
            setIsWalletModalOpen={
              setIsWalletModalOpen
            }
            handleTransaction={
              handleTransaction
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-slate-50 pb-24">
      {isRider && (
        <RiderDashboard
          profile={profile}
          wallet={wallet}
          onOpenBooking={() =>
            setIsBookingOpen(
              true
            )
          }
          onOpenTopUp={
            openWalletPage
          }
        />
      )}

      {isDriver && (
        <DriverDashboard
          profile={profile}
          wallet={wallet}
          bookings={bookings}
          onAcceptBooking={
            handleAcceptTrip
          }
          onCompleteBooking={
            handleCompleteTrip
          }
          onOpenWithdraw={
            openWalletPage
          }
        />
      )}

      {isMerchant && (
        <MerchantDashboard
          profile={profile}
          wallet={wallet}
          onOpenWithdraw={
            openWalletPage
          }
        />
      )}

      <PortalNavigation
        activeSection={
          activeSection
        }
        onNavigate={
          handleNavigation
        }
        isRider={isRider}
        isDriver={isDriver}
        isMerchant={isMerchant}
      />

      {isBookingOpen &&
        isRider && (
          <BookingModal
            serviceType={
              serviceType
            }
            setServiceType={
              setServiceType
            }
            pickup={pickup}
            setPickup={
              setPickup
            }
            destination={
              destination
            }
            setDestination={
              setDestination
            }
            calculatedFare={
              calculatedFare
            }
            processing={
              processing
            }
            successMsg={
              successMsg
            }
            setIsBookingOpen={
              setIsBookingOpen
            }
            handleCreateBooking={
              handleCreateBooking
            }
          />
        )}
    </div>
  );
}

function AccountSection({
  profile,
  role,
  loggingOut,
  onLogout,
  onBack,
}: {
  profile: any;
  role: CustomerRole;
  loggingOut: boolean;
  onLogout: () => Promise<void>;
  onBack: () => void;
}) {
  const firstName =
    profile?.first_name ||
    profile?.firstName ||
    '';

  const lastName =
    profile?.last_name ||
    profile?.lastName ||
    '';

  const fullName =
    `${firstName} ${lastName}`.trim() ||
    'MatMove User';

  const email =
    profile?.email ||
    'Not available';

  const phone =
    profile?.phone ||
    'Not available';

  const roleLabel =
    role.charAt(0).toUpperCase() +
    role.slice(1);

  const kycStatus =
    String(
      profile?.kyc_status ||
        'not_started'
    ).toLowerCase();

  const kycLabel =
    kycStatus ===
    'approved'
      ? 'Verified'
      : kycStatus ===
          'pending'
        ? 'Under Review'
        : kycStatus ===
            'rejected'
          ? 'Rejected'
          : 'Not Started';

  const kycClasses =
    kycStatus ===
    'approved'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
      : kycStatus ===
          'rejected'
        ? 'bg-red-50 text-red-700 border-red-100'
        : 'bg-amber-50 text-amber-700 border-amber-100';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 md:py-12">
        <div className="mb-8">
          <button
            onClick={
              onBack
            }
            className="text-sm font-semibold text-slate-500 hover:text-blue-600 transition mb-5"
          >
            ← Back to portal
          </button>

          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-2">
              MatMove Account
            </div>

            <h1 className="text-3xl md:text-4xl font-bold text-slate-900">
              Account & Profile
            </h1>

            <p className="text-slate-500 mt-2">
              Manage your MatMove account information and security.
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
          <div className="p-6 md:p-8 border-b border-slate-200">
            <div className="flex flex-col sm:flex-row sm:items-center gap-5">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <UserCircle
                  size={34}
                />
              </div>

              <div className="flex-1">
                <div className="text-2xl font-bold text-slate-900">
                  {fullName}
                </div>

                <div className="text-sm text-slate-500 mt-1">
                  MatMove {roleLabel}
                </div>
              </div>

              <div className="px-3 py-2 rounded-xl bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-wide self-start">
                {roleLabel}
              </div>
            </div>
          </div>

          <div className="p-6 md:p-8">
            <h2 className="text-lg font-bold text-slate-900 mb-5">
              Personal Information
            </h2>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="border border-slate-200 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">
                  <Mail
                    size={15}
                  />
                  Email
                </div>

                <div className="font-semibold text-slate-900 break-all">
                  {email}
                </div>
              </div>

              <div className="border border-slate-200 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">
                  <Phone
                    size={15}
                  />
                  Phone
                </div>

                <div className="font-semibold text-slate-900">
                  {phone}
                </div>
              </div>
            </div>

            <div className="mt-8">
              <h2 className="text-lg font-bold text-slate-900 mb-5">
                Verification Status
              </h2>

              <div className="border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
                  <ShieldCheck
                    size={22}
                  />
                </div>

                <div className="flex-1">
                  <div className="font-bold text-slate-900">
                    Identity & Account Verification
                  </div>

                  <div className="text-sm text-slate-500 mt-1">
                    Your account capabilities depend on MatMove verification status.
                  </div>
                </div>

                <div
                  className={`px-3 py-2 rounded-xl border text-xs font-bold ${kycClasses}`}
                >
                  {kycLabel}
                </div>
              </div>
            </div>

            <div className="mt-8 bg-slate-50 border border-slate-200 rounded-2xl p-5">
              <div className="flex items-start gap-3">
                <ShieldCheck
                  size={21}
                  className="text-emerald-600 mt-0.5 shrink-0"
                />

                <div>
                  <div className="font-bold text-slate-900">
                    Account security
                  </div>

                  <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                    MatMove keeps authentication and financial operations separated. Wallet balances are controlled by the secure backend and transaction ledger.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">
                Sign out
              </h2>

              <p className="text-sm text-slate-500 mt-1 mb-4">
                Sign out of this MatMove account on this device.
              </p>

              <button
                onClick={
                  onLogout
                }
                disabled={
                  loggingOut
                }
                className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-red-600 text-white font-bold text-sm hover:bg-red-700 transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <LogOut
                  size={18}
                />

                {loggingOut
                  ? 'Signing out...'
                  : 'Log out of MatMove'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WalletTransactionModal({
  walletAction,
  topUpMethod,
  setTopUpMethod,
  amount,
  setAmount,
  processing,
  successMsg,
  setIsWalletModalOpen,
  handleTransaction,
}: {
  walletAction: WalletAction;
  topUpMethod:
    | TopUpMethod
    | null;
  setTopUpMethod: (
    method:
      | TopUpMethod
      | null
  ) => void;
  amount: string;
  setAmount: (
    value: string
  ) => void;
  processing: boolean;
  successMsg: string;
  setIsWalletModalOpen: (
    value: boolean
  ) => void;
  handleTransaction: (
    e: FormEvent
  ) => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={() => {
            setIsWalletModalOpen(
              false
            );
            setTopUpMethod(null);
          }}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full"
          aria-label="Close wallet transaction"
        >
          <X size={20} />
        </button>

        <h2 className="text-2xl font-bold text-slate-900 mb-2 pr-8">
          {walletAction ===
          'topup'
            ? 'Top-Up Wallet'
            : 'Withdraw Earnings'}
        </h2>

        <p className="text-sm text-slate-500 mb-6">
          {walletAction ===
          'topup'
            ? 'Choose how you want to fund your MatMove wallet.'
            : 'Withdraw available earnings from your MatMove wallet.'}
        </p>

        {successMsg ? (
          <div className="bg-emerald-50 text-emerald-700 p-4 rounded-xl flex items-start gap-3 border border-emerald-100">
            <CheckCircle2
              size={24}
              className="mt-0.5 shrink-0"
            />

            <p className="font-medium text-sm">
              {successMsg}
            </p>
          </div>
        ) : (
          <form
            onSubmit={
              handleTransaction
            }
            className="space-y-5"
          >
            {walletAction ===
              'topup' && (
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-3">
                  Funding Method
                </label>

                <div className="space-y-3">
                  <FundingMethodButton
                    selected={
                      topUpMethod ===
                      'mobile_money'
                    }
                    onClick={() =>
                      setTopUpMethod(
                        'mobile_money'
                      )
                    }
                    title="Mobile Money"
                    description="Fund using a supported mobile-money provider."
                    icon={
                      <Smartphone
                        size={20}
                      />
                    }
                    iconClass="bg-blue-50 text-blue-600"
                    activeClass="border-blue-600 bg-blue-50"
                  />

                  <FundingMethodButton
                    selected={
                      topUpMethod ===
                      'card'
                    }
                    onClick={() =>
                      setTopUpMethod(
                        'card'
                      )
                    }
                    title="Bank Card"
                    description="Fund using an eligible debit or credit card."
                    icon={
                      <CreditCard
                        size={20}
                      />
                    }
                    iconClass="bg-emerald-50 text-emerald-600"
                    activeClass="border-emerald-600 bg-emerald-50"
                  />

                  <FundingMethodButton
                    selected={
                      topUpMethod ===
                      'vault_float'
                    }
                    onClick={() =>
                      setTopUpMethod(
                        'vault_float'
                      )
                    }
                    title="MatMove Vault / Float"
                    description="Use an approved MatMove internal funding balance."
                    icon={
                      <Landmark
                        size={20}
                      />
                    }
                    iconClass="bg-purple-50 text-purple-600"
                    activeClass="border-purple-600 bg-purple-50"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Amount (SLE)
              </label>

              <input
                type="number"
                required
                min="1"
                step="0.01"
                value={amount}
                onChange={(e) =>
                  setAmount(
                    e.target.value
                  )
                }
                className="w-full border border-slate-300 p-3 rounded-xl text-lg font-medium focus:ring-2 focus:ring-blue-600 outline-none"
                placeholder="e.g. 150"
              />
            </div>

            {walletAction ===
              'topup' &&
              topUpMethod && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Selected method
                  </div>

                  <div className="text-sm font-bold text-slate-900 mt-1">
                    {topUpMethod ===
                    'mobile_money'
                      ? 'Mobile Money'
                      : topUpMethod ===
                          'card'
                        ? 'Bank Card'
                        : 'MatMove Vault / Float'}
                  </div>
                </div>
              )}

            <button
              type="submit"
              disabled={
                processing ||
                (walletAction ===
                  'topup' &&
                  !topUpMethod)
              }
              className="w-full bg-blue-600 text-white p-3.5 rounded-xl font-bold hover:bg-blue-700 transition flex justify-center disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {processing
                ? 'Processing...'
                : walletAction ===
                    'topup'
                  ? 'Continue Top-Up'
                  : 'Request Cash-Out'}
            </button>

            <p className="text-[11px] text-slate-400 text-center leading-relaxed">
              Financial transactions are processed through secure MatMove backend/provider flows. The browser does not directly modify wallet balances.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function FundingMethodButton({
  selected,
  onClick,
  title,
  description,
  icon,
  iconClass,
  activeClass,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
  icon: ReactNode;
  iconClass: string;
  activeClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-4 rounded-2xl border-2 transition ${
        selected
          ? activeClass
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconClass}`}
        >
          {icon}
        </div>

        <div className="flex-1">
          <div className="font-bold text-slate-900">
            {title}
          </div>

          <div className="text-xs text-slate-500 mt-0.5">
            {description}
          </div>
        </div>

        <div
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
            selected
              ? 'border-blue-600'
              : 'border-slate-300'
          }`}
        >
          {selected && (
            <div className="w-2.5 h-2.5 bg-blue-600 rounded-full" />
          )}
        </div>
      </div>
    </button>
  );
}

function BookingModal({
  serviceType,
  setServiceType,
  pickup,
  setPickup,
  destination,
  setDestination,
  calculatedFare,
  processing,
  successMsg,
  setIsBookingOpen,
  handleCreateBooking,
}: {
  serviceType:
    | 'ride'
    | 'delivery'
    | 'truck'
    | 'bus';
  setServiceType: (
    value:
      | 'ride'
      | 'delivery'
      | 'truck'
      | 'bus'
  ) => void;
  pickup: string;
  setPickup: (
    value: string
  ) => void;
  destination: string;
  setDestination: (
    value: string
  ) => void;
  calculatedFare: number;
  processing: boolean;
  successMsg: string;
  setIsBookingOpen: (
    value: boolean
  ) => void;
  handleCreateBooking: (
    e: FormEvent
  ) => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl relative">
        <button
          onClick={() =>
            setIsBookingOpen(
              false
            )
          }
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full"
          aria-label="Close booking"
        >
          <X size={20} />
        </button>

        <h2 className="text-2xl font-bold text-slate-900 mb-1 capitalize">
          Book {serviceType}
        </h2>

        <p className="text-slate-500 text-sm mb-6">
          Enter your trip details to generate the system fare.
        </p>

        {successMsg ? (
          <div className="bg-emerald-50 text-emerald-700 p-4 rounded-xl flex items-start gap-3 border border-emerald-100">
            <CheckCircle2
              size={24}
              className="mt-0.5 shrink-0"
            />

            <p className="font-medium text-sm">
              {successMsg}
            </p>
          </div>
        ) : (
          <form
            onSubmit={
              handleCreateBooking
            }
            className="space-y-4"
          >
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase">
                Service
              </label>

              <select
                value={serviceType}
                onChange={(e) =>
                  setServiceType(
                    e.target
                      .value as
                      | 'ride'
                      | 'delivery'
                      | 'truck'
                      | 'bus'
                  )
                }
                className="w-full border border-slate-300 p-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-600 bg-white"
              >
                <option value="ride">
                  Ride
                </option>

                <option value="delivery">
                  Delivery
                </option>

                <option value="truck">
                  Truck
                </option>

                <option value="bus">
                  Bus
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase">
                Pickup Location
              </label>

              <input
                type="text"
                required
                value={pickup}
                onChange={(e) =>
                  setPickup(
                    e.target.value
                  )
                }
                className="w-full border border-slate-300 p-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="e.g. Lumley Junction, Freetown"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase">
                Destination Location
              </label>

              <input
                type="text"
                required
                value={
                  destination
                }
                onChange={(e) =>
                  setDestination(
                    e.target.value
                  )
                }
                className="w-full border border-slate-300 p-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="e.g. Cotton Tree, Central Freetown"
              />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex justify-between items-center">
              <div>
                <span className="text-xs font-bold text-blue-700 uppercase flex items-center gap-1">
                  <Calculator
                    size={14}
                  />
                  Estimated System Fare
                </span>

                <span className="text-2xl font-bold text-blue-900 mt-1 block">
                  SLE{' '}
                  {calculatedFare.toLocaleString()}
                </span>
              </div>

              <span className="text-xs font-semibold text-blue-600 bg-blue-100 px-2.5 py-1 rounded-md">
                Read-Only
              </span>
            </div>

            <button
              type="submit"
              disabled={processing}
              className="w-full bg-blue-600 text-white p-3.5 rounded-xl font-bold mt-4 hover:bg-blue-700 transition flex justify-center disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {processing
                ? 'Processing...'
                : 'Confirm Request'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function PortalNavigation({
  activeSection,
  onNavigate,
  isRider,
  isDriver,
  isMerchant,
}: {
  activeSection: PortalSection;
  onNavigate: (
    section: PortalSection
  ) => void;
  isRider: boolean;
  isDriver: boolean;
  isMerchant: boolean;
}) {
  const roleLabel = isRider
    ? 'Rider'
    : isDriver
      ? 'Driver'
      : isMerchant
        ? 'Merchant'
        : 'MatMove';

  const navigationItems: {
    id: PortalSection;
    label: string;
    icon: typeof Home;
  }[] = [
    {
      id: 'home',
      label: 'Home',
      icon: Home,
    },
    {
      id: 'wallet',
      label: 'Wallet',
      icon: Wallet,
    },
    {
      id: 'trips',
      label: isMerchant
        ? 'Orders'
        : 'Trips',
      icon: Navigation,
    },
    {
      id: 'support',
      label: 'Support',
      icon: Headphones,
    },
    {
      id: 'account',
      label: 'Account',
      icon: UserCircle,
    },
  ];

  return (
    <>
      <aside className="hidden md:flex fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-white/95 backdrop-blur-md border border-slate-200 shadow-xl rounded-2xl px-2 py-2">
        <div className="flex items-center gap-1">
          <div className="px-3 py-2 border-r border-slate-200 mr-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
              MatMove
            </div>

            <div className="text-xs font-bold text-slate-700">
              {roleLabel}
            </div>
          </div>

          {navigationItems.map(
            (item) => {
              const Icon =
                item.icon;

              const active =
                activeSection ===
                item.id;

              return (
                <button
                  key={item.id}
                  onClick={() =>
                    onNavigate(
                      item.id
                    )
                  }
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
                    active
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon
                    size={17}
                  />

                  <span>
                    {item.label}
                  </span>
                </button>
              );
            }
          )}
        </div>
      </aside>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-2xl px-2 py-2">
        <div className="grid grid-cols-5 gap-1 max-w-lg mx-auto">
          {navigationItems.map(
            (item) => {
              const Icon =
                item.icon;

              const active =
                activeSection ===
                item.id;

              return (
                <button
                  key={item.id}
                  onClick={() =>
                    onNavigate(
                      item.id
                    )
                  }
                  className={`flex flex-col items-center justify-center gap-1 py-2 rounded-xl transition ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  <Icon
                    size={18}
                  />

                  <span className="text-[10px] font-bold">
                    {item.label}
                  </span>
                </button>
              );
            }
          )}
        </div>
      </nav>
    </>
  );
}