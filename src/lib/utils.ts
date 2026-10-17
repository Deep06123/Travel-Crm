import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges class names, with later Tailwind utilities overriding earlier ones.
 *
 * Plain string concatenation leaves both `p-2` and `p-4` in the list and the
 * winner depends on stylesheet order; `twMerge` resolves the conflict so a
 * component's `className` prop reliably overrides its defaults.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
