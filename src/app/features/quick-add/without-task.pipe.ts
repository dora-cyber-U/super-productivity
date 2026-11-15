import { Pipe, PipeTransform } from '@angular/core';

/**
 * Прибирає зі списку задачу з вказаним id. Використовується, щоб задача,
 * яку вже створено автозбереженням, не дублювала рядок вводу, поки її назва
 * ще набирається (QuickAddDraftService.hiddenTaskId). Селектори store не змінюємо.
 */
@Pipe({ name: 'withoutTask' })
export class WithoutTaskPipe implements PipeTransform {
  transform<T extends { id: string }>(list: T[], id: string | null): T[] {
    return id ? list.filter((item) => item.id !== id) : list;
  }
}
