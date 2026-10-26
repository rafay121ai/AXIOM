import { createSaveQueue, HttpError } from '../src/api/queue';
import type { Answer, Screened } from '../src/api/types';

const retryDelay = () => 1000;
const a = (value: string): Answer => ({ value });

describe('save queue', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sends a save straight away and returns what the server said', async () => {
    const care: Screened = { care: 'unclear', reply: 'hm' };
    const send = jest.fn().mockResolvedValue(care);
    const q = createSaveQueue({ send, retryDelay });
    await expect(q.save('stage', a('x'))).resolves.toBe(care);
    expect(send).toHaveBeenCalledWith('stage', a('x'));
  });

  it('keeps a failed save and retries until it goes through', async () => {
    const send = jest.fn().mockRejectedValueOnce(new HttpError()).mockRejectedValueOnce(new HttpError(503)).mockResolvedValue({});
    const q = createSaveQueue({ send, retryDelay });
    const done = q.save('stage', a('x'));
    await jest.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toEqual({});
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('saves answers in the order they were given, even after an outage', async () => {
    const order: string[] = [];
    let down = true;
    const send = jest.fn(async (key: string) => {
      if (down) throw new HttpError();
      order.push(key);
      return {};
    });
    const q = createSaveQueue({ send, retryDelay });
    const all = Promise.all([q.save('one', a('1')), q.save('two', a('2')), q.save('three', a('3'))]);
    await jest.advanceTimersByTimeAsync(0);
    down = false;
    await jest.advanceTimersByTimeAsync(1000);
    await all;
    expect(order).toEqual(['one', 'two', 'three']);
  });

  it('replaces an answer still waiting with a newer one to the same question', async () => {
    let down = true;
    const send = jest.fn(async () => {
      if (down) throw new HttpError();
      return {};
    });
    const q = createSaveQueue({ send, retryDelay });
    const first = q.save('stage', a('old'));
    await jest.advanceTimersByTimeAsync(0);
    const second = q.save('stage', a('new'));
    down = false;
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.all([first, second]);
    expect(send).toHaveBeenLastCalledWith('stage', a('new'));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('drops an answer the server refuses and carries on with the rest', async () => {
    const send = jest.fn(async (key: string) => {
      if (key === 'bad') throw new HttpError(400);
      return {};
    });
    const q = createSaveQueue({ send, retryDelay });
    const bad = q.save('bad', a('x'));
    const good = q.save('good', a('y'));
    await expect(bad).rejects.toBeInstanceOf(HttpError);
    await expect(good).resolves.toEqual({});
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('drain waits until everything has been saved', async () => {
    let down = true;
    const send = jest.fn(async () => {
      if (down) throw new HttpError();
      return {};
    });
    const q = createSaveQueue({ send, retryDelay });
    void q.save('stage', a('x'));
    let drained = false;
    const d = q.drain().then(() => { drained = true; });
    await jest.advanceTimersByTimeAsync(0);
    expect(drained).toBe(false);
    down = false;
    await jest.advanceTimersByTimeAsync(1000);
    await d;
    expect(drained).toBe(true);
  });
});
