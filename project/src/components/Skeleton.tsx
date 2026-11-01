import type { ReactNode } from 'react';

type BlockProps = { className?: string; rounded?: string };
export function SkeletonBlock({ className = '', rounded = 'rounded-xl' }: BlockProps) {
  return <div aria-hidden="true" className={`animate-pulse bg-slate-200/90 ${rounded} ${className}`} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return <div role="status" aria-label="Loading content" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <SkeletonBlock className="mb-4 h-5 w-2/5" />
    <SkeletonBlock className="mb-3 h-8 w-1/3" />
    {Array.from({ length: lines }, (_, index) => <SkeletonBlock key={index} className={`mb-2 h-3 ${index === lines - 1 ? 'w-3/5' : 'w-full'}`} rounded="rounded-md" />)}
  </div>;
}

export function SkeletonGrid({ count = 3, columns = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' }: { count?: number; columns?: string }) {
  return <div role="status" aria-label="Loading content" className={`grid ${columns} gap-4`}>
    {Array.from({ length: count }, (_, index) => <div key={index} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <SkeletonBlock className="h-40 w-full" rounded="rounded-none" />
      <div className="space-y-3 p-4"><SkeletonBlock className="h-4 w-3/4" rounded="rounded-md" /><SkeletonBlock className="h-3 w-full" rounded="rounded-md" /><SkeletonBlock className="h-3 w-2/3" rounded="rounded-md" /><SkeletonBlock className="h-9 w-2/5" /></div>
    </div>)}
  </div>;
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return <div role="status" aria-label="Loading content" className="space-y-3">
    {Array.from({ length: count }, (_, index) => <div key={index} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4">
      <SkeletonBlock className="h-12 w-12 shrink-0" rounded="rounded-full" />
      <div className="min-w-0 flex-1 space-y-2"><SkeletonBlock className="h-4 w-2/5" rounded="rounded-md" /><SkeletonBlock className="h-3 w-4/5" rounded="rounded-md" /></div>
      <SkeletonBlock className="h-7 w-16" />
    </div>)}
  </div>;
}

export function PortalPageSkeleton(): ReactNode {
  return <main role="status" aria-label="Loading MatMove" className="min-h-screen bg-slate-50 p-4 sm:p-6">
    <div className="mx-auto max-w-6xl animate-pulse space-y-6">
      <div className="flex items-center justify-between"><SkeletonBlock className="h-12 w-44" /><SkeletonBlock className="h-10 w-10" rounded="rounded-full" /></div>
      <div className="space-y-2"><SkeletonBlock className="h-3 w-28" /><SkeletonBlock className="h-8 w-64" /><SkeletonBlock className="h-4 w-52" /></div>
      <div className="grid gap-4 lg:grid-cols-2"><SkeletonCard lines={2} /><SkeletonCard lines={2} /></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
    </div>
  </main>;
}
