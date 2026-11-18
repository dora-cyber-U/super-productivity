import { getDbDateStr } from './get-db-date-str';

export const isTodayWithOffset = (
  date: number | Date,
  todayStr: string,
  startOfNextDayDiffMs: number,
): boolean => {
  const d = new Date(date);
  if (!(d.getTime() > 0)) {
    throw new Error('Invalid date passed');
  }
  return getDbDateStr(new Date(d.getTime() - startOfNextDayDiffMs)) === todayStr;
};

/**
 * Decides whether a task's `dueWithTime` should be dropped when (re)scheduling
 * the task onto `todayStr`: `true` = clear the time, `false` = keep it.
 *
 * Clears when the timestamp is missing-as-invalid (non-finite, non-positive, or
 * outside the JS `Date` range) or falls on a different logical day; keeps it only
 * for a valid timestamp that lands on today. `undefined`/`null` (no time set)
 * returns `false` so callers don't spuriously flag a change.
 *
 * Unlike a bare `isTodayWithOffset` call this never throws: the range is guarded
 * here before delegating, so a corrupt timestamp is cleared instead of blowing up.
 */
export const shouldClearDueTimeForToday = (
  dueWithTime: number | null | undefined,
  todayStr: string,
  startOfNextDayDiffMs: number,
): boolean => {
  if (dueWithTime === undefined || dueWithTime === null) {
    return false;
  }
  if (!(new Date(dueWithTime).getTime() > 0)) {
    return true;
  }
  return !isTodayWithOffset(dueWithTime, todayStr, startOfNextDayDiffMs);
};

/** A dueWithTime that isTodayWithOffset can read without throwing. */
export const isSafeDueWithTime = (
  dueWithTime: number | null | undefined,
): dueWithTime is number =>
  typeof dueWithTime === 'number' &&
  Number.isFinite(dueWithTime) &&
  dueWithTime > 0 &&
  Number.isFinite(new Date(dueWithTime).getTime());

/** Відкидає некоректний dueWithTime, не змінюючи формат операції. */
export const sanitizeDueWithTime = (
  dueWithTime: number | null | undefined,
): number | undefined => (isSafeDueWithTime(dueWithTime) ? dueWithTime : undefined);

/**
 * true, якщо в changes є лише некоректне числове dueWithTime (його reducer
 * не застосує). Такі update не треба писати в op-log як порожній HU.
 * null лишаємо: це навмисне зняття часу.
 */
export const isUnsafeDueWithTimeOnlyUpdate = (changes: object | undefined): boolean => {
  if (!changes || !Object.prototype.hasOwnProperty.call(changes, 'dueWithTime')) {
    return false;
  }
  const raw = (changes as { dueWithTime?: number | null }).dueWithTime;
  if (raw == null || sanitizeDueWithTime(raw) === raw) {
    return false;
  }
  return Object.keys(changes).every((key) => key === 'dueWithTime');
};

/**
 * Like isTodayWithOffset, but returns false for invalid timestamps instead of
 * throwing. Use at Today-list call sites so a corrupt dueWithTime cannot break
 * the list.
 */
export const isDueWithTimeOnDay = (
  dueWithTime: number | null | undefined,
  dayStr: string,
  startOfNextDayDiffMs: number,
): boolean =>
  isSafeDueWithTime(dueWithTime) &&
  isTodayWithOffset(dueWithTime, dayStr, startOfNextDayDiffMs);

/** @deprecated Use `DateService.isToday()` or `isTodayWithOffset()` instead for offset-aware comparison. */
export const isToday = (date: number | Date): boolean => {
  const d = new Date(date);
  const isValid = d.getTime() > 0;
  if (!isValid) {
    throw new Error('Invalid date passed');
  }
  const today = new Date();
  // return (today.toDateString() === d.toDateString());
  // return  today.setHours(0, 0, 0, 0) === d.setHours(0, 0, 0, 0);
  return (
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()
  );
};
