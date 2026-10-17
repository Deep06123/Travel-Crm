import { z } from "zod";

/**
 * Server-side pagination.
 *
 * Lists in this application are expected to grow past what a browser can hold,
 * so every list query takes `skip`/`take` and returns a total count. Nothing
 * fetches a full table and slices it in the client.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    // Capped so a crafted `?pageSize=1000000` cannot be used to exhaust memory.
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export interface PageRequest {
  skip: number;
  take: number;
}

export function toPageRequest({ page, pageSize }: PaginationInput): PageRequest {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function paginate<T>(
  rows: T[],
  total: number,
  { page, pageSize }: PaginationInput,
): Paginated<T> {
  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Builds a sort clause from a whitelist.
 *
 * The allowed columns are listed explicitly rather than passed through, so a
 * crafted `?sort=` cannot reach a column the list was never meant to order by.
 */
export function resolveSort<T extends string>(
  requested: string | undefined,
  allowed: readonly T[],
  fallback: T,
): { field: T; direction: "asc" | "desc" } {
  const [rawField, rawDirection] = (requested ?? "").split(":");
  const direction = rawDirection === "asc" ? "asc" : "desc";

  const field = allowed.includes(rawField as T) ? (rawField as T) : fallback;

  return { field, direction };
}
