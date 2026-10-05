import { test, expect } from '@playwright/test';

import { collectSnapshot, createWebSocketTransport, type Clock, type CollectResult, type Transport } from '@/server/reader';
import sample from '../data/samples/position-report.sample.json';

/**
 * Тесты сборщика (B-15). Сеть не открывается, глобальные Date и таймеры не
 * подменяются: сборщику передаются тестовый источник и тестовые часы. Время
 * двигает только `clock.advance`, реальных ожиданий нет.
 *
 * Сообщения — синтетические варианты сохранённого образца. Ожидаемые значения —
 * литералы из SPRINT-03.
 */

const START = '2026-01-01T12:00:00.000Z';
const WINDOW_MS = 15_000;

/** Часы: время стоит, пока тест его не сдвинет; таймеры срабатывают по advance. */
function testClock() {
  let nowMs = Date.parse(START);
  let nextHandle = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();

  const clock: Clock = {
    now: () => new Date(nowMs),
    setTimer: (ms, callback) => {
      const handle = nextHandle++;
      timers.set(handle, { at: nowMs + ms, callback });
      return handle;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
  };

  return {
    clock,
    pendingTimers: () => timers.size,
    advance(ms: number) {
      nowMs += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= nowMs) {
          timers.delete(handle);
          timer.callback();
        }
      }
    },
  };
}

/** Источник: тест сам вызывает события, вызовы close и send считаются. */
function testTransport() {
  const handlers = {
    open: [] as Array<() => void>,
    message: [] as Array<(data: string) => void>,
    error: [] as Array<() => void>,
    close: [] as Array<() => void>,
  };
  const state = { closeCalls: 0, sent: [] as string[] };

  const transport: Transport = {
    send: (payload) => { state.sent.push(payload); },
    close: () => { state.closeCalls += 1; },
    onOpen: (h) => { handlers.open.push(h); },
    onMessage: (h) => { handlers.message.push(h); },
    onError: (h) => { handlers.error.push(h); },
    onClose: (h) => { handlers.close.push(h); },
  };

  return {
    transport,
    state,
    open: () => handlers.open.forEach((h) => h()),
    message: (m: unknown) => handlers.message.forEach((h) => h(JSON.stringify(m))),
    error: () => handlers.error.forEach((h) => h()),
    remoteClose: () => handlers.close.forEach((h) => h()),
  };
}

type Position = { lat: number; lon: number };

/** Синтетическое сообщение на основе образца: MMSI, время ISO, позиция, имя. */
function syntheticMessage(
  mmsi: number,
  isoTime: string,
  position: Position = { lat: 51.0, lon: 1.4 },
  name: string | null = 'BERN',
) {
  const m = structuredClone(sample) as {
    MetaData: Record<string, unknown>;
    Message: { PositionReport: Record<string, unknown> };
  };
  m.MetaData.MMSI = mmsi;
  // Формат источника: Go-рендер времени, не ISO.
  m.MetaData.time_utc = isoTime.replace('T', ' ').replace('Z', ' +0000 UTC');
  if (name === null) {
    delete m.MetaData.ShipName;
  } else {
    m.MetaData.ShipName = name;
  }
  m.Message.PositionReport.Latitude = position.lat;
  m.Message.PositionReport.Longitude = position.lon;
  return m;
}

/** Запуск сбора с отметкой «результат уже пришёл». */
function start(signal?: AbortSignal) {
  const time = testClock();
  const source = testTransport();
  let result: CollectResult | undefined;
  let settleCount = 0;
  const promise = collectSnapshot({
    apiKey: 'test-key',
    transport: source.transport,
    clock: time.clock,
    signal,
  }).then((r) => {
    result = r;
    settleCount += 1;
    return r;
  });

  return {
    time,
    source,
    promise,
    settled: async () => {
      // Дать отработать микрозадачам: промис резолвится синхронно из событий.
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
      return result;
    },
    settleCount: () => settleCount,
  };
}

function expectResourcesReleased(run: ReturnType<typeof start>) {
  expect(run.source.state.closeCalls).toBe(1);
  expect(run.time.pendingTimers()).toBe(0);
}

const A = 111111111;
const P1 = { lat: 51.01, lon: 1.41 };
const P2 = { lat: 51.02, lon: 1.42 };

test('синтетический: два одинаковых сообщения о судне A → один объект A', async () => {
  const run = start();
  run.source.open();
  const message = syntheticMessage(A, '2026-01-01T12:00:00Z', P1);
  run.source.message(message);
  run.source.message(message);
  run.time.advance(WINDOW_MS);

  const result = await run.promise;
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.vessels).toHaveLength(1);
  expect(result.vessels[0].id).toBe('111111111');
  expectResourcesReleased(run);
});

test('синтетический: A 12:01 с P2, затем A 12:00 с P1 → остаётся P2', async () => {
  const run = start();
  run.source.open();
  run.source.message(syntheticMessage(A, '2026-01-01T12:01:00Z', P2));
  run.source.message(syntheticMessage(A, '2026-01-01T12:00:00Z', P1));
  run.time.advance(WINDOW_MS);

  const result = await run.promise;
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.vessels).toHaveLength(1);
  expect(result.vessels[0]).toMatchObject({ lat: 51.02, lon: 1.42, timestamp: '2026-01-01T12:01:00.000Z' });
  expectResourcesReleased(run);
});

test('синтетический: A с одинаковой меткой и разными позициями → остаётся первая принятая', async () => {
  const run = start();
  run.source.open();
  run.source.message(syntheticMessage(A, '2026-01-01T12:00:00Z', P1));
  run.source.message(syntheticMessage(A, '2026-01-01T12:00:00Z', P2));
  run.time.advance(WINDOW_MS);

  const result = await run.promise;
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.vessels).toHaveLength(1);
  expect(result.vessels[0]).toMatchObject({ lat: 51.01, lon: 1.41 });
  expectResourcesReleased(run);
});

test('синтетический: 100 уникальных судов → limit_reached, truncated, 101-е не принято', async () => {
  const run = start();
  run.source.open();
  for (let i = 1; i <= 101; i += 1) {
    run.source.message(syntheticMessage(200000000 + i, '2026-01-01T12:00:00Z'));
  }

  const result = await run.settled();
  expect(result).toBeDefined();
  expect(result!.ok).toBe(true);
  if (!result!.ok) return;
  expect(result!.reason).toBe('limit_reached');
  expect(result!.truncated).toBe(true);
  expect(result!.vessels).toHaveLength(100);
  expect(result!.vessels.map((v) => v.id)).not.toContain('200000101');
  expectResourcesReleased(run);
});

test('синтетический: 100 сообщений об одном судне → одно судно, сбор идёт до конца окна', async () => {
  const run = start();
  run.source.open();
  for (let i = 0; i < 100; i += 1) {
    const second = String(i % 60).padStart(2, '0');
    const minute = String(Math.floor(i / 60)).padStart(2, '0');
    run.source.message(syntheticMessage(A, `2026-01-01T12:${minute}:${second}Z`));
  }

  // До конца окна результата нет.
  run.time.advance(WINDOW_MS - 1);
  expect(await run.settled()).toBeUndefined();

  run.time.advance(1);
  const result = await run.settled();
  expect(result).toBeDefined();
  expect(result!.ok).toBe(true);
  if (!result!.ok) return;
  expect(result!.vessels).toHaveLength(1);
  expect(result!.reason).toBe('window_elapsed');
  expect(result!.truncated).toBe(false);
  expectResourcesReleased(run);
});

test('окно истекло при живом соединении без сообщений → успех, count 0, window_elapsed', async () => {
  const run = start();
  run.source.open();
  run.time.advance(WINDOW_MS);

  const result = await run.promise;
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.vessels.length).toBe(0);
  expect(result.reason).toBe('window_elapsed');
  expectResourcesReleased(run);
});

test('соединение не открылось до конца срока → connect_failed', async () => {
  const run = start();
  run.time.advance(WINDOW_MS);

  const result = await run.promise;
  expect(result).toMatchObject({ ok: false, code: 'connect_failed' });
  expectResourcesReleased(run);
});

test('ошибка сокета до open → connect_failed немедленно, не по истечении срока', async () => {
  const run = start();
  run.source.error();

  // Время не двигалось.
  const result = await run.settled();
  expect(result).toMatchObject({ ok: false, code: 'connect_failed', attemptedAt: new Date(START) });
  expectResourcesReleased(run);
});

test('синтетический: ошибка провайдера после трёх валидных сообщений → provider_error без набора', async () => {
  const run = start();
  run.source.open();
  for (const mmsi of [301, 302, 303]) {
    run.source.message(syntheticMessage(300000000 + mmsi, '2026-01-01T12:00:00Z'));
  }
  run.source.error();

  const result = await run.settled();
  expect(result).toBeDefined();
  expect(result!.ok).toBe(false);
  expect(result).toMatchObject({ code: 'provider_error' });
  expect(result).not.toHaveProperty('vessels');
  expectResourcesReleased(run);
});

test('синтетический: разрыв после трёх валидных сообщений → disconnected без набора', async () => {
  const run = start();
  run.source.open();
  for (const mmsi of [301, 302, 303]) {
    run.source.message(syntheticMessage(300000000 + mmsi, '2026-01-01T12:00:00Z'));
  }
  run.source.remoteClose();

  const result = await run.settled();
  expect(result).toBeDefined();
  expect(result!.ok).toBe(false);
  expect(result).toMatchObject({ code: 'disconnected' });
  expect(result).not.toHaveProperty('vessels');
  expectResourcesReleased(run);
});

test('синтетический: ошибка провайдера после завершения по лимиту → успех остаётся, второго завершения нет', async () => {
  const run = start();
  run.source.open();
  for (let i = 1; i <= 100; i += 1) {
    run.source.message(syntheticMessage(200000000 + i, '2026-01-01T12:00:00Z'));
  }
  run.source.error();
  run.time.advance(WINDOW_MS);

  const result = await run.settled();
  expect(result).toMatchObject({ ok: true, reason: 'limit_reached' });
  expect(run.settleCount()).toBe(1);
  expectResourcesReleased(run);
});

test('отмена запроса до конца окна → результат не завершается, соединение закрыто, таймеры очищены', async () => {
  const controller = new AbortController();
  const run = start(controller.signal);
  run.source.open();
  run.time.advance(WINDOW_MS / 2);
  controller.abort();

  expect(await run.settled()).toBeUndefined();
  expectResourcesReleased(run);
});

test('синтетический: второе сообщение о судне A с именем null → имя null, объект заменён целиком', async () => {
  const run = start();
  run.source.open();
  run.source.message(syntheticMessage(A, '2026-01-01T12:00:00Z', P1, 'BERN'));
  run.source.message(syntheticMessage(A, '2026-01-01T12:01:00Z', P2, null));
  run.time.advance(WINDOW_MS);

  const result = await run.promise;
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.vessels).toHaveLength(1);
  expect(result.vessels[0].name).toBeNull();
  expectResourcesReleased(run);
});

test('ошибка чтения Blob после open → provider_error без unhandled rejection', async () => {
  const originalWebSocket = globalThis.WebSocket;
  const time = testClock();
  const socketRef: { current: FakeWebSocket | null } = { current: null };

  class FakeWebSocket extends EventTarget {
    closeCalls = 0;

    constructor(_url: string) {
      super();
      socketRef.current = this;
    }

    send(_payload: string) {}

    close() {
      this.closeCalls += 1;
    }
  }

  class RejectingBlob extends Blob {
    override text(): Promise<string> {
      return Promise.reject(new Error('decode failed'));
    }
  }

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  try {
    const transport = createWebSocketTransport();
    const promise = collectSnapshot({
      apiKey: 'test-key',
      transport,
      clock: time.clock,
    });
    const activeSocket = socketRef.current;
    if (activeSocket === null) {
      throw new Error('Fake WebSocket was not constructed');
    }

    activeSocket.dispatchEvent(new Event('open'));
    activeSocket.dispatchEvent(
      new MessageEvent('message', { data: new RejectingBlob([]) }),
    );

    const result = await promise;
    expect(result).toMatchObject({ ok: false, code: 'provider_error' });
    expect(activeSocket.closeCalls).toBe(1);
    expect(time.pendingTimers()).toBe(0);
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test('collectedAt равен времени переданных часов в момент завершения', async () => {
  const run = start();
  run.source.open();
  run.time.advance(WINDOW_MS);

  const result = await run.promise;
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.collectedAt.toISOString()).toBe('2026-01-01T12:00:15.000Z');
  expectResourcesReleased(run);
});
