// Константи правої панелі-календаря.

import { CalendarTimeStep } from './calendar-panel.model';

/** Ширина розгорнутої панелі разом зі смугою-міткою, px. */
export const CALENDAR_PANEL_WIDTH_PX = 340;
/** Ширина згорнутої смуги-мітки, px. */
export const CALENDAR_PANEL_RAIL_WIDTH_PX = 36;
/** Вужчим за це центр (список задач) не стає: інакше календар лише поверх списку. */
export const CALENDAR_PANEL_MIN_CENTRE_PX = 480;
/** Без вибору користувача панель розгорнута лише на широкому вікні. */
export const CALENDAR_PANEL_DEFAULT_EXPANDED_MEDIA = '(min-width: 1280px)';

/** Доступні кроки шкали дня. */
export const CALENDAR_TIME_STEPS: readonly CalendarTimeStep[] = [5, 10, 15, 30, 60];
/** Типовий крок, якщо користувач ще не обирав. */
export const CALENDAR_DEFAULT_TIME_STEP: CalendarTimeStep = 30;
/** Висота однієї години на шкалі, px. */
export const CALENDAR_DAY_PX_PER_HOUR = 52;
/** Ліва смуга під підписи годин, щоб блоки їх не перекривали. */
export const CALENDAR_DAY_LABEL_GUTTER_PX = 44;
/** Мінімальна видима тривалість блоку без timeEstimate (30 хв). */
export const CALENDAR_DAY_DEFAULT_BLOCK_MS = 30 * 60 * 1000;
export const CALENDAR_DAY_MS = 24 * 60 * 60 * 1000;
export const CALENDAR_DAY_HEIGHT_PX = 24 * CALENDAR_DAY_PX_PER_HOUR;
