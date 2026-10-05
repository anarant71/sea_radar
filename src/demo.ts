/**
 * Демонстрационные суда: сборка структуры судна из маршрутов конфигурации.
 * Маршруты здесь не вычисляются и не достраиваются — точки берутся такими,
 * какими они записаны литералами в config.ts.
 */

import type { DemoRoute, RoutePoint } from "@/config";
import { DEMO_ROUTES, DEMO_START_TIME } from "@/config";
import type { Vessel } from "@/vessel";
import { toVesselName } from "@/vessel";

const DEG = Math.PI / 180;

/**
 * Начальный азимут отрезка по большому кругу: под каким курсом судно выходит
 * из точки `from`, чтобы прийти в `to`. На большом круге курс вдоль отрезка
 * меняется, поэтому «начальный» — не уточнение, а часть определения.
 *
 * Результат нормализуется в [0, 360): именно этот диапазон обещает поле
 * `courseDeg`, а atan2 возвращает значение в [-180, 180].
 */
export function bearingDeg(from: RoutePoint, to: RoutePoint): number {
  const fromLat = from.lat * DEG;
  const toLat = to.lat * DEG;
  const deltaLon = (to.lon - from.lon) * DEG;

  const y = Math.sin(deltaLon) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);

  const degrees = Math.atan2(y, x) / DEG;
  return (degrees + 360) % 360;
}

/**
 * Судно на точке `index` своего маршрута.
 *
 * Курс — азимут отрезка, которым судно пришло в эту точку: на старте отрезка
 * ещё нет, поэтому берётся направление к следующей точке; дальше — от
 * предыдущей точки к текущей. На последней точке курс тем самым сохраняет
 * последнее значение сам собой.
 *
 * Скорость на последней точке — `0`: судно пришло и стоит. Это именно ноль, а
 * не `null`, — значение известно, и карточка покажет «0 уз», а не «Нет данных».
 */
function vesselAt(demo: DemoRoute, index: number, timestamp: string): Vessel {
  const last = demo.route.length - 1;
  const point = demo.route[index];
  const arrived = index === last;

  const courseDeg =
    index === 0
      ? bearingDeg(point, demo.route[1])
      : bearingDeg(demo.route[index - 1], point);

  return {
    id: demo.id,
    name: toVesselName(demo.name),
    lat: point.lat,
    lon: point.lon,
    speedKnots: arrived ? 0 : demo.speedKnots,
    courseDeg,
    timestamp,
    source: "demo",
  };
}

/**
 * Состояние демонстрации: номер шага и суда на этом шаге. Суда хранятся
 * рядом с шагом, а не вычисляются при каждом рендере, чтобы пришедшее судно
 * можно было вернуть той же ссылкой — см. `stepDemo`.
 */
export type DemoState = {
  readonly step: number;
  readonly vessels: readonly Vessel[];
};

/** Шаг, на котором последнее судно приходит на свою конечную точку. */
const LAST_STEP = Math.max(...DEMO_ROUTES.map((demo) => demo.route.length - 1));

/** Начало демонстрации: все суда на первой точке своего маршрута. */
export function demoStart(timestamp: string = DEMO_START_TIME): DemoState {
  return {
    step: 0,
    vessels: DEMO_ROUTES.map((demo) => vesselAt(demo, 0, timestamp)),
  };
}

/**
 * Следующий шаг демонстрации. Время — момент этого тика, одно на все суда.
 *
 * Судно, уже пришедшее на последнюю точку, возвращается прежней ссылкой:
 * «дальше судно не меняется» относится и к его времени сообщения тоже. Иначе у
 * стоящего судна `timestamp` тикал бы каждые две секунды, хотя никакого нового
 * сообщения о нём не появлялось. Маршруты разной длины, поэтому суда приходят
 * на разных тиках, и каждое замирает на своём.
 *
 * Когда пришли все, возвращается прежнее состояние целиком, той же ссылкой:
 * React сравнивает состояние по ссылке и просто не перерисует экран, так что
 * дальнейшие тики становятся холостыми.
 */
export function stepDemo(current: DemoState, timestamp: string): DemoState {
  if (current.step >= LAST_STEP) {
    return current;
  }

  const step = current.step + 1;

  return {
    step,
    vessels: DEMO_ROUTES.map((demo, i) => {
      const last = demo.route.length - 1;
      // Судно уже стояло на конечной точке до этого тика — не трогаем его.
      // Тик, которым оно приходит (step === last), проходит обычным путём:
      // именно на нём скорость становится нулём.
      if (current.step >= last) {
        return current.vessels[i];
      }

      return vesselAt(demo, Math.min(step, last), timestamp);
    }),
  };
}
