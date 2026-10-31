
import TripHistory from '@/components/TripHistory';
import { MerchantDashboard } from './MerchantDashboard';
import { MerchantCatalog } from './MerchantCatalog';

export function MerchantPortal(props: any) {
  if (props.activeSection === 'inventory') return <MerchantCatalog profile={props.profile} />;
  if (props.activeSection === 'trips') return <TripHistory userId={props.profile.id} role="merchant" />;
  return <MerchantDashboard {...props} />;
}
