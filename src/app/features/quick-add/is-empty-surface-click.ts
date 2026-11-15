import {
  QUICK_ADD_MAX_CLICK_MOVE_PX,
  QUICK_ADD_NON_EMPTY_SELECTOR,
} from './quick-add.const';

export interface EmptySurfaceClickContext {
  /** Відстань між pointerdown і click, px. */
  movedPx: number;
  isMultiSelectActive: boolean;
  hasOpenDialog: boolean;
  /** Чи йде зараз перетягування задачі (CDK drag). */
  isDragging: boolean;
  /**
   * Для одинарного кліку виділений текст означає, що користувач виділяв,
   * а не клікав. Для подвійного браузер сам виділяє слово, тож не перевіряємо.
   */
  isCheckSelection: boolean;
}

/**
 * Чиста функція: чи є цей клік кліком у «порожнє місце» робочої області.
 * Без побічних ефектів — щоб легко покрити таблицею випадків.
 */
export const isEmptySurfaceClick = (
  ev: MouseEvent,
  ctx: EmptySurfaceClickContext,
): boolean => {
  const target = ev.target;
  if (!(target instanceof Element) || ev.button !== 0) {
    return false;
  }
  // Модифікатори зарезервовані за мультивибором і системними діями
  if (ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) {
    return false;
  }
  // Рух більше кількох пікселів — це скрол, виділення рамкою чи drag
  if (ctx.movedPx > QUICK_ADD_MAX_CLICK_MOVE_PX) {
    return false;
  }
  if (ctx.isMultiSelectActive || ctx.hasOpenDialog || ctx.isDragging) {
    return false;
  }
  if (ctx.isCheckSelection) {
    const selection = target.ownerDocument.getSelection();
    if (selection && !selection.isCollapsed) {
      return false;
    }
  }
  return !target.closest(QUICK_ADD_NON_EMPTY_SELECTOR);
};
