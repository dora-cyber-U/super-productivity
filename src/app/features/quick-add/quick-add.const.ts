// Константи швидкого додавання задач (quick-add).

/** Скільки «озброєний» одним кліком стан чекає на перший символ. */
export const QUICK_ADD_ARM_TIMEOUT_MS = 8000;

/**
 * Окрема маленька база IndexedDB для незавершеної чернетки — не SUP_OPS і не
 * op-log: чернетка локальна для пристрою, не синхронізується і не потрапляє
 * в бекапи. На відміну від localStorage, який Chromium скидає на диск із
 * затримкою до хвилини, запис IndexedDB переживає kill процесу.
 */
export const QUICK_ADD_DRAFT_DB_NAME = 'SUP_QUICK_ADD';

/**
 * Як часто (не частіше) писати чернетку в IndexedDB під час набору.
 * Останній стан завжди дописується (trailing), а blur / приховування
 * вкладки / закриття сторінки пишуть одразу.
 */
export const QUICK_ADD_DRAFT_WRITE_INTERVAL_MS = 200;

/**
 * Скільки операція з чернеткою чекає на відкриття бази. Якщо інше з'єднання
 * не відпускає стару версію (upgrade заблоковано), далі працює localStorage,
 * а запис в IndexedDB повторюється з цим же інтервалом, поки база не звільниться.
 */
export const QUICK_ADD_DRAFT_DB_OPEN_TIMEOUT_MS = 2000;

/**
 * Ключ localStorage — синхронна копія чернетки. Страхує reload і закриття
 * вкладки в межах інтервалу запису в IndexedDB.
 */
export const QUICK_ADD_DRAFT_LS_KEY = 'SUP_QUICK_ADD_DRAFT';

/** Web Lock, під яким вкладки по черзі відновлюють чернетку — без дублів. */
export const QUICK_ADD_RESTORE_LOCK = 'SUP_QUICK_ADD_RESTORE';

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
