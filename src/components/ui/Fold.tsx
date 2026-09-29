import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

/** A section with a heading that opens and closes it. Closed until opened, unless `defaultOpen`. */
export function Fold({ title, icon, defaultOpen = false, children, className }: {
  title: string; icon?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode; className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn('border-t border-gray-100', className)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 py-2.5 text-left hover:bg-gray-50 rounded transition-colors"
      >
        {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
        {icon}
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{title}</span>
      </button>
      {open && <div className="pb-3 space-y-3">{children}</div>}
    </div>
  );
}
