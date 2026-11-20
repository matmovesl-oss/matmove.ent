import { ChevronDown } from 'lucide-react';

export default function MapScrollCue() {
  const scrollToDetails = () => {
    const distance = Math.max(260, Math.round(window.innerHeight * 0.75));
    window.scrollBy({ top: distance, behavior: 'smooth' });
  };

  return (
    <button
      type="button"
      aria-label="Scroll down to see more details below the map"
      onClick={scrollToDetails}
      className="absolute bottom-3 left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border-2 border-slate-900 bg-white/95 px-4 py-2 text-xs font-extrabold text-slate-950 shadow-lg backdrop-blur transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
    >
      <span>More below</span>
      <ChevronDown size={17} aria-hidden="true" className="animate-bounce" />
    </button>
  );
}
