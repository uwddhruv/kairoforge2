import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(value);
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat('en-IN', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(value);
}

export function isMarketOpen() {
  const now = new Date();
  // Indian Standard Time (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  
  const day = istDate.getUTCDay(); // 0 = Sunday, 1 = Monday...
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  
  // Market Open: Monday-Friday, 9:15 AM to 3:30 PM (15:30)
  const isWeekday = day >= 1 && day <= 5;
  const timeInMinutes = hours * 60 + minutes;
  const isOpenTime = timeInMinutes >= (9 * 60 + 15) && timeInMinutes < (15 * 60 + 30);
  
  return isWeekday && isOpenTime;
}
