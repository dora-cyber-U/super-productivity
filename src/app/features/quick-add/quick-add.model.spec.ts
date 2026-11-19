import { WorkContextType } from '../work-context/work-context.model';
import {
  QUICK_ADD_SURFACE_WORK_VIEW,
  resolveQuickAddSurface,
  StoredQuickAddDraft,
} from './quick-add.model';

const draft = (
  surface?: string,
): Pick<StoredQuickAddDraft, 'surface'> & { title: string } => ({
  title: 'x',
  ...(surface !== undefined ? { surface } : {}),
});

describe('resolveQuickAddSurface', () => {
  it('maps a legacy draft without surface to work-view (no migration)', () => {
    expect(resolveQuickAddSurface(undefined)).toBe(QUICK_ADD_SURFACE_WORK_VIEW);
    expect(resolveQuickAddSurface(null)).toBe(QUICK_ADD_SURFACE_WORK_VIEW);
    expect(resolveQuickAddSurface(draft())).toBe(QUICK_ADD_SURFACE_WORK_VIEW);
  });

  it('keeps an explicit work-view surface', () => {
    expect(resolveQuickAddSurface(draft(QUICK_ADD_SURFACE_WORK_VIEW))).toBe(
      QUICK_ADD_SURFACE_WORK_VIEW,
    );
  });

  it('treats an empty surface as work-view', () => {
    expect(resolveQuickAddSurface(draft(''))).toBe(QUICK_ADD_SURFACE_WORK_VIEW);
  });
});

describe('StoredQuickAddDraft surface is optional', () => {
  it('a v2 draft without surface is still a valid leftover shape', () => {
    const leftover: StoredQuickAddDraft = {
      v: 2,
      id: 'old-1',
      ts: 1,
      title: 'Купити фарбу',
      target: {
        workContextId: 'projectA',
        workContextType: WorkContextType.PROJECT,
        parentId: null,
      },
    };
    expect(resolveQuickAddSurface(leftover)).toBe(QUICK_ADD_SURFACE_WORK_VIEW);
  });
});
