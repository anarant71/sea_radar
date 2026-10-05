import { test, expect } from '@playwright/test';

import { toVessel } from '@/server/toVessel';
import sample from '../data/samples/position-report.sample.json';

/**
 * Тесты преобразователя (B-14). Вход — сохранённый образец и синтетические
 * варианты на его основе: вариант — копия образца с одной подменой, в имени
 * теста пометка «синтетический». Живым источником они не получены.
 *
 * Ожидаемые значения — литералы из SPRINT-03 и из самого образца, не вызов
 * преобразователя.
 */

type Message = {
  MetaData: Record<string, unknown>;
  Message: { PositionReport: Record<string, unknown> };
};

/** Синтетический вариант: глубокая копия образца, затем правка. */
function synthetic(edit: (message: Message) => void): unknown {
  const message = structuredClone(sample) as Message;
  edit(message);
  return message;
}

test('образец: корректное сообщение → судно с id, координатами, скоростью, курсом, временем', () => {
  expect(toVessel(sample)).toEqual({
    id: '538002013',
    name: 'BERN',
    lat: 51.03990833333333,
    lon: 1.4093266666666666,
    speedKnots: 8,
    courseDeg: 229.4,
    timestamp: '2026-09-17T17:32:03.718Z',
    source: 'aisstream',
  });
});

test.describe('синтетический: название', () => {
  test('отсутствует → null', () => {
    const vessel = toVessel(synthetic((m) => { delete m.MetaData.ShipName; }));
    expect(vessel).not.toBeNull();
    expect(vessel!.name).toBeNull();
  });

  test('из одних пробелов → null', () => {
    const vessel = toVessel(synthetic((m) => { m.MetaData.ShipName = '                    '; }));
    expect(vessel).not.toBeNull();
    expect(vessel!.name).toBeNull();
  });
});

test.describe('синтетический: скорость', () => {
  test('0 → 0', () => {
    const vessel = toVessel(synthetic((m) => { m.Message.PositionReport.Sog = 0; }));
    expect(vessel).not.toBeNull();
    expect(vessel!.speedKnots).toBe(0);
  });

  for (const [label, value] of [['102.3', 102.3], ['-1', -1]] as const) {
    test(`${label} → null`, () => {
      const vessel = toVessel(synthetic((m) => { m.Message.PositionReport.Sog = value; }));
      expect(vessel).not.toBeNull();
      expect(vessel!.speedKnots).toBeNull();
    });
  }

  test('поле отсутствует → null', () => {
    const vessel = toVessel(synthetic((m) => { delete m.Message.PositionReport.Sog; }));
    expect(vessel).not.toBeNull();
    expect(vessel!.speedKnots).toBeNull();
  });
});

test('синтетический: курс 360 → null', () => {
  const vessel = toVessel(synthetic((m) => { m.Message.PositionReport.Cog = 360; }));
  expect(vessel).not.toBeNull();
  expect(vessel!.courseDeg).toBeNull();
});

test.describe('синтетический: координаты → позиция отброшена', () => {
  const cases: ReadonlyArray<[string, string, unknown]> = [
    ['широта 91', 'Latitude', 91],
    ['долгота 181', 'Longitude', 181],
    ['широта 95', 'Latitude', 95],
    ['долгота -200', 'Longitude', -200],
    ['широта строкой', 'Latitude', '51.03990833333333'],
  ];

  for (const [label, key, value] of cases) {
    test(label, () => {
      // null, а не судно: значит, и судна с координатами 0,0 нет.
      expect(toVessel(synthetic((m) => { m.Message.PositionReport[key] = value; }))).toBeNull();
    });
  }
});

test.describe('синтетический: MMSI → позиция отброшена', () => {
  test('отсутствует', () => {
    expect(toVessel(synthetic((m) => { delete m.MetaData.MMSI; }))).toBeNull();
  });

  test('пустой', () => {
    expect(toVessel(synthetic((m) => { m.MetaData.MMSI = ''; }))).toBeNull();
  });
});

test('синтетический: непарсимое время → позиция отброшена', () => {
  expect(toVessel(synthetic((m) => { m.MetaData.time_utc = 'not a time'; }))).toBeNull();
});
