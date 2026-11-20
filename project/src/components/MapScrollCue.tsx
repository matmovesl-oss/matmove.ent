import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Shows a small map-page scroll cue only when more page content is available.
 * It disappears automatically after the user reaches the bottom of the page.
 */
export default function MapScrollCue() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const root = document.documentElement;
        const body = document.body;
        const pageHeight = Math.max(root.scrollHeight, body?.scrollHeight || 0);
        const viewportHeight = window.innerHeight || root.clientHeight;
        const scrollTop = window.scrollY || root.scrollTop || body?.scrollTop || 0;
        const hasMoreContent = pageHeight - viewportHeight > 120;
        const reachedBottom = scrollTop + viewportHeight >= pageHeight - 48;
        setVisible(hasMoreContent && !reachedBottom);
      });
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(update)
      : null;
    resizeObserver?.observe(document.documentElement);
    if (document.body) resizeObserver?.observe(document.body);

    const mutationObserver = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(update)
      : null;
    if (document.body) mutationObserver?.observe(document.body, { childList: true, subtree: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      aria-label="Scroll down to see more details below the map"
      title="Scroll down to see more"
      onClick={() => window.scrollBy({ top: Math.max(320, window.innerHeight * 0.72), behavior: 'smooth' })}
      className="fixed bottom-[calc(88px+env(safe-area-inset-bottom))] left-1/2 z-[45] inline-flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border border-slate-300 bg-white/95 text-slate-950 shadow-lg backdrop-blur transition hover:border-slate-500 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
    >
      <ChevronDown size={22} strokeWidth={2.5} aria-hidden="true" className="animate-bounce" />
    </button>
  );
}
