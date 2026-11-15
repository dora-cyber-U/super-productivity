// Константи швидкого додавання задач (quick-add).

/** Скільки «озброєний» одним кліком стан чекає на перший символ. */
export const QUICK_ADD_ARM_TIMEOUT_MS = 8000;

/**
 * Ключ localStorage для незавершеної чернетки. Текст пишеться синхронно на
 * кожен символ, тож переживає вимкнення світла чи аварійне закриття програми.
 */
export const QUICK_ADD_DRAFT_LS_KEY = 'SUP_QUICK_ADD_DRAFT';

/**
 * Клік по цих елементах НЕ вважається кліком у порожнє місце:
 * задачі, елементи керування, заголовки та службові панелі
 * (прострочені, «пізніше сьогодні», виконані), оверлеї Material/CDK.
 */
export const QUICK_ADD_NON_EMPTY_SELECTOR = [
  'task',
  'quick-add-row',
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'label',
  '[contenteditable]',
  '[role="button"]',
  '[role="menuitem"]',
  'mat-icon',
  'header',
  'collapsible',
  '.collapsible-section',
  '.overdue-tasks',
  'planner-calendar-event',
  '.cdk-overlay-container',
  '.cdk-drag-preview',
].join(',');

/** Зсув вказівника між натисканням і відпусканням, після якого це вже не клік. */
export const QUICK_ADD_MAX_CLICK_MOVE_PX = 6;
