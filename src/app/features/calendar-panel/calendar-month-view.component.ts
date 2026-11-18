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
import { isSameMonth } from './calendar-period.util';
import { CalendarPeriodDrag } from './calendar-period-drag';
import { CalendarScheduleService } from './calendar-schedule.service';
import { shiftDayStr } from './calendar-day.util';

const MONTH_VISIBLE_ITEMS = 2;

export interface MonthCellView {
  day: string;
  dayNum: string;
  isToday: boolean;
  isOutside: boolean;
  visible: CalendarDayItem[];
  overflow: number;
  overlapIds: ReadonlySet<string>;
}

@Component({
  selector: 'calendar-month-view',
  templateUrl: './calendar-month-view.component.html',
  styleUrl: './calendar-month-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
})
export class CalendarMonthViewComponent {
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
  /** Якір місяця (будь-який день видимого місяця). */
  readonly monthDay = input.required<string>();
  readonly startOfNextDayDiffMs = input(0);
  readonly openDay = output<string>();

  readonly drag = this._drag.state;

  readonly weekdayLabels = computed(() => {
    const first = this.days()[0]?.day;
    if (!first) {
      return [];
    }
    const labels: string[] = [];
    for (let i = 0; i < 7; i++) {
      const day = shiftDayStr(first, i);
      labels.push(
        new Intl.DateTimeFormat(this._dt.textLocale(), { weekday: 'short' }).format(
          new Date(`${day}T12:00:00`),
        ),
      );
    }
    return labels;
  });

  readonly weeks = computed<MonthCellView[][]>(() => {
    const today = this.today();
    const monthDay = this.monthDay();
    const rows: MonthCellView[][] = [];
    const list = this.days();
    for (let i = 0; i < list.length; i += 7) {
      const slice = list.slice(i, i + 7);
      const row: MonthCellView[] = [];
      for (const view of slice) {
        const items = [...view.allDay, ...view.timed];
        const overflow =
          items.length > MONTH_VISIBLE_ITEMS ? items.length - MONTH_VISIBLE_ITEMS : 0;
        row.push({
          day: view.day,
          dayNum: String(Number(view.day.slice(8))),
          isToday: view.day === today,
          isOutside: !isSameMonth(view.day, monthDay),
          visible: items.slice(0, MONTH_VISIBLE_ITEMS),
          overflow,
          overlapIds: markOverlappingIds(view.timed),
        });
      }
      rows.push(row);
    }
    return rows;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this._drag.destroy());
  }

  timeLabel(item: CalendarDayItem): string {
    if (item.startMs == null) {
      return '';
    }
    return this._dt.formatTime(item.startMs);
  }

  itemAriaLabel(item: CalendarDayItem, overlaps: boolean): string {
    const time = this.timeLabel(item);
    const overlap = overlaps
      ? ` ${this._translate.instant(T.F.CALENDAR_PANEL.OVERLAP)}`
      : '';
    return time ? `${item.title}, ${time}${overlap}` : `${item.title}${overlap}`;
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
    ev.stopPropagation();
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
    const to = shiftDayStr(day, ev.key === 'ArrowRight' ? 1 : -1);
    this._schedule.moveItemToDay(
      item.id,
      day,
      to,
      this.startOfNextDayDiffMs(),
      item.startMs == null,
    );
  }
}
