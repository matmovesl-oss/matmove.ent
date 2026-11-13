import { useRef, useState } from 'react';
import { ArrowUpRight, Car, MapPin, Navigation, Package, Utensils, Pause, Play, Share2, Check } from 'lucide-react';

type RouteKey = 'ride' | 'food' | 'package';
type Props = {
  role: string;
  onNavigate: (section: 'ride' | 'account' | 'services' | 'trips' | 'shop' | 'inventory') => void;
};

const routes: Record<RouteKey, {
  label: string;
  start: string;
  end: string;
  path: string;
  startPoint: [number, number];
  endPoint: [number, number];
  Icon: typeof Car;
  action: string;
}> = {
  ride: {
    label: 'Ride',
    start: 'Congo Cross',
    end: 'Lumley',
    path: 'M 92 214 C 168 190, 175 102, 278 126 S 420 207, 510 128 S 610 76, 666 64',
    startPoint: [92, 214],
    endPoint: [666, 64],
    Icon: Car,
    action: 'A ride across Freetown',
  },
  food: {
    label: 'Food',
    start: 'Wilberforce',
    end: 'Aberdeen',
    path: 'M 102 68 C 196 80, 198 202, 316 186 S 458 78, 558 108 S 614 180, 666 214',
    startPoint: [102, 68],
    endPoint: [666, 214],
    Icon: Utensils,
    action: 'A food order on the move',
  },
  package: {
    label: 'Package',
    start: 'Central Freetown',
    end: 'Jui',
    path: 'M 78 150 C 166 110, 236 44, 332 92 S 420 190, 516 172 S 612 128, 674 84',
    startPoint: [78, 150],
    endPoint: [674, 84],
    Icon: Package,
    action: 'A parcel moving across town',
  },
};

export default function CustomerHomeMap({ role, onNavigate }: Props) {
  const [activeRoute, setActiveRoute] = useState<RouteKey>('ride');
  const [isPlaying, setIsPlaying] = useState(true);
  const [shareNotice, setShareNotice] = useState('');
  const mapRef = useRef<SVGSVGElement | null>(null);
  const route = routes[activeRoute];
  const Icon = route.Icon;
  const driver = role === 'driver';
  const merchant = role === 'merchant';
  const openMap = () => onNavigate(driver || !merchant ? 'ride' : 'services');
  const toggleMotion = () => {
    const svg = mapRef.current;
    if (!svg) return;
    if (isPlaying) svg.pauseAnimations(); else svg.unpauseAnimations();
    setIsPlaying(!isPlaying);
  };
  const shareRoute = async () => {
    const message = `MatMove route preview: ${route.start} to ${route.end}, Freetown. Open MatMove to plan your journey.`;
    try {
      if (navigator.share) await navigator.share({ title: 'MatMove route', text: message });
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(message); setShareNotice('Route details copied.'); }
      else setShareNotice('Sharing is not available on this device.');
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') setShareNotice('Could not share this route.');
    }
  };

  return (
    <section aria-labelledby="customer-home-map-title" className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-3 pt-5 sm:px-6">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[.18em] text-emerald-700">MatMove · Freetown</p>
          <h2 id="customer-home-map-title" className="mt-1 text-xl font-black tracking-tight text-slate-950 sm:text-2xl">See your city in motion.</h2>
          <p className="mt-1 text-sm text-slate-500">Choose a route preview, then open the map to get moving.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
          Animated map preview
        </span>
      </div>

      <div className="relative mx-3 overflow-hidden rounded-[1.5rem] border border-emerald-100 bg-[#e7f0e9] sm:mx-5">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(255,255,255,.9),transparent_28%),radial-gradient(circle_at_80%_80%,rgba(255,255,255,.55),transparent_32%)]" />
        <svg ref={mapRef} viewBox="0 0 740 280" role="img" aria-label={`Illustrative animated Freetown route from ${route.start} to ${route.end}`} className="relative block h-[190px] w-full sm:h-[260px]">
          <defs>
            <pattern id="mm-home-map-grid" width="42" height="42" patternUnits="userSpaceOnUse">
              <path d="M 42 0 L 0 0 0 42" fill="none" stroke="#b8cdbd" strokeWidth="1" opacity=".55" />
            </pattern>
            <linearGradient id="mm-home-route-gradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#0f9f6e" />
              <stop offset="100%" stopColor="#087f5b" />
            </linearGradient>
            <filter id="mm-home-car-shadow" x="-60%" y="-60%" width="220%" height="220%">
              <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#0b2236" floodOpacity=".25" />
            </filter>
          </defs>
          <rect width="740" height="280" fill="url(#mm-home-map-grid)" />
          <path d="M-20 36 C100 76 124 22 220 52 S360 94 426 56 S602 16 760 46" fill="none" stroke="#fff" strokeWidth="22" strokeLinecap="round" />
          <path d="M-20 36 C100 76 124 22 220 52 S360 94 426 56 S602 16 760 46" fill="none" stroke="#c4d5c9" strokeWidth="2" strokeLinecap="round" />
          <path d="M-20 250 C105 194 142 242 250 220 S406 186 506 228 S642 254 760 208" fill="none" stroke="#fff" strokeWidth="26" strokeLinecap="round" />
          <path d="M-20 250 C105 194 142 242 250 220 S406 186 506 228 S642 254 760 208" fill="none" stroke="#c4d5c9" strokeWidth="2" strokeLinecap="round" />
          <path d="M120 -20 C155 66 112 102 156 170 S224 236 230 300" fill="none" stroke="#fff" strokeWidth="18" strokeLinecap="round" />
          <path d="M120 -20 C155 66 112 102 156 170 S224 236 230 300" fill="none" stroke="#c4d5c9" strokeWidth="2" strokeLinecap="round" />
          <path d="M570 -20 C522 52 566 106 534 158 S552 228 600 300" fill="none" stroke="#fff" strokeWidth="20" strokeLinecap="round" />
          <path d="M570 -20 C522 52 566 106 534 158 S552 228 600 300" fill="none" stroke="#c4d5c9" strokeWidth="2" strokeLinecap="round" />
          <path d="M-20 136 C90 106 204 144 300 116 S492 96 760 140" fill="none" stroke="#fff" strokeWidth="13" strokeLinecap="round" />
          <path d="M-20 136 C90 106 204 144 300 116 S492 96 760 140" fill="none" stroke="#c4d5c9" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M300 -20 C286 48 342 86 326 142 S290 246 340 300" fill="none" stroke="#fff" strokeWidth="15" strokeLinecap="round" />
          <path d="M300 -20 C286 48 342 86 326 142 S290 246 340 300" fill="none" stroke="#c4d5c9" strokeWidth="1.5" strokeLinecap="round" />
          <path d={route.path} fill="none" stroke="#ffffff" strokeWidth="14" strokeLinecap="round" opacity=".9" />
          <path id="mm-home-active-route" d={route.path} fill="none" stroke="url(#mm-home-route-gradient)" strokeWidth="5" strokeLinecap="round" strokeDasharray="10 8" />
          <circle cx={route.startPoint[0]} cy={route.startPoint[1]} r="12" fill="#fff" stroke="#087f5b" strokeWidth="4" />
          <circle cx={route.startPoint[0]} cy={route.startPoint[1]} r="3.5" fill="#087f5b" />
          <circle cx={route.endPoint[0]} cy={route.endPoint[1]} r="12" fill="#fff" stroke="#0b2236" strokeWidth="4" />
          <circle cx={route.endPoint[0]} cy={route.endPoint[1]} r="3.5" fill="#0b2236" />
          <g filter="url(#mm-home-car-shadow)">
            <g>
              <animateMotion dur="10s" repeatCount="indefinite" rotate="auto">
                <mpath href="#mm-home-active-route" />
              </animateMotion>
              <rect x="-18" y="-11" width="36" height="22" rx="7" fill="#0b2236" stroke="#fff" strokeWidth="2" />
              <rect x="-9" y="-8" width="18" height="7" rx="2.5" fill="#9fe8ce" />
              <circle cx="-10" cy="10" r="3.2" fill="#102a40" stroke="#fff" strokeWidth="1.3" />
              <circle cx="10" cy="10" r="3.2" fill="#102a40" stroke="#fff" strokeWidth="1.3" />
            </g>
          </g>
          <g fill="#456b58" fontFamily="ui-sans-serif, system-ui" fontSize="11" fontWeight="700">
            <text x="28" y="28">FREETOWN</text>
            <text x="340" y="260" opacity=".7">SIERRA LEONE</text>
          </g>
        </svg>
        <div className="absolute left-3 top-3 rounded-xl border border-white/80 bg-white/90 px-3 py-2 text-xs font-bold text-slate-700 shadow-sm sm:left-4 sm:top-4">
          <MapPin size={13} className="mr-1 inline text-emerald-700" /> {route.start}
        </div>
        <div className="absolute bottom-3 right-3 rounded-xl border border-white/80 bg-white/90 px-3 py-2 text-xs font-bold text-slate-700 shadow-sm sm:bottom-4 sm:right-4">
          <Navigation size={13} className="mr-1 inline text-emerald-700" /> {route.end}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-5 pt-4 sm:px-6">
        <div className="flex flex-wrap gap-2" aria-label="Choose map preview">
          {(['ride','food','package'] as RouteKey[]).map(key => {
            const item = routes[key];
            const RouteIcon = item.Icon;
            return <button key={key} type="button" aria-pressed={activeRoute === key} onClick={() => setActiveRoute(key)} className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm font-bold transition ${activeRoute === key ? 'border-emerald-700 bg-emerald-700 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300'}`}><RouteIcon size={15}/>{item.label}</button>;
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-slate-500 sm:inline">{route.action}</span>
          <button type="button" onClick={toggleMotion} aria-pressed={isPlaying} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2">{isPlaying ? <Pause size={15}/> : <Play size={15}/>} {isPlaying ? 'Pause car' : 'Move car'}</button>
          <button type="button" onClick={() => void shareRoute()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"><Share2 size={15}/> Share route</button>
          <button type="button" onClick={openMap} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#0b2236] px-4 text-sm font-bold text-white transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2">
            {driver ? 'Open driver radar' : merchant ? 'Open services' : 'Open ride map'} <ArrowUpRight size={16}/>
          </button>
        </div>
        {shareNotice && <p role="status" className="w-full text-xs font-semibold text-emerald-700">{shareNotice}</p>}
        <p className="w-full text-[11px] text-slate-400">Illustrative route preview · open the map to choose real pickup and destination points.</p>
      </div>
    </section>
  );
}
