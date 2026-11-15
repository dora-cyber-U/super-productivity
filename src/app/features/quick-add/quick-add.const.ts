// Таймінги швидкого додавання задач (quick-add).
// Підібрані так, щоб одна задача давала 1 Create-оп і кілька Update-опів,
// а не окремий оп на кожну натиснуту клавішу.

/** Пауза в наборі, після якої чернетка стає справжньою задачею (1 Create-оп). */
export const QUICK_ADD_CREATE_IDLE_MS = 700;

/** Debounce збереження назви вже створеної задачі (1 Update-оп на паузу). */
export const QUICK_ADD_UPDATE_IDLE_MS = 1000;

/** Максимальне очікування збереження при безперервному наборі. */
export const QUICK_ADD_UPDATE_MAX_WAIT_MS = 4000;

/** Скільки «озброєний» одним кліком стан чекає на перший символ. */
export const QUICK_ADD_ARM_TIMEOUT_MS = 8000;

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
