import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatValue(meters: number, unit: 'mm' | 'cm' | 'm', decimals: number = 2) {
  switch (unit) {
    case 'mm': return (meters * 1000).toFixed(decimals) + ' mm';
    case 'cm': return (meters * 100).toFixed(decimals) + ' cm';
    default: return meters.toFixed(decimals) + ' m';
  }
}

export function safelyToDate(val: any): Date {
  if (!val) return new Date(0);
  if (typeof val.toDate === 'function') return val.toDate();
  if (val instanceof Date) return val;
  if (typeof val === 'number') return new Date(val);
  if (val.seconds !== undefined) return new Date(val.seconds * 1000 + (val.nanoseconds || 0) / 1000000);
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? new Date(0) : d;
  }
  return new Date(0);
}
