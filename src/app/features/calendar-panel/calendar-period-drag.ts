import { ElementRef, signal } from '@angular/core';
import {
  CALENDAR_DAY_DRAG_THRESHOLD_PX,
  CALENDAR_DAY_TOUCH_LONG_PRESS_MS,
  CALENDAR_DAY_TOUCH_SLOP_PX,
} from './calendar-panel.const';
import { CalendarDayItem } from './calendar-panel.model';

export interface PeriodDragState {
  item: CalendarDayItem;
  fromDay: string;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  active: boolean;
  touchPending?: boolean;
  touchReady?: boolean;
  dropDay: string | null;
}

export const dropDayFromPoint = (x: number, y: number): string | null => {
  const el = document.elementFromPoint(x, y);
  if (!(el instanceof Element)) {
    return null;
  }
  const day = el.closest('[data-cal-day]')?.getAttribute('data-cal-day');
  return day || null;
};

/**
 * Спільне перетягування між днями: long-press на touch, rAF-throttle, скидання
 * на lostpointercapture / pointercancel / Escape.
 */
export class CalendarPeriodDrag {
  readonly state = signal<PeriodDragState | null>(null);
  private _raf = 0;
  private _pendingMove: PointerEvent | null = null;
  private _pressTimer = 0;
  private readonly _onDocMove = (ev: PointerEvent): void => this._onMove(ev);
  private readonly _onDocUp = (ev: PointerEvent): void => this._onUp(ev);
  private readonly _onDocCancel = (ev: PointerEvent): void => {
    if (this.state()?.pointerId === ev.pointerId) {
      this.cancel();
    }
  };
  private readonly _onLost = (ev: PointerEvent): void => {
    if (this.state()?.pointerId === ev.pointerId) {
      this.cancel();
    }
  };
  private readonly _onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' && this.state()) {
      ev.preventDefault();
      ev.stopPropagation();
      this.cancel();
    }
  };

  constructor(
    private readonly _host: ElementRef<HTMLElement>,
    private readonly _commit: (
      item: CalendarDayItem,
      fromDay: string,
      toDay: string,
    ) => void,
  ) {}

  onPointerDown(ev: PointerEvent, item: CalendarDayItem, fromDay: string): void {
    if (ev.button !== 0 || this.state()) {
      return;
    }
    const isTouch = ev.pointerType === 'touch';
    const draft: PeriodDragState = {
      item,
      fromDay,
      pointerId: ev.pointerId,
      pointerType: ev.pointerType,
      startX: ev.clientX,
      startY: ev.clientY,
      clientX: ev.clientX,
      clientY: ev.clientY,
      active: false,
      touchPending: isTouch,
      touchReady: false,
      dropDay: fromDay,
    };
    this.state.set(draft);
    this._bind(ev, isTouch);
    if (isTouch) {
      this._pressTimer = window.setTimeout(() => {
        const cur = this.state();
        if (!cur || cur.pointerId !== ev.pointerId || cur.active) {
          return;
        }
        this.state.set({ ...cur, touchPending: false, touchReady: true });
        try {
          if (ev.target instanceof Element) {
            ev.target.releasePointerCapture?.(ev.pointerId);
          }
        } catch {
          // вже відпущено
        }
        this._safeCapture(ev.pointerId);
      }, CALENDAR_DAY_TOUCH_LONG_PRESS_MS);
      return;
    }
    ev.preventDefault();
    this._safeCapture(ev.pointerId);
  }

  cancel(): void {
    this._clear();
  }

  destroy(): void {
    this._clear();
  }

  private _safeCapture(pointerId: number): void {
    try {
      this._host.nativeElement.setPointerCapture?.(pointerId);
    } catch {
      // у тестах немає реального pointerId
    }
  }

  private _bind(ev: PointerEvent, isTouch: boolean): void {
    document.addEventListener('pointermove', this._onDocMove, true);
    document.addEventListener('pointerup', this._onDocUp, true);
    document.addEventListener('pointercancel', this._onDocCancel, true);
    document.addEventListener('lostpointercapture', this._onLost, true);
    document.addEventListener('keydown', this._onKey, true);
    if (!isTouch) {
      ev.stopPropagation();
    }
  }

  private _onMove(ev: PointerEvent): void {
    const cur = this.state();
    if (!cur || ev.pointerId !== cur.pointerId) {
      return;
    }
    const dx = ev.clientX - cur.startX;
    const dy = ev.clientY - cur.startY;
    const dist = Math.hypot(dx, dy);
    if (cur.touchPending) {
      if (dist >= CALENDAR_DAY_TOUCH_SLOP_PX) {
        this._clear();
      }
      return;
    }
    if (!cur.active) {
      const ready = cur.touchReady || cur.pointerType !== 'touch';
      const threshold = cur.touchReady ? 0 : CALENDAR_DAY_DRAG_THRESHOLD_PX;
      if (!ready || dist < threshold) {
        return;
      }
      ev.preventDefault();
      this._applyMove(cur, ev, true);
      return;
    }
    ev.preventDefault();
    this._pendingMove = ev;
    if (this._raf) {
      return;
    }
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const move = this._pendingMove;
      this._pendingMove = null;
      const latest = this.state();
      if (!move || !latest?.active) {
        return;
      }
      this._applyMove(latest, move, false);
    });
  }

  private _applyMove(cur: PeriodDragState, ev: PointerEvent, activate: boolean): void {
    const dropDay = dropDayFromPoint(ev.clientX, ev.clientY);
    this.state.set({
      ...cur,
      clientX: ev.clientX,
      clientY: ev.clientY,
      active: true,
      touchPending: false,
      dropDay,
    });
    if (activate) {
      this._safeCapture(ev.pointerId);
    }
  }

  private _onUp(ev: PointerEvent): void {
    const cur = this.state();
    if (!cur || ev.pointerId !== cur.pointerId) {
      return;
    }
    const dropDay = cur.active ? dropDayFromPoint(ev.clientX, ev.clientY) : null;
    const item = cur.item;
    const fromDay = cur.fromDay;
    this._clear();
    if (dropDay && dropDay !== fromDay) {
      this._commit(item, fromDay, dropDay);
    }
  }

  private _clear(): void {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    this._pendingMove = null;
    if (this._pressTimer) {
      window.clearTimeout(this._pressTimer);
      this._pressTimer = 0;
    }
    const cur = this.state();
    if (cur) {
      try {
        this._host.nativeElement.releasePointerCapture?.(cur.pointerId);
      } catch {
        // вже знято
      }
    }
    document.removeEventListener('pointermove', this._onDocMove, true);
    document.removeEventListener('pointerup', this._onDocUp, true);
    document.removeEventListener('pointercancel', this._onDocCancel, true);
    document.removeEventListener('lostpointercapture', this._onLost, true);
    document.removeEventListener('keydown', this._onKey, true);
    this.state.set(null);
  }
}
