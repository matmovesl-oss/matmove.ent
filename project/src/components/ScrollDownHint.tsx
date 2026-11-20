import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * A small scroll cue for the map-first dashboards. It stays visible while
 * more page content remains and disappears once the customer reaches the end.
 */
export default function ScrollDownHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const root = document.documentElement;
        const body = document.body;
        const height = Math.max(root.scrollHeight, body?.scrollHeight || 0);
        const viewport = window.innerHeight;
        const position = window.scrollY || root.scrollTop || body?.scrollTop || 0;
        const canScroll = height - viewport > 120;
        const reachedBottom = position + viewport >= height - 48;
        setVisible(canScroll && !reachedBottom);
      });
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(update)
      : null;
    if (resizeObserver) {
      resizeObserver.observe(document.documentElement);
      resizeObserver.observe(document.body);
    }

    const mutationObserver = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(update)
      : null;
    if (mutationObserver) {
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }

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
      aria-label="Scroll down to see more"
      title="Scroll down to see more"
      onClick={() => window.scrollBy({ top: Math.max(320, window.innerHeight * 0.72), behavior: 'smooth' })}
      className="fixed bottom-[calc(88px+env(safe-area-inset-bottom))] left-1/2 z-[45] inline-flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border border-slate-300 bg-white/95 text-slate-900 shadow-lg backdrop-blur transition hover:border-slate-500 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
    >
      <ChevronDown size={22} strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}
