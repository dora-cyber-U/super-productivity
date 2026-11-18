import { logicalDayStartMs } from './calendar-day.util';
import {
  isSameMonth,
  monthGridDays,
  moveDueWithTimeToDay,
  periodContainsDay,
  shiftMonthStr,
  shiftWeekStr,
  weekDays,
  weekStartDay,
} from './calendar-period.util';

describe('calendar-period.util', () => {
  describe('weekStartDay / weekDays', () => {
    it('starts on Monday by default (2026-11-18 is Wednesday)', () => {
      expect(weekStartDay('2026-11-18')).toBe('2026-11-16');
      expect(weekDays('2026-11-18')).toEqual([
        '2026-11-16',
        '2026-11-17',
        '2026-11-18',
        '2026-11-19',
        '2026-11-20',
        '2026-11-21',
        '2026-11-22',
      ]);
    });

    it('starts on Sunday when firstDayOfWeek is 0', () => {
      expect(weekStartDay('2026-11-18', 0)).toBe('2026-11-15');
      expect(weekDays('2026-11-18', 0)[0]).toBe('2026-11-15');
      expect(weekDays('2026-11-18', 0)[6]).toBe('2026-11-21');
    });

    it('does not skip or duplicate a day across the 25 h DST fall-back (2026-10-25)', () => {
      const days = weekDays('2026-10-25', 1);
      expect(days).toEqual([
        '2026-10-19',
        '2026-10-20',
        '2026-10-21',
        '2026-10-22',
        '2026-10-23',
        '2026-10-24',
        '2026-10-25',
      ]);
    });

    it('does not skip a day across the 23 h DST spring-forward (2027-03-28)', () => {
      const days = weekDays('2027-03-28', 1);
      expect(days).toEqual([
        '2027-03-22',
        '2027-03-23',
        '2027-03-24',
        '2027-03-25',
        '2027-03-26',
        '2027-03-27',
        '2027-03-28',
      ]);
    });
  });

  describe('shiftWeekStr / shiftMonthStr', () => {
    it('shifts by whole weeks', () => {
      expect(shiftWeekStr('2026-11-18', 1)).toBe('2026-11-25');
      expect(shiftWeekStr('2026-11-18', -1)).toBe('2026-11-11');
    });

    it('keeps the day of month when the target month is long enough', () => {
      expect(shiftMonthStr('2026-11-18', 1)).toBe('2026-12-18');
      expect(shiftMonthStr('2026-11-18', -1)).toBe('2026-10-18');
    });

    it('clamps Jan 31 to the last day of February', () => {
      expect(shiftMonthStr('2026-01-31', 1)).toBe('2026-02-28');
      expect(shiftMonthStr('2028-01-31', 1)).toBe('2028-02-29');
    });
  });

  describe('monthGridDays', () => {
    it('covers November 2026 in 6 weeks starting Monday', () => {
      const days = monthGridDays('2026-11-18', 1);
      expect(days[0]).toBe('2026-10-26');
      expect(days[days.length - 1]).toBe('2026-12-06');
      expect(days.length).toBe(42);
      expect(days.includes('2026-11-01')).toBe(true);
      expect(days.includes('2026-11-30')).toBe(true);
    });

    it('keeps a full week around the DST spring-forward in March 2027', () => {
      const days = monthGridDays('2027-03-15', 1);
      expect(days.includes('2027-03-28')).toBe(true);
      expect(days.includes('2027-03-29')).toBe(true);
      const i = days.indexOf('2027-03-28');
      expect(days[i + 1]).toBe('2027-03-29');
      expect(days.length % 7).toBe(0);
    });
  });

  describe('periodContainsDay', () => {
    it('matches the exact day, the week or the month', () => {
      expect(periodContainsDay('2026-11-18', '2026-11-18', 'day')).toBe(true);
      expect(periodContainsDay('2026-11-18', '2026-11-17', 'day')).toBe(false);
      expect(periodContainsDay('2026-11-18', '2026-11-16', 'week', 1)).toBe(true);
      expect(periodContainsDay('2026-11-18', '2026-11-15', 'week', 1)).toBe(false);
      expect(periodContainsDay('2026-11-18', '2026-11-30', 'month')).toBe(true);
      expect(periodContainsDay('2026-11-18', '2026-12-01', 'month')).toBe(false);
    });

    it('isSameMonth compares YYYY-MM', () => {
      expect(isSameMonth('2026-11-01', '2026-11-30')).toBe(true);
      expect(isSameMonth('2026-11-01', '2026-12-01')).toBe(false);
    });
  });

  describe('moveDueWithTimeToDay', () => {
    const tenHoursMs = 10 * 60 * 60 * 1000;

    it('keeps 10:00 when moving across a normal day', () => {
      const from = '2026-11-18';
      const to = '2026-11-20';
      const due = logicalDayStartMs(from, 0) + tenHoursMs;
      const moved = moveDueWithTimeToDay(due, from, to, 0);
      expect(moved).toBe(logicalDayStartMs(to, 0) + tenHoursMs);
    });

    it('keeps 10:00 when dragging from 28.03.2027 (23 h) to the next day', () => {
      const from = '2027-03-28';
      const to = '2027-03-29';
      const due = logicalDayStartMs(from, 0) + tenHoursMs;
      const moved = moveDueWithTimeToDay(due, from, to, 0);
      expect(moved).toBe(logicalDayStartMs(to, 0) + tenHoursMs);
      expect(new Date(moved).getHours()).toBe(10);
    });

    it('keeps 10:00 when dragging onto the 25 h fall-back day', () => {
      const from = '2026-10-24';
      const to = '2026-10-25';
      const due = logicalDayStartMs(from, 0) + tenHoursMs;
      const moved = moveDueWithTimeToDay(due, from, to, 0);
      expect(moved).toBe(logicalDayStartMs(to, 0) + tenHoursMs);
    });

    it('clamps a late start from a 25 h day onto a 23 h day', () => {
      const from = '2026-10-25';
      const to = '2027-03-28';
      const dayMs = 24 * 60 * 60 * 1000;
      const halfHourMs = 30 * 60 * 1000;
      const late = dayMs + halfHourMs;
      const due = logicalDayStartMs(from, 0) + late;
      const moved = moveDueWithTimeToDay(due, from, to, 0);
      const toStart = logicalDayStartMs(to, 0);
      const toDur = logicalDayStartMs('2027-03-29', 0) - toStart;
      expect(moved).toBe(toStart + toDur - 1);
      expect(moved).toBeLessThan(logicalDayStartMs('2027-03-29', 0));
    });
  });
});
