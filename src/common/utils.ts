import { Prisma, TicketStatus } from '@prisma/client';
import { AppError } from './app-error';

export type Tx = Prisma.TransactionClient;

export const TX_OPTS = { timeout: 20000, maxWait: 20000 };

/** A ticket that still occupies its vehicle for the day. */
export const ACTIVE_STATUSES: TicketStatus[] = ['BOOKED', 'CALLED', 'LOADING', 'SHELVED', 'SKIPPED'];

/** Serialises every write on one queue day (safe concurrent booking at 18:00). */
export const lockDay = (tx: Tx, dayId: number) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(${dayId}::bigint)`;

/** Search-only normalisation of Arabic text (the displayed name is never changed). */
export function normalizeArabic(input?: string): string {
  if (!input) return '';
  const indic = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return input
    .replace(/[\u064B-\u065F\u0640]/g, '') // diacritics + tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String(indic.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** 'YYYY-MM-DD' (or ISO string / Date) -> Date at UTC midnight, matches @db.Date. */
export function dateOnly(v: string | Date): Date {
  if (v instanceof Date) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  return new Date(`${v.slice(0, 10)}T00:00:00.000Z`);
}

/** Today's date in the server timezone (set TZ=Asia/Damascus). */
export function todayDate(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Booking window check, always on the SERVER clock. */
export function isWindowOpen(day: { status: string; bookingClosesAt: Date | null }): boolean {
  return day.status === 'BOOKING_OPEN' && (!day.bookingClosesAt || new Date() <= day.bookingClosesAt);
}

export function toInt(v: string | undefined, name: string): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new AppError('INVALID_QUERY', `${name} must be an integer`);
  return n;
}

export function asEnum<T extends Record<string, string>>(e: T, v: string | undefined, name: string): T[keyof T] | undefined {
  if (v === undefined || v === '') return undefined;
  if (!Object.values(e).includes(v)) throw new AppError('INVALID_QUERY', `Invalid ${name}: ${v}`);
  return v as T[keyof T];
}

export function groupByAgent(lines: { agentId: string; qty: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.agentId, (m.get(l.agentId) ?? 0) + l.qty);
  return m;
}

/** Make a value safe for a JSON column (Dates -> strings). */
export const plain = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
