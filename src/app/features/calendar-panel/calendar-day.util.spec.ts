import { DEFAULT_TASK, Task } from '../tasks/task.model';
import {
  buildCalendarDayView,
  isCalendarTimeStep,
  isSameCalendarDayView,
  layoutTimedBlocks,
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
  });

  describe('minutesToTimestamp', () => {
    it('maps minutes from the logical start', () => {
      expect(minutesToTimestamp(DAY, 0, 90)).toBe(at(1, 30));
    });
  });
});
