// Display formatting shared by the views. Formatting only; no figure is computed here.

export function formatUtc(tMs: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(tMs));
}

/** 'YYYY-MM-DD HH:mm' in UTC, fixed width for telemetry readouts. */
export function formatUtcStamp(tMs: number): string {
  return new Date(tMs).toISOString().slice(0, 16).replace('T', ' ');
}

export function formatHours(hours: number): string {
  if (hours <= 0) return '0 min';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

/** Days rounded to two decimals, without the unit. */
export function slipDaysNumber(days: number): string {
  return String(Math.round(days * 100) / 100);
}

export function formatSlipDays(days: number): string {
  return `${slipDaysNumber(days)} d`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatSignedDegrees(value: number, digits = 2): string {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}°`;
}
