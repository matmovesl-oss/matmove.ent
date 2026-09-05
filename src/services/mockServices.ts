import { bookings, customer, schedules, transactions } from '@/data/mockData';

export const getCustomer = async () => customer;
export const getBookings = async () => bookings;
export const getWallet = async () => ({ balance: 185000, currency: 'SLE' });
export const getTransactions = async () => transactions;
export const getScheduledServices = async () => schedules;
export const getNotifications = async () => [];
export const createBooking = async (booking: unknown) => ({ reference: 'MM-1051', status: 'Confirmed', booking });
export const createScheduledService = async (schedule: unknown) => ({ reference: 'MAT-PLAN-007', status: 'Active', schedule });
export const topUpWallet = async (amount: number) => ({ status: 'Completed', amount });
export const withdrawWallet = async (amount: number) => ({ status: 'Pending', amount });
