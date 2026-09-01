export const CORTEX_TIME_ZONE = "America/New_York";

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CORTEX_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function cortexDateParts(value: Date | string): DateParts {
  const date = typeof value === "string" ? new Date(value) : value;
  const values = Object.fromEntries(partsFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function wallClockTimestamp(value: Date): number {
  const parts = cortexDateParts(value);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

export function cortexDateTimeToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = target;
  for (let pass = 0; pass < 3; pass += 1) {
    const offset = wallClockTimestamp(new Date(instant)) - instant;
    const corrected = target - offset;
    if (corrected === instant) break;
    instant = corrected;
  }
  return new Date(instant);
}

export function startOfCortexDay(value = new Date()): Date {
  const parts = cortexDateParts(value);
  return cortexDateTimeToUtc(parts.year, parts.month, parts.day);
}

export function addCortexDays(value: Date, days: number): Date {
  const parts = cortexDateParts(value);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return cortexDateTimeToUtc(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

export function cortexDateKey(value: Date | string): string {
  const parts = cortexDateParts(value);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function formatCortexDate(value: Date | string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: CORTEX_TIME_ZONE }).format(typeof value === "string" ? new Date(value) : value);
}

export function formatCortexDateTime(value: Date | string): string {
  return formatCortexDate(value, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function parseCortexMonth(value: string | undefined, now = new Date()): { year: number; month: number } {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-").map(Number);
    if (month >= 1 && month <= 12) return { year, month };
  }
  const parts = cortexDateParts(now);
  return { year: parts.year, month: parts.month };
}

export function shiftMonthKey(year: number, month: number, delta: number): string {
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}
