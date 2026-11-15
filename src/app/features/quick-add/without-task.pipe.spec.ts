import { WithoutTaskPipe } from './without-task.pipe';

describe('WithoutTaskPipe', () => {
  const pipe = new WithoutTaskPipe();
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('returns the same array when there is nothing to hide', () => {
    expect(pipe.transform(list, null)).toBe(list);
  });

  it('removes only the hidden task', () => {
    expect(pipe.transform(list, 'b')).toEqual([{ id: 'a' }, { id: 'c' }]);
  });

  it('keeps the list intact when the id is not in it', () => {
    expect(pipe.transform(list, 'x')).toEqual(list);
  });
});
