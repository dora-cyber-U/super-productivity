import { WorkContextType } from '../work-context/work-context.model';

/** Куди створювати задачу. Фіксується в момент початку чернетки. */
export interface QuickAddTarget {
  workContextId: string;
  workContextType: WorkContextType;
  parentId: string | null;
}

/** Незавершена чернетка, як вона лежить у сховищі (IndexedDB / localStorage). */
export interface StoredQuickAddDraft {
  v: 2;
  /** id чернетки — він же id майбутньої задачі: так застарілу копію видно одразу. */
  id: string;
  /** Час останньої зміни (мс). */
  ts: number;
  /**
   * Монотонна ревізія запису (гібридний годинник: не менша за Date.now() і
   * завжди більша за попередню). Нею, а не ts, порівнюються копії в
   * localStorage і IndexedDB — зсув системного годинника порядок не ламає.
   * Записи без неї (старіші збірки) порівнюються за ts.
   */
  rev?: number;
  title: string;
  target: QuickAddTarget;
}

/**
 * «Надгробок» стертої чернетки в IndexedDB: новіший за будь-яку копію в
 * localStorage, тож застаріла копія після kill не відновлюється.
 */
export interface QuickAddDraftTombstone {
  v: 2;
  id: string;
  /** Коли чернетку стерли (мс). */
  ts: number;
  /** Див. StoredQuickAddDraft.rev. */
  rev?: number;
  cleared: true;
}
