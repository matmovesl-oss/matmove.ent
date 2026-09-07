import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Wallet, Car, Package, Truck, Bus, Bell, ChevronDown, ShieldCheck, MapPin, Navigation } from 'lucide-react';

export function RiderDashboard({ profile, wallet, onOpenBooking, onOpenTopUp }: any) {
  return (
    <div className="flex-1 bg-slate-50 min-h-screen">
      {/* Rider Top Navigation */}
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="w-1/2">
          <input type="text" placeholder="Search rides, destinations, receipts..." className="w-full bg-slate-100 border-none rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-600 outline-none"/>
        </div>
        <div className="flex items-center gap-6">
          <button className="relative text-slate-400 hover:text-slate-600"><Bell size={20} /></button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full uppercase">Rider</span>
            <span className="text-sm font-bold text-slate-800">{profile?.full_name}</span>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-6xl mx-auto space-y-8">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Good morning, {profile?.full_name?.split(' ')[0]} ✨</h1>
            <p className="text-slate-500 mt-1">Where are you moving today?</p>
          </div>
          <button onClick={onOpenBooking} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold shadow-md hover:bg-blue-700 transition flex items-center gap-2">
            <Car size={18} /> Book a Ride
          </button>
        </div>

        {/* Rider Wallet Card (NO WITHDRAW BUTTON) */}
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 bg-blue-700 rounded-2xl p-6 text-white relative overflow-hidden shadow-lg">
            <span className="text-blue-200 text-xs font-bold uppercase tracking-wider">Rider SLE Balance</span>
            <div className="text-4xl font-bold mt-1">SLE {Number(wallet?.balance || 0).toLocaleString()}</div>
            <button onClick={onOpenTopUp} className="mt-6 bg-white/20 hover:bg-white/30 transition px-5 py-2.5 rounded-xl text-sm font-bold backdrop-blur-sm">
              + Add Money
            </button>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
            <ShieldCheck size={28} className="text-emerald-600 mb-2" />
            <h3 className="font-bold text-slate-900 text-base">Protected Trips</h3>
            <p className="text-slate-500 text-xs mt-1">Verified drivers with GPS journey tracking.</p>
          </div>
        </div>

        {/* Services Grid */}
        <div>
          <h2 className="text-lg font-bold text-slate-900 mb-4">Services Available</h2>
          <div className="grid grid-cols-4 gap-4">
            {[
              { name: 'Ride', type: 'ride', desc: 'Passenger travel', icon: Car, bg: 'bg-blue-50', color: 'text-blue-600' },
              { name: 'Delivery', type: 'delivery', desc: 'Courier packages', icon: Package, bg: 'bg-orange-50', color: 'text-orange-600' },
              { name: 'Truck', type: 'truck', desc: 'Cargo transport', icon: Truck, bg: 'bg-emerald-50', color: 'text-emerald-600' },
              { name: 'Bus', type: 'bus', desc: 'Intercity travel', icon: Bus, bg: 'bg-indigo-50', color: 'text-indigo-600' }
            ].map((s, i) => (
              <div key={i} onClick={onOpenBooking} className="bg-white p-5 rounded-2xl border border-slate-200 hover:border-blue-300 transition cursor-pointer shadow-sm">
                <div className={`w-10 h-10 ${s.bg} ${s.color} rounded-lg flex items-center justify-center mb-3`}><s.icon size={20} /></div>
                <h3 className="font-bold text-slate-900">{s.name}</h3>
                <p className="text-xs text-slate-500 mt-1">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}