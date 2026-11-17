import { DEFAULT_TASK, Task } from '../tasks/task.model';
import {
  buildCalendarDayView,
  isCalendarTimeStep,
  isSameCalendarDayView,
  isValidDueWithTime,
  layoutTimedBlocks,
  logicalDayDurationMinutes,
  logicalDayStartMs,
  minutesToTimestamp,
  shiftDayStr,
  snapMinutes,
} from './calendar-day.util';

const task = (over: Partial<Task>): Task =>
  ({
    ...DEFAULT_TASK,
    projectId: 'p',
    id: over.id ?? 't',
    title: over.title ?? 'Task',
    ...over,
  }) as Task;

const DAY = '2026-11-17';
const START = logicalDayStartMs(DAY, 0);
const at = (hours: number, minutes = 0): number => {
  const hourMinutes = hours * 60;
  const totalMinutes = hourMinutes + minutes;
  const offsetMs = totalMinutes * 60 * 1000;
  return START + offsetMs;
};

describe('calendar-day.util', () => {
  describe('shiftDayStr', () => {
    it('moves by calendar days, not 24 raw hours', () => {
      expect(shiftDayStr('2026-11-17', 1)).toBe('2026-11-18');
      expect(shiftDayStr('2026-11-17', -1)).toBe('2026-11-16');
      expect(shiftDayStr('2026-01-31', 1)).toBe('2026-02-01');
    });
  });

  describe('snapMinutes', () => {
    it('snaps to the step and stays within the day', () => {
      expect(snapMinutes(7, 15)).toBe(0);
      expect(snapMinutes(8, 15)).toBe(15);
      const hour23 = 23 * 60;
      const almostMidnight = hour23 + 59;
      const lastSlot = hour23 + 30;
      expect(snapMinutes(almostMidnight, 30)).toBe(lastSlot);
    });

    it('uses the real day length so a 25-hour day keeps the 23:00 hour', () => {
      const hours25 = 25 * 60;
      const late = 24 * 60;
      expect(snapMinutes(late, 30, hours25)).toBe(late);
      const over = hours25 + 10;
      const last = hours25 - 30;
      expect(snapMinutes(over, 30, hours25)).toBe(last);
    });

    it('keeps a click at the bottom of a 23-hour day on that day', () => {
      const hours23 = 23 * 60;
      const last = hours23 - 30;
      expect(snapMinutes(hours23, 30, hours23)).toBe(last);
    });
  });

  describe('isCalendarTimeStep', () => {
    it('accepts only 5/10/15/30/60', () => {
      expect(isCalendarTimeStep(15)).toBe(true);
      expect(isCalendarTimeStep(7)).toBe(false);
      expect(isCalendarTimeStep('15')).toBe(false);
    });
  });

  describe('buildCalendarDayView', () => {
    it('puts dueWithTime on the scale and dueDay in all-day; dueWithTime wins', () => {
      const view = buildCalendarDayView(
        [
          task({
            id: 'timed',
            title: 'Standup',
            dueWithTime: at(10),
            timeEstimate: 30 * 60 * 1000,
          }),
          task({ id: 'all', title: 'Review', dueDay: DAY }),
          task({
            id: 'both',
            title: 'Legacy',
            dueWithTime: at(14),
            dueDay: DAY,
            timeEstimate: 0,
          }),
          task({ id: 'other', title: 'Other', dueDay: '2026-11-16' }),
        ],
        DAY,
        0,
      );

      expect(view.allDay.map((i) => i.id)).toEqual(['all']);
      expect(view.timed.map((i) => i.id)).toEqual(['timed', 'both']);
      expect(view.timed[0].durationMs).toBe(30 * 60 * 1000);
      // без оцінки — запасні 30 хв, щоб блок був видимий
      expect(view.timed[1].durationMs).toBe(30 * 60 * 1000);
    });

    it('uses the logical day (startOfNextDay) for dueWithTime', () => {
      const fiveHours = 5 * 60 * 60 * 1000;
      const twoHoursMs = 2 * 60 * 60 * 1000;
      const earlyNextMorning = logicalDayStartMs('2026-11-18', 0) + twoHoursMs;
      const view = buildCalendarDayView(
        [
          task({
            id: 'early',
            dueWithTime: earlyNextMorning,
            timeEstimate: 15 * 60 * 1000,
          }),
        ],
        DAY,
        fiveHours,
      );
      expect(view.timed.map((i) => i.id)).toEqual(['early']);
    });

    it('skips a broken dueWithTime instead of throwing', () => {
      expect(() =>
        buildCalendarDayView(
          [
            task({ id: 'zero', title: 'Zero', dueWithTime: 0, dueDay: DAY }),
            task({ id: 'neg', title: 'Neg', dueWithTime: -5 }),
            task({ id: 'nan', title: 'NaN', dueWithTime: Number.NaN }),
            task({ id: 'ok', title: 'Ok', dueWithTime: at(10) }),
            task({ id: 'all', title: 'All', dueDay: DAY }),
          ],
          DAY,
          0,
        ),
      ).not.toThrow();
      const view = buildCalendarDayView(
        [
          task({ id: 'zero', title: 'Zero', dueWithTime: 0, dueDay: DAY }),
          task({ id: 'neg', title: 'Neg', dueWithTime: -5 }),
          task({ id: 'ok', title: 'Ok', dueWithTime: at(10) }),
          task({ id: 'all', title: 'All', dueDay: DAY }),
        ],
        DAY,
        0,
      );
      expect(view.timed.map((i) => i.id)).toEqual(['ok']);
      // пошкоджений dueWithTime не падає в all-day, навіть якщо dueDay заданий
      expect(view.allDay.map((i) => i.id)).toEqual(['all']);
      expect(isValidDueWithTime(0)).toBe(false);
      expect(isValidDueWithTime(at(10))).toBe(true);
    });

    it('isSameCalendarDayView ignores unrelated field changes via item equality', () => {
      const a = buildCalendarDayView(
        [task({ id: 'a', title: 'A', dueDay: DAY })],
        DAY,
        0,
      );
      const b = buildCalendarDayView(
        [task({ id: 'a', title: 'A', dueDay: DAY })],
        DAY,
        0,
      );
      expect(isSameCalendarDayView(a, b)).toBe(true);
      expect(
        isSameCalendarDayView(
          a,
          buildCalendarDayView([task({ id: 'a', title: 'B', dueDay: DAY })], DAY, 0),
        ),
      ).toBe(false);
    });
  });

  describe('layoutTimedBlocks', () => {
    it('stacks overlapping tasks into columns', () => {
      const items = [
        {
          id: 'a',
          title: 'A',
          isDone: false,
          startMs: at(10),
          durationMs: 2 * 60 * 60 * 1000,
        },
        {
          id: 'b',
          title: 'B',
          isDone: false,
          startMs: at(11),
          durationMs: 2 * 60 * 60 * 1000,
        },
      ];
      const laid = layoutTimedBlocks(items, START, 2400);
      expect(laid[0].col).toBe(0);
      expect(laid[1].col).toBe(1);
      expect(laid[0].cols).toBe(2);
      expect(laid[1].cols).toBe(2);
      expect(laid[0].top).toBeCloseTo((10 / 24) * 2400);
    });

    it('clips a block that crosses midnight or lasts more than the day', () => {
      const dayMs = 24 * 60 * 60 * 1000;
      const thirtyHoursMs = 30 * 60 * 60 * 1000;
      const items = [
        {
          id: 'late',
          title: 'Late',
          isDone: false,
          startMs: at(23),
          durationMs: 3 * 60 * 60 * 1000,
        },
        {
          id: 'huge',
          title: 'Huge',
          isDone: false,
          startMs: at(0),
          durationMs: thirtyHoursMs,
        },
      ];
      const laid = layoutTimedBlocks(items, START, 2400, dayMs);
      const late = laid.find((b) => b.item.id === 'late')!;
      const huge = laid.find((b) => b.item.id === 'huge')!;
      expect(late.top + late.height).toBeLessThanOrEqual(2400);
      expect(huge.top).toBe(0);
      expect(huge.height).toBe(2400);
      expect(huge.end - huge.start).toBe(dayMs);
    });
  });

  describe('minutesToTimestamp', () => {
    it('maps minutes from the logical start', () => {
      expect(minutesToTimestamp(DAY, 0, 90)).toBe(at(1, 30));
    });
  });

  describe('logicalDayDurationMinutes', () => {
    it('matches the span from this midnight to the next (DST-aware)', () => {
      const hours = logicalDayDurationMinutes(DAY, 0);
      expect(hours).toBeGreaterThanOrEqual(23 * 60);
      expect(hours).toBeLessThanOrEqual(25 * 60);
      const start = logicalDayStartMs(DAY, 0);
      const next = logicalDayStartMs(shiftDayStr(DAY, 1), 0);
      expect(hours * 60 * 1000).toBe(next - start);
    });
  });
});
