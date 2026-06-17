import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad(n) {
  return String(n).padStart(2, '0');
}

function parseValue(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDisplay(value) {
  const d = parseValue(value);
  if (!d) return 'Select date & time';
  const weekday = d.toLocaleString('en-GB', { weekday: 'short' });
  const date = d.toLocaleString('en-GB', { day: 'numeric', month: 'short' });
  const time = d.toLocaleString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
  const yearSuffix = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${weekday}, ${date}${yearSuffix} · ${time}`;
}

function getCalendarDays(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);
  return cells;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function TimeColumn({ label, options, value, onChange }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="text-[10px] font-bold text-brand-grey uppercase tracking-wider text-center mb-1.5">
        {label}
      </div>
      <ul className="max-h-40 overflow-y-auto overscroll-contain rounded-lg border border-brand-border bg-brand-surface/40 py-1">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => onChange(opt.value)}
                className={`w-full py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-brand-orange text-white font-bold'
                    : 'text-brand-dark hover:bg-brand-warm hover:text-brand-orange'
                }`}
              >
                {opt.label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function DateTimePicker({ value, onChange, minDate }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const selected = parseValue(value) || new Date();
  const min = minDate || new Date();

  const [viewYear, setViewYear] = useState(selected.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected.getMonth());
  const [draftDay, setDraftDay] = useState(selected.getDate());
  const [hour12, setHour12] = useState(() => {
    const h = selected.getHours() % 12;
    return h === 0 ? 12 : h;
  });
  const [minute, setMinute] = useState(selected.getMinutes());
  const [period, setPeriod] = useState(selected.getHours() >= 12 ? 'pm' : 'am');

  useEffect(() => {
    if (!open) return undefined;
    const d = parseValue(value) || new Date();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setDraftDay(d.getDate());
    const h = d.getHours() % 12;
    setHour12(h === 0 ? 12 : h);
    setMinute(d.getMinutes());
    setPeriod(d.getHours() >= 12 ? 'pm' : 'am');
  }, [open, value]);

  useEffect(() => {
    if (!open) return undefined;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const calendarDays = useMemo(() => getCalendarDays(viewYear, viewMonth), [viewYear, viewMonth]);

  const hourOptions = Array.from({ length: 12 }, (_, i) => {
    const h = i + 1;
    return { value: h, label: pad(h) };
  });

  const minuteOptions = Array.from({ length: 60 }, (_, i) => ({
    value: i,
    label: pad(i),
  }));

  const periodOptions = [
    { value: 'am', label: 'AM' },
    { value: 'pm', label: 'PM' },
  ];

  function applySelection(day) {
    let hour24 = hour12 % 12;
    if (period === 'pm') hour24 += 12;
    const next = new Date(viewYear, viewMonth, day, hour24, minute, 0, 0);
    if (next < min) return;
    onChange(toValue(next));
  }

  function selectDay(day) {
    setDraftDay(day);
    applySelection(day);
  }

  function updateTime(nextHour12, nextMinute, nextPeriod) {
    const h = nextHour12 ?? hour12;
    const m = nextMinute ?? minute;
    const p = nextPeriod ?? period;
    let hour24 = h % 12;
    if (p === 'pm') hour24 += 12;
    const next = new Date(viewYear, viewMonth, draftDay, hour24, m, 0, 0);
    if (next < min) return;
    onChange(toValue(next));
  }

  function goMonth(delta) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  function setToday() {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setDraftDay(now.getDate());
    const h = now.getHours() % 12;
    setHour12(h === 0 ? 12 : h);
    setMinute(now.getMinutes());
    setPeriod(now.getHours() >= 12 ? 'pm' : 'am');
    onChange(toValue(now));
  }

  const today = new Date();

  return (
    <div ref={ref} className={`relative ${open ? 'z-50' : 'z-0'}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full min-w-0 bg-white border rounded-xl px-4 py-3 text-sm transition-all cursor-pointer flex items-center justify-between gap-3 focus:outline-none ${
          open
            ? 'border-brand-orange ring-2 ring-brand-orange/15'
            : 'border-brand-border focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/15'
        }`}
      >
        <span
          className={`min-w-0 flex-1 truncate whitespace-nowrap text-left ${
            value ? 'text-brand-dark font-medium' : 'text-brand-grey'
          }`}
        >
          {formatDisplay(value)}
        </span>
        <Calendar className={`w-4 h-4 shrink-0 ${open ? 'text-brand-orange' : 'text-brand-grey'}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute top-[calc(100%+6px)] left-0 right-0 sm:left-auto sm:right-0 sm:w-[min(100vw-2rem,420px)]"
          >
            <div className="bg-white border border-brand-border rounded-xl shadow-xl shadow-brand-orange/10 overflow-hidden">
              <div className="flex flex-col sm:flex-row">
                {/* Calendar */}
                <div className="flex-1 p-4 border-b sm:border-b-0 sm:border-r border-brand-border">
                  <div className="flex items-center justify-between mb-3">
                    <button
                      type="button"
                      onClick={() => goMonth(-1)}
                      className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-grey hover:text-brand-orange transition-colors cursor-pointer"
                      aria-label="Previous month"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm font-black text-brand-black">
                      {MONTHS[viewMonth]} {viewYear}
                    </span>
                    <button
                      type="button"
                      onClick={() => goMonth(1)}
                      className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-grey hover:text-brand-orange transition-colors cursor-pointer"
                      aria-label="Next month"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-7 gap-0.5 mb-1">
                    {WEEKDAYS.map((wd) => (
                      <div
                        key={wd}
                        className="text-[10px] font-bold text-brand-grey uppercase text-center py-1"
                      >
                        {wd}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-0.5">
                    {calendarDays.map((day, i) => {
                      if (day === null) return <div key={`empty-${i}`} />;
                      const cellDate = new Date(viewYear, viewMonth, day);
                      const parsed = parseValue(value);
                      const isSelected =
                        parsed &&
                        parsed.getDate() === day &&
                        parsed.getMonth() === viewMonth &&
                        parsed.getFullYear() === viewYear;
                      const isToday = isSameDay(cellDate, today);
                      const todayStart = new Date(min.getFullYear(), min.getMonth(), min.getDate());
                      const isPast = cellDate < todayStart;

                      return (
                        <button
                          key={day}
                          type="button"
                          disabled={isPast}
                          onClick={() => selectDay(day)}
                          className={`aspect-square rounded-lg text-sm font-medium transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                            isSelected
                              ? 'bg-brand-orange text-white font-bold shadow-md shadow-brand-orange/25'
                              : isToday
                                ? 'text-brand-orange font-bold ring-1 ring-brand-orange/40 hover:bg-brand-warm'
                                : 'text-brand-dark hover:bg-brand-warm hover:text-brand-orange'
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Time */}
                <div className="w-full sm:w-36 p-4 bg-brand-surface/30">
                  <div className="text-xs font-bold text-brand-orange uppercase tracking-wider mb-3 text-center">
                    Time
                  </div>
                  <div className="flex gap-1.5">
                    <TimeColumn
                      label="Hour"
                      options={hourOptions}
                      value={hour12}
                      onChange={(h) => {
                        setHour12(h);
                        updateTime(h, null, null);
                      }}
                    />
                    <TimeColumn
                      label="Min"
                      options={minuteOptions}
                      value={minute}
                      onChange={(m) => {
                        setMinute(m);
                        updateTime(null, m, null);
                      }}
                    />
                    <TimeColumn
                      label=""
                      options={periodOptions}
                      value={period}
                      onChange={(p) => {
                        setPeriod(p);
                        updateTime(null, null, p);
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-brand-border bg-brand-surface/40">
                <button
                  type="button"
                  onClick={() => {
                    onChange('');
                    setOpen(false);
                  }}
                  className="text-sm font-bold text-brand-grey hover:text-brand-orange transition-colors cursor-pointer"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setToday();
                    setOpen(false);
                  }}
                  className="text-sm font-bold text-brand-orange hover:text-brand-orange/80 transition-colors cursor-pointer"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-sm font-black bg-brand-orange text-white px-4 py-1.5 rounded-lg shadow-md shadow-brand-orange/20 hover:bg-brand-orange/90 transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
