import { CALENDAR_DAY_HEIGHT_PX, CALENDAR_DAY_PX_PER_HOUR } from './calendar-panel.const';
import { CalendarDayItem } from './calendar-panel.model';
import {
  isSameTimedDrop,
  markOverlappingIds,
  minutesFromScaleY,
  snapDragStartMinutes,
  markOverlapsForItem,
  snapResizeDurationMinutes,
  yToMinutes,
} from './calendar-day-drag.util';

const hourPx = CALENDAR_DAY_PX_PER_HOUR;
const start9 = 9 * 60;

describe('calendar-day-drag.util', () => {
  describe('yToMinutes', () => {
    it('maps one hour of scale height to 60 minutes', () => {
      expect(yToMinutes(hourPx)).toBe(60);
    });
  });

  describe('snapDragStartMinutes', () => {
    it('snaps a one-hour move to the current step', () => {
      expect(snapDragStartMinutes(start9, hourPx, 30, 30)).toBe(10 * 60);
      expect(snapDragStartMinutes(start9, hourPx, 15, 30)).toBe(10 * 60);
    });

    it('snaps a small move down to the previous or next slot', () => {
      // 10 хв при кроці 30 лишаються на 9:00; 30 хв (половина години) — вже 9:30
      const tenMinPx = hourPx / 6;
      expect(snapDragStartMinutes(start9, tenMinPx, 30, 30)).toBe(start9);
      expect(snapDragStartMinutes(start9, hourPx / 2, 30, 30)).toBe(start9 + 30);
    });

    it('keeps the block inside the day', () => {
      const duration = 90;
      const almostEnd = 23 * 60;
      const moved = snapDragStartMinutes(almostEnd, hourPx, 30, duration);
      const hour22 = 22 * 60;
      const lastOnStep = hour22 + 30;
      expect(moved).toBe(lastOnStep);
      expect(moved + duration).toBeLessThanOrEqual(24 * 60);
    });

    it('does not go before the start of the scale', () => {
      expect(snapDragStartMinutes(30, -2 * hourPx, 30, 30)).toBe(0);
    });

    it('does not snap a block longer than the day back to 00:00', () => {
      const thirtyHours = 30 * 60;
      expect(snapDragStartMinutes(2 * 60, hourPx, 30, thirtyHours)).toBe(3 * 60);
    });

    it('keeps a move on a 23-hour day on that day', () => {
      const hours23 = 23 * 60;
      const moved = snapDragStartMinutes(
        22 * 60,
        hourPx,
        30,
        30,
        CALENDAR_DAY_HEIGHT_PX,
        hours23,
      );
      expect(moved + 30).toBeLessThanOrEqual(hours23);
      expect(moved).toBeGreaterThan(0);
    });
  });

  describe('snapResizeDurationMinutes', () => {
    it('grows and shrinks by the step', () => {
      expect(snapResizeDurationMinutes(30, hourPx, 30, start9)).toBe(90);
      expect(snapResizeDurationMinutes(90, -hourPx, 30, start9)).toBe(30);
    });

    it('does not shrink below the current step', () => {
      expect(snapResizeDurationMinutes(30, -hourPx, 30, start9)).toBe(30);
      expect(snapResizeDurationMinutes(15, -hourPx, 15, start9)).toBe(15);
    });

    it('does not extend past the end of the day', () => {
      const start = 22 * 60;
      expect(snapResizeDurationMinutes(30, 5 * hourPx, 30, start)).toBe(2 * 60);
    });

    it('does not cut an existing duration when growing on a 25-hour day', () => {
      const hours25 = 25 * 60;
      const start = 22 * 60;
      const grown = snapResizeDurationMinutes(
        180,
        10,
        30,
        start,
        CALENDAR_DAY_HEIGHT_PX,
        hours25,
      );
      expect(grown).toBeGreaterThanOrEqual(180);
    });
  });

  describe('minutesFromScaleY', () => {
    it('uses scroll offset like the double-click mapping', () => {
      const tenHoursY = (10 / 24) * CALENDAR_DAY_HEIGHT_PX;
      const scrollTop = 200;
      const visibleY = tenHoursY - scrollTop;
      expect(minutesFromScaleY(visibleY, 0, scrollTop, 30)).toBe(10 * 60);
    });
  });

  describe('markOverlappingIds', () => {
    const item = (
      id: string,
      startHour: number,
      durationMin: number,
    ): CalendarDayItem => {
      const hourMs = 60 * 60 * 1000;
      const minuteMs = 60 * 1000;
      return {
        id,
        title: id,
        isDone: false,
        startMs: startHour * hourMs,
        durationMs: durationMin * minuteMs,
      };
    };

    it('marks blocks that share an interval, but not those that only touch', () => {
      const overlapping = markOverlappingIds([
        item('a', 9, 60),
        item('b', 9.5, 60),
        item('c', 11, 30),
      ]);
      expect(overlapping.has('a')).toBeTrue();
      expect(overlapping.has('b')).toBeTrue();
      expect(overlapping.has('c')).toBeFalse();

      const touching = markOverlappingIds([item('a', 9, 60), item('d', 10, 30)]);
      expect(touching.size).toBe(0);
    });

    it('ignores all-day items', () => {
      const ids = markOverlappingIds([
        { id: 'all', title: 'x', isDone: false, startMs: null, durationMs: 0 },
        item('a', 9, 30),
      ]);
      expect(ids.size).toBe(0);
    });

    it('marks only overlaps with the dragged block', () => {
      const preview = item('a', 9.5, 60);
      const ids = markOverlapsForItem(
        [item('a', 9, 60), item('b', 9.5, 60), item('c', 12, 30)],
        preview,
      );
      expect(ids.has('a')).toBeTrue();
      expect(ids.has('b')).toBeTrue();
      expect(ids.has('c')).toBeFalse();
    });
  });

  describe('isSameTimedDrop', () => {
    it('skips a no-op drop', () => {
      expect(isSameTimedDrop(1, 2, 1, 2)).toBeTrue();
      expect(isSameTimedDrop(1, 2, 1, 3)).toBeFalse();
    });
  });
});
