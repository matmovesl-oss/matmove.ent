export type BookingStatus = 'In progress' | 'Confirmed' | 'Completed' | 'Cancelled';
export type PaymentStatus = 'Paid' | 'Pending' | 'Refunded';

export interface Customer {
  name: string;
  firstName: string;
  phone: string;
  email: string;
  initials: string;
}

export interface Booking {
  id: string;
  service: string;
  icon: string;
  pickup: string;
  destination: string;
  date: string;
  time: string;
  fare: number;
  status: BookingStatus;
  payment: PaymentStatus;
  driver?: string;
  vehicle?: string;
  plate?: string;
}

export interface Transaction {
  id: string;
  type: string;
  description: string;
  date: string;
  amount: number;
  direction: 'in' | 'out';
  status: 'Completed' | 'Pending' | 'Failed';
}

export interface Schedule {
  id: string;
  route: string;
  days: string;
  time: string;
  cadence: string;
  passengers: number;
  status: 'Active' | 'Paused' | 'Completed';
}

export const customer: Customer = {
  name: 'Aisha Kamara', firstName: 'Aisha', phone: '+232 76 442 108', email: 'aisha.kamara@email.com', initials: 'AK'
};

export const bookings: Booking[] = [
  { id: 'MM-1050', service: 'Ride', icon: 'car', pickup: 'Lumley Beach Road', destination: 'Bai Bureh Road, Waterloo', date: 'Today', time: '09:40 AM', fare: 18500, status: 'In progress', payment: 'Paid', driver: 'Mohamed Koroma', vehicle: 'Toyota Prius', plate: 'ABK 482' },
  { id: 'MM-1047', service: 'Delivery', icon: 'package', pickup: 'Congo Cross', destination: 'Wilberforce', date: '28 Aug 2026', time: '02:15 PM', fare: 75000, status: 'Completed', payment: 'Paid', driver: 'Sorie Conteh', vehicle: 'Toyota Hiace', plate: 'AIA 209' },
  { id: 'MM-1038', service: 'Ride', icon: 'car', pickup: 'Hill Station', destination: 'Freetown Central', date: '25 Aug 2026', time: '07:30 AM', fare: 22000, status: 'Completed', payment: 'Paid', driver: 'Fatmata Sesay', vehicle: 'Kia Picanto', plate: 'AFB 771' },
  { id: 'MM-1029', service: 'Truck', icon: 'truck', pickup: 'Hastings', destination: 'Jui Junction', date: '22 Aug 2026', time: '11:00 AM', fare: 180000, status: 'Cancelled', payment: 'Refunded' },
];

export const transactions: Transaction[] = [
  { id: 'TX-88421', type: 'Ride Payment', description: 'MM-1050 · Lumley to Waterloo', date: 'Today, 9:42 AM', amount: 18500, direction: 'out', status: 'Completed' },
  { id: 'TX-88394', type: 'Top Up', description: 'Orange Money wallet top up', date: '28 Aug 2026', amount: 100000, direction: 'in', status: 'Completed' },
  { id: 'TX-88376', type: 'Delivery Payment', description: 'MM-1047 · Congo Cross to Wilberforce', date: '28 Aug 2026', amount: 75000, direction: 'out', status: 'Completed' },
  { id: 'TX-88104', type: 'Promotion Credit', description: 'Welcome to MatMove', date: '18 Aug 2026', amount: 25000, direction: 'in', status: 'Completed' },
  { id: 'TX-87982', type: 'Ride Payment', description: 'MM-1038 · Hill Station to Central', date: '25 Aug 2026', amount: 22000, direction: 'out', status: 'Completed' },
];

export const schedules: Schedule[] = [
  { id: 'MAT-PLAN-001', route: 'Waterloo → Freetown', days: 'Monday – Friday', time: '7:00 AM', cadence: 'Monthly', passengers: 4, status: 'Active' },
  { id: 'MAT-PLAN-004', route: 'Lumley → Central Business District', days: 'Monday, Wednesday, Friday', time: '8:30 AM', cadence: 'Weekly', passengers: 2, status: 'Active' },
  { id: 'MAT-PLAN-006', route: 'Kissy → Hill Station', days: 'Every Saturday', time: '10:00 AM', cadence: 'Weekly', passengers: 5, status: 'Paused' },
];

export const promotions = [
  { title: '10% off your first ride', code: 'WELCOME10', detail: 'Save up to SLE 15,000 on your next ride.', color: 'blue', expires: 'Expires 30 Sep 2026' },
  { title: 'Refer a friend, earn SLE 20,000', code: 'REFER20', detail: 'Share MatMove with a friend and both of you get rewarded.', color: 'orange', expires: 'Ongoing offer' },
  { title: 'Move more, save more', code: 'MONTHLY25', detail: 'Enjoy SLE 25,000 credit when you complete 10 trips this month.', color: 'green', expires: 'Ends 30 Sep 2026' },
];

export const notifications = [
  { title: 'Driver assigned', text: 'Mohamed is on the way to your pickup.', time: '8 min ago', type: 'ride', read: false },
  { title: 'Payment successful', text: 'Your wallet was charged SLE 18,500.', time: '12 min ago', type: 'payment', read: false },
  { title: 'Scheduled trip reminder', text: 'Your Waterloo trip is tomorrow at 7:00 AM.', time: 'Yesterday', type: 'calendar', read: true },
  { title: 'New promotion for you', text: 'Save 10% on your first ride with WELCOME10.', time: '2 days ago', type: 'gift', read: true },
];

export const savedLocations = [
  { label: 'Home', address: 'Lumley Beach Road, Freetown', icon: 'home' },
  { label: 'Work', address: 'Freetown Central Business District', icon: 'briefcase' },
  { label: 'School', address: 'Fourah Bay College, Mount Aureol', icon: 'graduation' },
];
