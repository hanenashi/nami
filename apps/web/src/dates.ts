import type { NamiEvent } from './api.js';

export function formatCalendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(year, month - 1, day));
}

export function formatEventDates(event: Pick<NamiEvent, 'startDate' | 'endDate'>) {
  const start = formatCalendarDate(event.startDate);
  if (!event.endDate || event.endDate === event.startDate) return start;
  return `${start} – ${formatCalendarDate(event.endDate)}`;
}

export function formatTimestampDate(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(value));
}
