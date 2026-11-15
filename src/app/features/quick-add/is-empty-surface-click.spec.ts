import { EmptySurfaceClickContext, isEmptySurfaceClick } from './is-empty-surface-click';

describe('isEmptySurfaceClick', () => {
  let root: HTMLElement;
  const okCtx: EmptySurfaceClickContext = {
    movedPx: 0,
    isMultiSelectActive: false,
    hasOpenDialog: false,
    isDragging: false,
    isCheckSelection: true,
  };

  const clickOn = (target: Element, init: MouseEventInit = {}): MouseEvent => {
    const ev = new MouseEvent('click', { bubbles: true, button: 0, ...init });
    Object.defineProperty(ev, 'target', { value: target });
    return ev;
  };

  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `
      <div class="surface">
        <div class="gap"></div>
        <task><span class="title">Task</span></task>
        <button><span class="btn-label">Add</span></button>
        <section class="overdue-tasks"><div class="inner"></div></section>
        <header><div class="status"></div></header>
        <quick-add-row><div class="row-inner"></div></quick-add-row>
      </div>`;
    document.body.appendChild(root);
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    root.remove();
  });

  const q = (sel: string): Element => root.querySelector(sel) as Element;

  it('accepts a plain click on empty space', () => {
    expect(isEmptySurfaceClick(clickOn(q('.gap')), okCtx)).toBeTrue();
    expect(isEmptySurfaceClick(clickOn(q('.surface')), okCtx)).toBeTrue();
  });

  it('rejects clicks inside tasks, controls, headers, side panels and the row itself', () => {
    for (const sel of ['.title', '.btn-label', '.inner', '.status', '.row-inner']) {
      expect(isEmptySurfaceClick(clickOn(q(sel)), okCtx))
        .withContext(sel)
        .toBeFalse();
    }
  });

  it('rejects non-primary buttons and modifier clicks (multi-select)', () => {
    const gap = q('.gap');
    expect(isEmptySurfaceClick(clickOn(gap, { button: 2 }), okCtx)).toBeFalse();
    for (const mod of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey']) {
      expect(isEmptySurfaceClick(clickOn(gap, { [mod]: true }), okCtx))
        .withContext(mod)
        .toBeFalse();
    }
  });

  it('rejects when the pointer moved (scroll, rubber band, drag)', () => {
    expect(isEmptySurfaceClick(clickOn(q('.gap')), { ...okCtx, movedPx: 6 })).toBeTrue();
    expect(isEmptySurfaceClick(clickOn(q('.gap')), { ...okCtx, movedPx: 7 })).toBeFalse();
  });

  it('rejects during multi-select, open dialogs and drag', () => {
    const gap = q('.gap');
    expect(
      isEmptySurfaceClick(clickOn(gap), { ...okCtx, isMultiSelectActive: true }),
    ).toBeFalse();
    expect(
      isEmptySurfaceClick(clickOn(gap), { ...okCtx, hasOpenDialog: true }),
    ).toBeFalse();
    expect(isEmptySurfaceClick(clickOn(gap), { ...okCtx, isDragging: true })).toBeFalse();
  });

  it('rejects a single click while text is selected, but not a double click', () => {
    const range = document.createRange();
    range.selectNodeContents(q('.title'));
    window.getSelection()?.addRange(range);

    expect(isEmptySurfaceClick(clickOn(q('.gap')), okCtx)).toBeFalse();
    expect(
      isEmptySurfaceClick(clickOn(q('.gap')), { ...okCtx, isCheckSelection: false }),
    ).toBeTrue();
  });
});
