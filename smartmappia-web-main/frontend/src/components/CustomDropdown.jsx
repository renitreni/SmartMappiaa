import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';

const selectTriggerClass =
  'w-full bg-white border rounded-xl text-sm transition-all cursor-pointer ' +
  'focus:outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/15';

export default function CustomDropdown({
  value,
  onChange,
  options,
  placeholder = 'Select',
  hasError = false,
  allowEmpty = true,
  compact = false,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

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

  const selected = options.find((o) => o.value === value);
  const display = selected?.label || placeholder;
  const borderClass = hasError ? 'border-red-300 ring-2 ring-red-100' : 'border-brand-border';

  return (
    <div ref={ref} className={`relative ${open ? 'z-50' : 'z-0'} ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${selectTriggerClass} flex items-center justify-between gap-2 ${borderClass} ${
          compact ? 'px-3 py-3' : 'px-4 py-3'
        } ${open ? 'border-brand-orange ring-2 ring-brand-orange/15' : ''}`}
      >
        <span
          className={`truncate text-left ${allowEmpty && !value ? 'text-brand-grey' : 'text-brand-dark font-medium'}`}
        >
          {display}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-brand-grey shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180 text-brand-orange' : ''
          }`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={`absolute top-[calc(100%+6px)] ${compact ? 'left-0 min-w-[148px]' : 'left-0 right-0 min-w-full'}`}
          >
            <ul
              role="listbox"
              className="bg-white border border-brand-border rounded-xl shadow-xl shadow-brand-orange/10 py-1.5 max-h-52 overflow-y-auto overscroll-contain"
            >
              {options.map((opt) => {
                const active = value === opt.value;
                return (
                  <li key={opt.value} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm text-left transition-colors cursor-pointer ${
                        active
                          ? 'bg-brand-warm text-brand-orange font-bold'
                          : 'text-brand-dark hover:bg-brand-surface hover:text-brand-orange'
                      }`}
                    >
                      <span className="truncate">{opt.label}</span>
                      {active && <Check className="w-4 h-4 shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
