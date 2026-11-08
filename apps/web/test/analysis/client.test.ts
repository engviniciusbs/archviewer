import { describe, expect, it, vi } from 'vitest';
import { AnalysisClient, WorkerCrashedError, type WorkerLike } from '../../src/analysis/client';
import type { Request, WorkerMessage } from '../../src/analysis/protocol';

class FakeWorker implements WorkerLike {
  sent: Request[] = [];
  terminate = vi.fn();
  private listeners = new Map<string, Set<(e: Event) => void>>();
  postMessage = (msg: unknown) => {
    this.sent.push(msg as Request);
  };
  addEventListener = ((type: string, cb: (e: Event) => void) => {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }) as WorkerLike['addEventListener'];
  reply(res: WorkerMessage) {
    this.emit('message', new MessageEvent('message', { data: res }));
  }
  emit(type: string, ev: Event) {
    this.listeners.get(type)?.forEach((cb) => cb(ev));
  }
}

describe('AnalysisClient', () => {
  it('resolve respostas fora de ordem pelo id', async () => {
    const w = new FakeWorker();
    const c = new AnalysisClient(w);
    const p1 = c.find('a', 5);
    const p2 = c.detail(3);
    expect(w.sent.map((m) => m.method)).toEqual(['find', 'detail']);
    w.reply({ id: w.sent[1].id, ok: true, value: { kind: 'file' } });
    w.reply({ id: w.sent[0].id, ok: true, value: [] });
    await expect(p2).resolves.toEqual({ kind: 'file' });
    await expect(p1).resolves.toEqual([]);
  });

  it('ok:false rejeita com a mensagem', async () => {
    const w = new FakeWorker();
    const c = new AnalysisClient(w);
    const p = c.view([0]);
    w.reply({ id: w.sent[0].id, ok: false, error: 'sessão não iniciada' });
    await expect(p).rejects.toThrow('sessão não iniciada');
  });

  it('evento error rejeita pendentes e chama onCrash uma vez', async () => {
    const w = new FakeWorker();
    const c = new AnalysisClient(w);
    const cb = vi.fn();
    c.onCrash(cb);
    const p1 = c.finish();
    const p2 = c.view([0]);
    w.emit('error', new ErrorEvent('error', { message: 'boom' }));
    w.emit('error', new ErrorEvent('error', { message: 'boom' }));
    await expect(p1).rejects.toBeInstanceOf(WorkerCrashedError);
    await expect(p2).rejects.toBeInstanceOf(WorkerCrashedError);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toContain('o worker de análise parou');
  });

  it('frame fatal (WASM em pânico) rejeita pendentes com WorkerCrashedError e chama onCrash', async () => {
    const w = new FakeWorker();
    const c = new AnalysisClient(w);
    const cb = vi.fn();
    c.onCrash(cb);
    const p1 = c.detail(3);
    const p2 = c.find('a', 5);
    w.reply({ fatal: true, error: 'unreachable' });
    await expect(p1).rejects.toBeInstanceOf(WorkerCrashedError);
    await expect(p2).rejects.toBeInstanceOf(WorkerCrashedError);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toBe('o worker de análise parou: unreachable');
    await expect(c.view([0])).rejects.toBeInstanceOf(WorkerCrashedError);
  });

  it('onCrash devolve unsubscribe', () => {
    const w = new FakeWorker();
    const c = new AnalysisClient(w);
    const cb = vi.fn();
    c.onCrash(cb)();
    w.emit('messageerror', new Event('messageerror'));
    expect(cb).not.toHaveBeenCalled();
  });

  it('depois de dispose, chamadas rejeitam e terminate foi chamado', async () => {
    const w = new FakeWorker();
    const c = new AnalysisClient(w);
    const pending = c.ignoredDirs();
    c.dispose();
    expect(w.terminate).toHaveBeenCalled();
    await expect(pending).rejects.toThrow();
    await expect(c.start('x')).rejects.toThrow();
  });

  it('finish e start passam os argumentos certos', async () => {
    const w = new FakeWorker();
    const c = new AnalysisClient(w);
    void c.start('proj');
    expect(w.sent[0]).toMatchObject({ method: 'start', args: ['proj'] });
  });
});
