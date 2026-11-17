import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { TaskService } from '../tasks/task.service';
import {
  CALENDAR_DAY_HEIGHT_PX,
  CALENDAR_DAY_LABEL_GUTTER_PX,
} from './calendar-panel.const';
import { CalendarDayItem, CalendarTimeStep } from './calendar-panel.model';
import {
  layoutTimedBlocks,
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

  readonly T = T;
  readonly scaleHeight = CALENDAR_DAY_HEIGHT_PX;

  readonly day = input.required<string>();
  readonly step = input.required<CalendarTimeStep>();
  readonly startOfNextDayDiffMs = input(0);
  readonly allDay = input<readonly CalendarDayItem[]>([]);
  readonly timed = input<readonly CalendarDayItem[]>([]);
  readonly isToday = input(false);

  readonly dayStartMs = computed(() =>
    logicalDayStartMs(this.day(), this.startOfNextDayDiffMs()),
  );
  readonly ticks = computed(() => {
    const step = this.step();
    const start = this.dayStartMs();
    const out: { minutes: number; top: number; isHour: boolean; label: string }[] = [];
    for (let minutes = 0; minutes < 24 * 60; minutes += step) {
      const isHour = minutes % 60 === 0;
      const offsetMs = minutes * 60 * 1000;
      const ts = start + offsetMs;
      out.push({
        minutes,
        top: (minutes / (24 * 60)) * CALENDAR_DAY_HEIGHT_PX,
        isHour,
        label: isHour || step >= 30 ? this._dt.formatTime(ts) : '',
      });
    }
    return out;
  });
  readonly blocks = computed(() =>
    layoutTimedBlocks(this.timed(), this.dayStartMs(), CALENDAR_DAY_HEIGHT_PX),
  );

  /** Хвилини від початку логічного дня для лінії «зараз»; null, якщо день не сьогодні. */
  readonly nowMinutes = signal<number | null>(null);
  readonly nowTop = computed(() => {
    const minutes = this.nowMinutes();
    return minutes == null ? null : (minutes / (24 * 60)) * CALENDAR_DAY_HEIGHT_PX;
  });

  /** Чернетка з подвійного кліку: хвилини на шкалі та назва. */
  readonly composer = signal<{ minutes: number; title: string } | null>(null);
  readonly composerTop = computed(() => {
    const c = this.composer();
    return c == null ? null : (c.minutes / (24 * 60)) * CALENDAR_DAY_HEIGHT_PX;
  });
  readonly composerTime = computed(() => {
    const c = this.composer();
    return c == null
      ? ''
      : this._dt.formatTime(
          minutesToTimestamp(this.day(), this.startOfNextDayDiffMs(), c.minutes),
        );
  });

  constructor() {
    effect(() => {
      this.isToday();
      this.dayStartMs();
      this._tickNow();
    });
    const id = window.setInterval(() => this._tickNow(), 30000);
    this._destroyRef.onDestroy(() => window.clearInterval(id));
  }

  onScaleDblClick(ev: MouseEvent): void {
    const target = ev.target as Element | null;
    if (target?.closest('.day-block, .day-composer, button, a, input')) {
      return;
    }
    const scale = ev.currentTarget as HTMLElement;
    const visibleY = ev.clientY - scale.getBoundingClientRect().top;
    // scrollTop потрібен, коли шкала сама прокручується всередині панелі
    const y = visibleY + scale.scrollTop;
    const minutesInDay = 24 * 60;
    const minutes = snapMinutes((y / CALENDAR_DAY_HEIGHT_PX) * minutesInDay, this.step());
    this.composer.set({ minutes, title: '' });
    window.setTimeout(() => {
      scale.querySelector<HTMLInputElement>('.day-composer input')?.focus();
    }, 0);
  }

  private _tickNow(): void {
    if (!this.isToday()) {
      this.nowMinutes.set(null);
      return;
    }
    const minutes = (Date.now() - this.dayStartMs()) / 60000;
    this.nowMinutes.set(minutes >= 0 && minutes <= 24 * 60 ? minutes : null);
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
  }): Record<string, string> {
    const gutter = CALENDAR_DAY_LABEL_GUTTER_PX;
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
