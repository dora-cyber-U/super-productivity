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
  /** Ідентифікатор чернетки: щоб не стерти чужу і не відновити її двічі. */
  id: string;
  /** Час останньої зміни (мс): з двох сховищ відновлюємо новіший запис. */
  ts: number;
  title: string;
  target: QuickAddTarget;
}
