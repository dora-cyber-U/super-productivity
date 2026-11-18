import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { T } from '../../t.const';
import { CalendarDayItem, CalendarDayView } from './calendar-panel.model';
import { markOverlappingIds } from './calendar-day-drag.util';
import { CalendarPeriodDrag, bindCalendarItemFocusRestore } from './calendar-period-drag';
import { CalendarScheduleService } from './calendar-schedule.service';

@Component({
  selector: 'calendar-week-view',
  templateUrl: './calendar-week-view.component.html',
  styleUrl: './calendar-week-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
})
export class CalendarWeekViewComponent {
  private readonly _dt = inject(DateTimeFormatService);
  private readonly _translate = inject(TranslateService);
  private readonly _schedule = inject(CalendarScheduleService);
  private readonly _host = inject(ElementRef<HTMLElement>);
  private readonly _drag = new CalendarPeriodDrag(this._host, (item, from, to) =>
    this._schedule.moveItemToDay(
      item.id,
      from,
      to,
      this.startOfNextDayDiffMs(),
      item.startMs == null,
    ),
  );

  readonly T = T;
  readonly days = input.required<readonly CalendarDayView[]>();
  readonly today = input('');
  readonly startOfNextDayDiffMs = input(0);
  readonly openDay = output<string>();

  readonly drag = this._drag.state;
  readonly overlapByDay = computed(() => {
    const map = new Map<string, ReadonlySet<string>>();
    for (const day of this.days()) {
      map.set(day.day, markOverlappingIds(day.timed));
    }
    return map;
  });

  constructor() {
    bindCalendarItemFocusRestore(this._host, this._drag.pendingFocusId, () =>
      this.days(),
    );
    inject(DestroyRef).onDestroy(() => this._drag.destroy());
  }

  weekdayLabel(day: string): string {
    return new Intl.DateTimeFormat(this._dt.textLocale(), { weekday: 'short' }).format(
      new Date(`${day}T12:00:00`),
    );
  }

  dateLabel(day: string): string {
    return new Intl.DateTimeFormat(this._dt.textLocale(), {
      day: 'numeric',
      month: 'short',
    }).format(new Date(`${day}T12:00:00`));
  }

  timeLabel(item: CalendarDayItem): string {
    if (item.startMs == null) {
      return '';
    }
    return this._dt.formatTime(item.startMs);
  }

  itemAriaLabel(item: CalendarDayItem, overlaps: boolean): string {
    const time = this.timeLabel(item);
    const title = item.title;
    const overlap = overlaps
      ? ` ${this._translate.instant(T.F.CALENDAR_PANEL.OVERLAP)}`
      : '';
    return time ? `${title}, ${time}${overlap}` : `${title}${overlap}`;
  }

  isSource(id: string): boolean {
    return this.drag()?.item.id === id && !!this.drag()?.active;
  }

  isDragReady(id: string): boolean {
    const d = this.drag();
    return d?.item.id === id && !!d.touchReady && !d.active;
  }

  isDropTarget(day: string): boolean {
    const d = this.drag();
    return !!d?.active && d.dropDay === day && d.fromDay !== day;
  }

  onItemPointerDown(ev: PointerEvent, item: CalendarDayItem, day: string): void {
    this._drag.onPointerDown(ev, item, day);
  }

  onOpenDay(day: string): void {
    if (this.drag()?.active) {
      return;
    }
    this.openDay.emit(day);
  }

  onItemKeydown(ev: KeyboardEvent, item: CalendarDayItem, day: string): void {
    if (!ev.altKey || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) {
      return;
    }
    ev.preventDefault();
    this._drag.nudgeByKeyboard(item, day, ev.key === 'ArrowRight' ? 1 : -1);
  }
}
