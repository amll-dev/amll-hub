import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** 合并 Tailwind class：条件拼接 + 冲突去重（后者覆盖前者） */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
