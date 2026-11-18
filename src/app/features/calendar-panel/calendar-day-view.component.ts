import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { TaskService } from '../tasks/task.service';
import {
  CALENDAR_DAY_LABEL_GUTTER_PX,
  CALENDAR_DAY_PX_PER_HOUR,
} from './calendar-panel.const';
import { CalendarDayItem, CalendarTimeStep } from './calendar-panel.model';
import {
  layoutTimedBlocks,
  logicalDayDurationMinutes,
  logicalDayDurationMs,
  logicalDayStartMs,
  minutesToTimestamp,
  snapMinutes,
} from './calendar-day.util';

/**
 * Денний вигляд календаря: all-day, вертикальна шкала, блоки за dueWithTime.
 * Лише показ і створення через TaskService.add — без змін моделі чи sync.
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
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _host = inject(ElementRef<HTMLElement>);

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

  private _nowTimer: number | null = null;
  private _scrolledForDay: string | null = null;
  private readonly _scrollRetryIds: number[] = [];
  private readonly _onVisibility = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this._tickNow();
    }
    this._syncNowTimer();
  };

  constructor() {
    effect(() => {
      this.isToday();
      this.dayStartMs();
      this._tickNow();
      this._syncNowTimer();
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
    });
  }

  onScaleDblClick(ev: MouseEvent): void {
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
}
