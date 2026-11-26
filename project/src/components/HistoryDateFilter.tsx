import { useState } from 'react';
import { CalendarDays, RotateCcw } from 'lucide-react';

type Props = {
  fromDate: string;
  toDate: string;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  filteredCount: number;
  totalCount: number;
  noun?: string;
};

function dateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function HistoryDateFilter({
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  filteredCount,
  totalCount,
  noun = 'records',
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const invalidRange = Boolean(fromDate && toDate && fromDate > toDate);
  const active = Boolean(fromDate || toDate);

  function applyPreset(days: number | null) {
    if (days === null) {
      onFromDateChange('');
      onToDateChange('');
      return;
    }
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    onFromDateChange(dateInputValue(start));
    onToDateChange(dateInputValue(end));
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3" aria-label={`${noun} date filter`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
        >
          <CalendarDays size={17} className="text-emerald-700" />
          Filter by date
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
            {active ? 'Custom range' : 'All dates'}
          </span>
        </button>
        {active && (
          <button type="button" onClick={() => applyPreset(null)} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            <RotateCcw size={14} /> Clear
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-600">
              From date
              <input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={event => onFromDateChange(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              To date
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={event => onToDateChange(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {[{label:'Last 7 days',days:7},{label:'Last 30 days',days:30},{label:'Last 90 days',days:90}].map(item => (
              <button key={item.days} type="button" onClick={() => applyPreset(item.days)} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:bg-emerald-50">
                {item.label}
              </button>
            ))}
            <button type="button" onClick={() => applyPreset(null)} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">All dates</button>
          </div>
          {invalidRange && <p role="alert" className="text-xs font-medium text-red-700">The start date must be on or before the end date.</p>}
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500" aria-live="polite">
        Showing {invalidRange ? 0 : filteredCount} of {totalCount} {noun}
      </p>
    </section>
  );
}
