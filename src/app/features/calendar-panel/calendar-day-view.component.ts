import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  Injector,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { PlannerActions } from '../planner/store/planner.actions';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { TaskService } from '../tasks/task.service';
import { SnackService } from '../../core/snack/snack.service';
import {
  CALENDAR_DAY_DRAG_THRESHOLD_PX,
  CALENDAR_DAY_LABEL_GUTTER_PX,
  CALENDAR_DAY_PX_PER_HOUR,
  CALENDAR_DAY_TOUCH_LONG_PRESS_MS,
  CALENDAR_DAY_TOUCH_SLOP_PX,
} from './calendar-panel.const';
import { CalendarDayItem, CalendarTimeStep } from './calendar-panel.model';
import {
  durationMsFromMinutes,
  isSameTimedDrop,
  markOverlappingIds,
  markOverlapsForItem,
  minutesFromMs,
  minutesFromScaleY,
  minutesToY,
  snapDragStartMinutes,
  snapResizeDurationMinutes,
} from './calendar-day-drag.util';
import {
  layoutTimedBlocks,
  logicalDayDurationMinutes,
  logicalDayDurationMs,
  logicalDayStartMs,
  minutesToTimestamp,
  snapMinutes,
} from './calendar-day.util';

type DayDragMode = 'move' | 'resize' | 'fromAllDay';

interface DayDragState {
  mode: DayDragMode;
  item: CalendarDayItem;
  pointerId: number;
  startClientY: number;
  originStartMin: number;
  originDurationMin: number;
  previewStartMin: number;
  previewDurationMin: number;
  /** Прев'ю «без часу»: блок відпускають у смугу all-day. */
  toAllDay: boolean;
  /** true, коли рух уже перевищив поріг і це справжнє перетягування. */
  active: boolean;
  /** Touch: ще чекаємо long-press, вертикальний скрол дозволений. */
  touchPending?: boolean;
  /** Touch: long-press уже минув, наступний рух починає drag. */
  touchReady?: boolean;
  /** Клавіатурне прев'ю (Alt+стрілки): без pointer-слухачів, commit на keyup. */
  fromKeyboard?: boolean;
}

/**
 * Денний вигляд календаря: all-day, вертикальна шкала, блоки за dueWithTime.
 * Створення — TaskService.add; переміщення й resize — TaskService.update /
 * planTaskForDay. Без змін моделі чи sync. Операція лише після drop.
 */
@Component({
  selector: 'calendar-day-view',
  templateUrl: './calendar-day-view.component.html',
  styleUrl: './calendar-day-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslatePipe],
})
export class CalendarDayViewComponent {
  private readonly _tasks = inject(TaskService);
  private readonly _dt = inject(DateTimeFormatService);
  private readonly _store = inject(Store);
  private readonly _injector = inject(Injector);
  private readonly _host = inject(ElementRef<HTMLElement>);
  private readonly _destroyRef = inject(DestroyRef);

  readonly T = T;

  readonly day = input.required<string>();
  readonly step = input.required<CalendarTimeStep>();
  readonly startOfNextDayDiffMs = input(0);
  readonly allDay = input<readonly CalendarDayItem[]>([]);
  readonly timed = input<readonly CalendarDayItem[]>([]);
  readonly isToday = input(false);

  readonly dayStartMs = computed(() =>
    logicalDayStartMs(this.day(), this.startOfNextDayDiffMs()),
  );
  /** Реальна довжина логічного дня (23/24/25 год під час DST). */
  readonly dayLengthMinutes = computed(() =>
    logicalDayDurationMinutes(this.day(), this.startOfNextDayDiffMs()),
  );
  readonly dayLengthMs = computed(() =>
    logicalDayDurationMs(this.day(), this.startOfNextDayDiffMs()),
  );
  readonly scaleHeight = computed(
    () => (this.dayLengthMinutes() / 60) * CALENDAR_DAY_PX_PER_HOUR,
  );
  readonly ticks = computed(() => {
    const step = this.step();
    const start = this.dayStartMs();
    const length = this.dayLengthMinutes();
    const height = this.scaleHeight();
    const out: { minutes: number; top: number; isHour: boolean; label: string }[] = [];
    for (let minutes = 0; minutes < length; minutes += step) {
      const isHour = minutes % 60 === 0;
      const offsetMs = minutes * 60 * 1000;
      const ts = start + offsetMs;
      out.push({
        minutes,
        top: (minutes / length) * height,
        isHour,
        label: isHour || step >= 30 ? this._dt.formatTime(ts) : '',
      });
    }
    return out;
  });
  readonly blocks = computed(() =>
    layoutTimedBlocks(
      this.timed(),
      this.dayStartMs(),
      this.scaleHeight(),
      this.dayLengthMs(),
    ),
  );

  /** Хвилини від початку логічного дня для лінії «зараз»; null, якщо день не сьогодні. */
  readonly nowMinutes = signal<number | null>(null);
  readonly nowTop = computed(() => {
    const minutes = this.nowMinutes();
    return minutes == null
      ? null
      : (minutes / this.dayLengthMinutes()) * this.scaleHeight();
  });

  /** Чернетка з подвійного кліку: хвилини на шкалі та назва. */
  readonly composer = signal<{ minutes: number; title: string } | null>(null);
  readonly composerTop = computed(() => {
    const c = this.composer();
    return c == null ? null : (c.minutes / this.dayLengthMinutes()) * this.scaleHeight();
  });
  readonly composerTime = computed(() => {
    const c = this.composer();
    return c == null
      ? ''
      : this._dt.formatTime(
          minutesToTimestamp(this.day(), this.startOfNextDayDiffMs(), c.minutes),
        );
  });

  readonly drag = signal<DayDragState | null>(null);
  /**
   * Лише id/active/touch* — без прев'ю, щоб pointermove не перемальовував
   * усі блоки на шкалі.
   */
  readonly dragSession = signal<{
    id: string;
    active: boolean;
    touchPending: boolean;
    touchReady: boolean;
  } | null>(null);
  readonly ghostOverlaps = signal(false);
  /** Після перерозкладки (блок перетнув інший) повертаємо фокус за id. */
  private readonly _pendingFocusId = signal<string | null>(null);
  private _previewOverlapIds = new Set<string>();

  /** Базові накладки: під час drag не залежить від прев'ю, тож «!» інших блоків лишаються. */
  readonly overlapIds = computed(() => {
    const items = this.timed();
    const session = this.dragSession();
    if (session?.active) {
      return markOverlappingIds(items.filter((item) => item.id !== session.id));
    }
    return markOverlappingIds(items);
  });

  readonly isAllDayDropTarget = computed(() => {
    const d = this.drag();
    return !!d?.active && d.toAllDay && d.mode !== 'resize';
  });

  readonly ghostStyle = computed(() => {
    const d = this.drag();
    if (!d?.active || d.toAllDay) {
      return null;
    }
    const height = this.scaleHeight();
    const length = this.dayLengthMinutes();
    return this.blockStyle({
      col: 0,
      cols: 1,
      top: minutesToY(d.previewStartMin, height, length),
      height: Math.max(18, minutesToY(d.previewDurationMin, height, length)),
    });
  });

  readonly ghostStart = computed(() => {
    const d = this.drag();
    return !d?.active || d.toAllDay
      ? ''
      : this._dt.formatTime(this._minutesToTs(d.previewStartMin));
  });

  readonly ghostEnd = computed(() => {
    const d = this.drag();
    if (!d?.active || d.toAllDay) {
      return '';
    }
    const endMin = d.previewStartMin + d.previewDurationMin;
    return this._dt.formatTime(this._minutesToTs(endMin));
  });

  private _nowTimer: number | null = null;
  private _scrolledForDay: string | null = null;
  private readonly _scrollRetryIds: number[] = [];
  private _longPressTimer: number | null = null;
  private _moveFrame = 0;
  private _queuedMove: PointerEvent | null = null;
  private readonly _onVisibility = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this._tickNow();
    } else {
      // Прихована вкладка: скасувати клавіатурне прев'ю, щоб пізній keyup не записав.
      this._cancelKeyboardPreview();
    }
    this._syncNowTimer();
  };

  /** Скасовує прев'ю Alt+стрілка, якщо фокус або вкладка зникли до keyup. */
  private _cancelKeyboardPreview(): void {
    if (this.drag()?.fromKeyboard) {
      this._clearDrag();
    }
  }

  private readonly _onWindowBlur = (): void => {
    this._cancelKeyboardPreview();
  };

  constructor() {
    effect(() => {
      this.isToday();
      this.dayStartMs();
      this._tickNow();
      this._syncNowTimer();
    });
    afterRenderEffect(() => {
      const id = this._pendingFocusId();
      this.blocks();
      if (!id) {
        return;
      }
      untracked(() => {
        const el = this._host.nativeElement.querySelector(
          `.day-block[data-block-id="${CSS.escape(id)}"]`,
        ) as HTMLElement | null;
        el?.focus({ preventScroll: true });
        this._pendingFocusId.set(null);
      });
    });
    effect(() => {
      const isToday = this.isToday();
      const day = this.day();
      const nowTop = this.nowTop();
      if (!isToday) {
        this._scrolledForDay = null;
        return;
      }
      if (nowTop == null || this._scrolledForDay === day) {
        return;
      }
      untracked(() => this._scrollToNow(nowTop, day));
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVisibility);
    }
    this._destroyRef.onDestroy(() => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this._onVisibility);
      }
      this._stopNowTimer();
      this._clearScrollRetries();
      this._clearDragListeners();
    });
  }

  isSourceItem(id: string): boolean {
    const s = this.dragSession();
    return !!s?.active && s.id === id;
  }

  isDragReady(id: string): boolean {
    const s = this.dragSession();
    return !!s && s.id === id && !s.touchPending;
  }

  onScaleDblClick(ev: MouseEvent): void {
    if (this.drag()) {
      return;
    }
    const target = ev.target as Element | null;
    // Смуга клікабельна: дабл-клік по тілу відкриває композер на цей час,
    // назва і ручка зміни тривалості не створюють нову задачу.
    if (
      target?.closest(
        '.day-composer, button, a, input, .day-block-title, .day-block-resize',
      )
    ) {
      return;
    }
    if (target?.closest('.day-block:not(.is-band)')) {
      return;
    }
    const scale = ev.currentTarget as HTMLElement;
    const visibleY = ev.clientY - scale.getBoundingClientRect().top;
    // scrollTop потрібен, коли шкала сама прокручується всередині панелі
    const y = visibleY + scale.scrollTop;
    const length = this.dayLengthMinutes();
    const minutes = snapMinutes((y / this.scaleHeight()) * length, this.step(), length);
    this._openComposer(minutes, scale);
  }

  onScaleKeydown(ev: KeyboardEvent): void {
    if (ev.key !== 'Enter') {
      return;
    }
    const target = ev.target as Element | null;
    if (target?.closest('.day-block, .day-composer, input, button, a')) {
      return;
    }
    ev.preventDefault();
    const now = this.nowMinutes();
    const minutes =
      now == null ? 0 : snapMinutes(now, this.step(), this.dayLengthMinutes());
    this._openComposer(minutes, ev.currentTarget as HTMLElement);
  }

  /** Відкрити композер; якщо вже є набраний текст — спочатку зберегти його. */
  private _openComposer(minutes: number, scale: HTMLElement): void {
    const existing = this.composer();
    if (existing?.title.trim()) {
      this.commitComposer();
    }
    this.composer.set({ minutes, title: '' });
    window.setTimeout(() => {
      scale.querySelector<HTMLInputElement>('.day-composer input')?.focus();
    }, 0);
  }

  onBlockPointerDown(
    ev: PointerEvent,
    item: CalendarDayItem,
    mode: 'move' | 'resize',
  ): void {
    if (ev.button !== 0 || item.startMs == null) {
      return;
    }
    ev.stopPropagation();
    this._beginPointer(ev, item, mode);
  }

  onAllDayPointerDown(ev: PointerEvent, item: CalendarDayItem): void {
    if (ev.button !== 0) {
      return;
    }
    ev.stopPropagation();
    this._beginPointer(ev, item, 'fromAllDay');
  }

  onBlockKeydown(ev: KeyboardEvent, item: CalendarDayItem): void {
    // Escape не можна глушити: інакше window-хендлер не скасує drag, коли блок у фокусі.
    if (ev.key === 'Escape') {
      if (this.drag()) {
        ev.preventDefault();
        ev.stopPropagation();
        this._clearDrag();
      }
      return;
    }
    ev.stopPropagation();
    if (!ev.altKey || item.startMs == null) {
      return;
    }
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') {
      return;
    }
    ev.preventDefault();
    // Поки затиснуто — лише прев'ю; запис буде на keyup (repeat не створює ops)
    this._nudgeBlockPreview(item, ev.key === 'ArrowDown' ? 1 : -1, ev.shiftKey);
  }

  onBlockBlur(): void {
    this._cancelKeyboardPreview();
  }

  blockAriaLabel(item: CalendarDayItem): string {
    if (item.startMs == null) {
      return item.title;
    }
    const start = this._dt.formatTime(item.startMs);
    const end = this._dt.formatTime(item.startMs + item.durationMs);
    return `${item.title}, ${start}–${end}`;
  }

  private _tickNow(): void {
    if (!this.isToday()) {
      this.nowMinutes.set(null);
      return;
    }
    const minutes = (Date.now() - this.dayStartMs()) / 60000;
    const length = this.dayLengthMinutes();
    this.nowMinutes.set(minutes >= 0 && minutes <= length ? minutes : null);
  }

  private _syncNowTimer(): void {
    const hidden =
      typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (!this.isToday() || hidden) {
      this._stopNowTimer();
      return;
    }
    if (this._nowTimer == null) {
      this._nowTimer = window.setInterval(() => this._tickNow(), 30000);
    }
  }

  private _stopNowTimer(): void {
    if (this._nowTimer != null) {
      window.clearInterval(this._nowTimer);
      this._nowTimer = null;
    }
  }

  /** Перший показ сьогоднішнього дня: лінія «зараз» приблизно на третині висоти. */
  private _scrollToNow(nowTop: number, day: string): void {
    // Позначаємо одразу, щоб 30-секундний тік не запускав прокрутку знову.
    this._scrolledForDay = day;
    this._clearScrollRetries();
    const apply = (): void => {
      const host = this._host.nativeElement;
      const scale = host.querySelector('.scale') as HTMLElement | null;
      if (!scale) {
        return;
      }
      const hostEl = host as HTMLElement;
      const scaleScrolls = scale.scrollHeight - scale.clientHeight > 8;
      const hostScrolls = hostEl.scrollHeight - hostEl.clientHeight > 8;
      const scroller = scaleScrolls ? scale : hostScrolls ? hostEl : scale;
      if (scroller.clientHeight <= 0) {
        return;
      }
      const thirdVisible = scroller.clientHeight / 3;
      const target = Math.max(0, nowTop - thirdVisible);
      scroller.scrollTop = target;
    };
    apply();
    // Overlay і flex-розкладка можуть дати остаточну висоту пізніше за перший кадр.
    for (const delay of [50, 250]) {
      this._scrollRetryIds.push(window.setTimeout(apply, delay));
    }
  }

  private _clearScrollRetries(): void {
    for (const id of this._scrollRetryIds) {
      window.clearTimeout(id);
    }
    this._scrollRetryIds.length = 0;
  }

  onComposerTitle(title: string): void {
    this.composer.update((c) => (c ? { ...c, title } : c));
  }

  commitComposer(): void {
    const c = this.composer();
    const title = c?.title.trim() ?? '';
    if (!c || !title) {
      this.composer.set(null);
      return;
    }
    const dueWithTime = minutesToTimestamp(
      this.day(),
      this.startOfNextDayDiffMs(),
      c.minutes,
    );
    // Існуюча дія addTask: час і оцінка (один крок шкали) одразу в задачі
    this._tasks.add(title, false, {
      dueWithTime,
      timeEstimate: this.step() * 60 * 1000,
    });
    this.composer.set(null);
  }

  cancelComposer(): void {
    this.composer.set(null);
  }

  blockStyle(block: {
    col: number;
    cols: number;
    top: number;
    height: number;
    isBand?: boolean;
  }): Record<string, string> {
    const gutter = CALENDAR_DAY_LABEL_GUTTER_PX;
    if (block.isBand) {
      // На всю ширину шкали, під звичайними блоками
      return {
        top: `${block.top}px`,
        height: `${block.height}px`,
        left: `${gutter}px`,
        width: `calc(100% - ${gutter}px - 2px)`,
      };
    }
    const cols = block.cols;
    const col = block.col;
    return {
      top: `${block.top}px`,
      height: `${block.height}px`,
      left: `calc(${gutter}px + (100% - ${gutter}px) * ${col} / ${cols} + 2px)`,
      width: `calc((100% - ${gutter}px) / ${cols} - 4px)`,
    };
  }

  private _minutesToTs(minutes: number): number {
    return minutesToTimestamp(this.day(), this.startOfNextDayDiffMs(), minutes);
  }

  private _beginPointer(
    ev: PointerEvent,
    item: CalendarDayItem,
    mode: DayDragMode,
  ): void {
    if (ev.pointerType === 'touch') {
      this._armTouch(ev, item, mode);
      return;
    }
    ev.preventDefault();
    this._armDrag(ev, item, mode);
  }

  private _armDrag(
    ev: PointerEvent,
    item: CalendarDayItem,
    mode: DayDragMode,
    opts: { touchPending?: boolean; touchReady?: boolean } = {},
  ): void {
    this._clearDragListeners();
    const startMin =
      item.startMs == null ? 0 : minutesFromMs(item.startMs - this.dayStartMs());
    const durationMin =
      item.durationMs > 0 ? minutesFromMs(item.durationMs) : this.step();
    const draft: DayDragState = {
      mode,
      item,
      pointerId: ev.pointerId,
      startClientY: ev.clientY,
      originStartMin: startMin,
      originDurationMin: durationMin,
      previewStartMin: startMin,
      previewDurationMin: durationMin,
      toAllDay: mode === 'fromAllDay',
      active: false,
      touchPending: opts.touchPending,
      touchReady: opts.touchReady,
    };
    this._writeDrag(draft);
    this._bindDragListeners();
    if (!opts.touchPending) {
      this._capturePointer(ev);
    }
  }

  /** На touch спершу чекаємо long-press, щоб свайп прокручував шкалу. */
  private _armTouch(ev: PointerEvent, item: CalendarDayItem, mode: DayDragMode): void {
    const target = ev.currentTarget as HTMLElement;
    this._armDrag(ev, item, mode, { touchPending: true });
    this._longPressTimer = window.setTimeout(() => {
      this._longPressTimer = null;
      const d = this.drag();
      if (!d || d.pointerId !== ev.pointerId || d.active) {
        return;
      }
      this._writeDrag({ ...d, touchPending: false, touchReady: true });
      // touch-action фіксується на pointerdown (pan-y), тож клас .is-drag-ready
      // не зупиняє скрол. Non-passive touchmove + preventDefault тримає pointer.
      window.addEventListener('touchmove', this._onTouchMoveGuard, {
        passive: false,
      });
      // CDP/деякі WebView не завжди шлють pointerup після preventDefault(touchmove).
      window.addEventListener('touchend', this._onTouchEnd);
      window.addEventListener('touchcancel', this._onTouchCancel);
      try {
        target.setPointerCapture(ev.pointerId);
      } catch {
        // немає layout — як і для миші в тестах
      }
    }, CALENDAR_DAY_TOUCH_LONG_PRESS_MS);
  }

  private _capturePointer(ev: PointerEvent): void {
    const target = ev.currentTarget as HTMLElement | null;
    if (!target || typeof target.setPointerCapture !== 'function') {
      return;
    }
    try {
      target.setPointerCapture(ev.pointerId);
    } catch {
      // Chrome у тестах може не мати capture на вузлі без layout
    }
  }

  private _bindDragListeners(): void {
    window.addEventListener('pointermove', this._onPointerMove, { passive: false });
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerCancel, true);
    window.addEventListener('lostpointercapture', this._onLostPointerCapture, true);
    window.addEventListener('keydown', this._onKeyDown);
  }

  /** Якщо pointerup загубився, все одно фіксуємо або скасовуємо drag. */
  private readonly _onTouchEnd = (): void => {
    const d = this.drag();
    if (!d || d.fromKeyboard) {
      return;
    }
    if (!d.active) {
      this._clearDrag();
      return;
    }
    this._commitDrag(d);
    this._clearDrag();
  };

  private readonly _onTouchCancel = (): void => {
    const d = this.drag();
    if (!d || d.fromKeyboard) {
      return;
    }
    this._clearDrag();
  };

  /** Після long-press блокує нативний pan-y, щоб не приходив pointercancel. */
  private readonly _onTouchMoveGuard = (ev: TouchEvent): void => {
    const s = this.dragSession();
    if (!s || s.touchPending || !(s.touchReady || s.active)) {
      return;
    }
    ev.preventDefault();
  };

  private readonly _onPointerMove = (ev: PointerEvent): void => {
    const d = this.drag();
    if (!d || ev.pointerId !== d.pointerId) {
      return;
    }
    if (d.touchPending) {
      if (Math.abs(ev.clientY - d.startClientY) >= CALENDAR_DAY_TOUCH_SLOP_PX) {
        // Це скрол, а не перетягування
        this._clearDrag();
      }
      return;
    }
    // Перший рух, що перетинає поріг, обробляємо одразу; далі — по кадрах.
    if (!d.active) {
      this._applyPointerMove(ev);
      return;
    }
    this._queuedMove = ev;
    if (this._moveFrame) {
      return;
    }
    this._moveFrame = window.requestAnimationFrame(() => {
      this._moveFrame = 0;
      const queued = this._queuedMove;
      this._queuedMove = null;
      if (queued) {
        this._applyPointerMove(queued);
      }
    });
  };

  private _applyPointerMove(ev: PointerEvent): void {
    const d = this.drag();
    if (!d || ev.pointerId !== d.pointerId) {
      return;
    }
    const deltaY = ev.clientY - d.startClientY;
    if (!d.active && Math.abs(deltaY) < CALENDAR_DAY_DRAG_THRESHOLD_PX) {
      return;
    }
    ev.preventDefault();
    this.composer.set(null);
    const step = this.step();
    const height = this.scaleHeight();
    const length = this.dayLengthMinutes();
    const overAllDay = d.mode !== 'resize' && this._isOverAllDay(ev);
    if (d.mode === 'move') {
      const start = overAllDay
        ? d.originStartMin
        : snapDragStartMinutes(
            d.originStartMin,
            deltaY,
            step,
            d.originDurationMin,
            height,
            length,
          );
      this._writePreview({
        ...d,
        active: true,
        toAllDay: overAllDay,
        previewStartMin: start,
        previewDurationMin: d.originDurationMin,
      });
      return;
    }
    if (d.mode === 'resize') {
      const duration = snapResizeDurationMinutes(
        d.originDurationMin,
        deltaY,
        step,
        d.originStartMin,
        height,
        length,
      );
      this._writePreview({
        ...d,
        active: true,
        toAllDay: false,
        previewStartMin: d.originStartMin,
        previewDurationMin: duration,
      });
      return;
    }
    const overScale = this._isOverScale(ev);
    const start = overScale ? this._minutesAtPointer(ev) : d.previewStartMin;
    this._writePreview({
      ...d,
      active: true,
      toAllDay: !overScale,
      previewStartMin: start,
      previewDurationMin: d.originDurationMin,
    });
  }

  private readonly _onPointerUp = (ev: PointerEvent): void => {
    const d = this.drag();
    if (!d || ev.pointerId !== d.pointerId) {
      return;
    }
    if (!d.active) {
      this._clearDrag();
      return;
    }
    ev.preventDefault();
    this._commitDrag(d);
    this._clearDrag();
  };

  private readonly _onPointerCancel = (ev: PointerEvent): void => {
    const d = this.drag();
    if (!d || ev.pointerId !== d.pointerId) {
      return;
    }
    this._clearDrag();
  };

  private readonly _onLostPointerCapture = (ev: PointerEvent): void => {
    const d = this.drag();
    if (!d || ev.pointerId !== d.pointerId) {
      return;
    }
    this._clearDrag();
  };

  private readonly _onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' && this.drag()) {
      ev.preventDefault();
      ev.stopPropagation();
      this._clearDrag();
    }
  };

  private _commitDrag(d: DayDragState): void {
    const id = d.item.id;
    this._pendingFocusId.set(id);
    if (d.toAllDay) {
      if (d.mode === 'fromAllDay') {
        return;
      }
      this._tasks.getByIdOnce$(id).subscribe((task) => {
        const hadReminder = !!(task.remindAt ?? task.reminderId);
        this._store.dispatch(
          PlannerActions.planTaskForDay({
            task,
            day: this.day(),
            isShowSnack: false,
          }),
        );
        // planTaskForDay знімає remindAt (як upstream planner). Залишити
        // нагадування для all-day задачі застосунок не вміє — кажемо про це.
        if (hadReminder) {
          this._injector.get(SnackService).open({
            msg: T.F.CALENDAR_PANEL.REMINDER_REMOVED,
          });
        }
      });
      return;
    }
    if (d.mode === 'fromAllDay') {
      this._commitFromAllDay(id, this._minutesToTs(d.previewStartMin), d);
      return;
    }
    const nextStart = this._minutesToTs(d.previewStartMin);
    const nextDuration = durationMsFromMinutes(d.previewDurationMin);
    const prevStart = d.item.startMs as number;
    const prevDuration = d.item.durationMs;
    if (isSameTimedDrop(prevStart, prevDuration, nextStart, nextDuration)) {
      return;
    }
    if (d.mode === 'resize') {
      this._tasks.update(id, { timeEstimate: nextDuration });
      return;
    }
    this._commitMove(id, nextStart);
  }

  /**
   * All-day → шкала: scheduleTaskWithTime (1 операція) очищає dueDay у
   * reducer'і, тож на іншому пристрої поле теж зникне, і TODAY.taskIds
   * не перебудовуються (порядок у «Сьогодні» лишається). Оцінку кроком
   * ставимо окремим update лише якщо її не було.
   */
  private _commitFromAllDay(id: string, dueWithTime: number, d: DayDragState): void {
    const estimate =
      d.item.durationMs > 0 ? null : durationMsFromMinutes(d.previewDurationMin);
    this._tasks.getByIdOnce$(id).subscribe((task) => {
      this._store.dispatch(
        TaskSharedActions.scheduleTaskWithTime({
          task,
          dueWithTime,
          isMoveToBacklog: false,
        }),
      );
      if (estimate != null) {
        this._tasks.update(id, { timeEstimate: estimate });
      }
    });
  }

  /**
   * Перенесення зі збереженням відступу нагадування, як у schedule-day-panel.
   * Без нагадування лишаємо одну операцію update.
   */
  private _commitMove(id: string, dueWithTime: number): void {
    this._tasks.getByIdOnce$(id).subscribe((task) => {
      const hasReminder = !!(task.remindAt ?? task.reminderId);
      if (!hasReminder) {
        this._tasks.update(id, { dueWithTime });
        return;
      }
      const remindAt =
        task.dueWithTime && typeof task.remindAt === 'number'
          ? dueWithTime - (task.dueWithTime - task.remindAt)
          : dueWithTime;
      this._store.dispatch(
        TaskSharedActions.reScheduleTaskWithTime({
          task,
          dueWithTime,
          ...(typeof remindAt === 'number' ? { remindAt } : {}),
          isMoveToBacklog: false,
        }),
      );
    });
  }

  /** Починає або продовжує клавіатурне прев'ю; commit — на keyup. */
  private _nudgeBlockPreview(item: CalendarDayItem, dir: 1 | -1, resize: boolean): void {
    if (item.startMs == null) {
      return;
    }
    const current = this.drag();
    if (current && !current.fromKeyboard) {
      return;
    }
    if (!current || current.item.id !== item.id) {
      const startMin = minutesFromMs(item.startMs - this.dayStartMs());
      const durationMin =
        item.durationMs > 0 ? minutesFromMs(item.durationMs) : this.step();
      this._writeDrag({
        mode: resize ? 'resize' : 'move',
        item,
        pointerId: -1,
        startClientY: 0,
        originStartMin: startMin,
        originDurationMin: durationMin,
        previewStartMin: startMin,
        previewDurationMin: durationMin,
        toAllDay: false,
        active: true,
        fromKeyboard: true,
      });
      this._bindKeyboardNudgeListeners();
    }
    this._stepKeyboardNudge(dir);
  }

  private _stepKeyboardNudge(dir: 1 | -1): void {
    const d = this.drag();
    if (!d?.fromKeyboard) {
      return;
    }
    const step = this.step();
    const height = this.scaleHeight();
    const length = this.dayLengthMinutes();
    const stepPx = (step / length) * height;
    const deltaY = dir * stepPx;
    if (d.mode === 'resize') {
      const nextDur = snapResizeDurationMinutes(
        d.previewDurationMin,
        deltaY,
        step,
        d.previewStartMin,
        height,
        length,
      );
      if (nextDur !== d.previewDurationMin) {
        this._writePreview({ ...d, previewDurationMin: nextDur });
      }
      return;
    }
    const nextStartMin = snapDragStartMinutes(
      d.previewStartMin,
      deltaY,
      step,
      d.previewDurationMin,
      height,
      length,
    );
    if (nextStartMin !== d.previewStartMin) {
      this._writePreview({ ...d, previewStartMin: nextStartMin });
    }
  }

  private _bindKeyboardNudgeListeners(): void {
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('blur', this._onWindowBlur);
  }

  private readonly _onKeyUp = (ev: KeyboardEvent): void => {
    const d = this.drag();
    if (!d?.fromKeyboard) {
      return;
    }
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown' && ev.key !== 'Alt') {
      return;
    }
    ev.preventDefault();
    this._commitDrag(d);
    this._clearDrag();
  };

  private _isOverAllDay(ev: PointerEvent): boolean {
    const el = this._host.nativeElement.querySelector('.all-day');
    if (!el) {
      return false;
    }
    const r = el.getBoundingClientRect();
    return (
      ev.clientX >= r.left &&
      ev.clientX <= r.right &&
      ev.clientY >= r.top &&
      ev.clientY <= r.bottom
    );
  }

  private _isOverScale(ev: PointerEvent): boolean {
    const el = this._scaleEl();
    if (!el) {
      return false;
    }
    const r = el.getBoundingClientRect();
    return (
      ev.clientX >= r.left &&
      ev.clientX <= r.right &&
      ev.clientY >= r.top &&
      ev.clientY <= r.bottom
    );
  }

  private _minutesAtPointer(ev: PointerEvent): number {
    const scale = this._scaleEl();
    if (!scale) {
      return snapMinutes(0, this.step());
    }
    return minutesFromScaleY(
      ev.clientY,
      scale.getBoundingClientRect().top,
      scale.scrollTop,
      this.step(),
      this.scaleHeight(),
      this.dayLengthMinutes(),
    );
  }

  private _scaleEl(): HTMLElement | null {
    return this._host.nativeElement.querySelector('.scale');
  }

  private _writeDrag(d: DayDragState | null): void {
    this.drag.set(d);
    this._syncDragSession(d);
    this._syncPreviewOverlapMarks(d);
  }

  /** Оновлює прев'ю; session — лише коли змінюється active/touch*. */
  private _writePreview(d: DayDragState): void {
    this.drag.set(d);
    this._syncDragSession(d);
    this._syncPreviewOverlapMarks(d);
  }

  private _syncDragSession(d: DayDragState | null): void {
    const next = d
      ? {
          id: d.item.id,
          active: d.active,
          touchPending: !!d.touchPending,
          touchReady: !!d.touchReady,
        }
      : null;
    const cur = this.dragSession();
    if (
      cur?.id === next?.id &&
      cur?.active === next?.active &&
      cur?.touchPending === next?.touchPending &&
      cur?.touchReady === next?.touchReady
    ) {
      return;
    }
    this.dragSession.set(next);
  }

  private _syncPreviewOverlapMarks(d: DayDragState | null): void {
    const next = new Set<string>();
    if (d?.active && !d.toAllDay) {
      const preview: CalendarDayItem = {
        ...d.item,
        startMs: this._minutesToTs(d.previewStartMin),
        durationMs: durationMsFromMinutes(d.previewDurationMin),
      };
      for (const id of markOverlapsForItem(this.timed(), preview)) {
        next.add(id);
      }
    }
    const host = this._host.nativeElement;
    for (const id of this._previewOverlapIds) {
      if (!next.has(id)) {
        host
          .querySelector(`.day-block[data-block-id="${CSS.escape(id)}"]`)
          ?.classList.remove('is-preview-overlap');
      }
    }
    for (const id of next) {
      if (!this._previewOverlapIds.has(id)) {
        host
          .querySelector(`.day-block[data-block-id="${CSS.escape(id)}"]`)
          ?.classList.add('is-preview-overlap');
      }
    }
    this._previewOverlapIds = next;
    this.ghostOverlaps.set(!!d && next.has(d.item.id));
  }

  private _clearDrag(): void {
    this._clearDragListeners();
    this._writeDrag(null);
  }

  private _clearDragListeners(): void {
    if (this._longPressTimer != null) {
      window.clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
    if (this._moveFrame) {
      window.cancelAnimationFrame(this._moveFrame);
      this._moveFrame = 0;
    }
    this._queuedMove = null;
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerCancel, true);
    window.removeEventListener('lostpointercapture', this._onLostPointerCapture, true);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onWindowBlur);
    window.removeEventListener('touchmove', this._onTouchMoveGuard);
    window.removeEventListener('touchend', this._onTouchEnd);
    window.removeEventListener('touchcancel', this._onTouchCancel);
  }
}
