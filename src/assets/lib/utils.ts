import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
