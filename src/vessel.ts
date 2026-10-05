/**
 * Одна структура судна — общая для демонстрационных и настоящих данных.
 * Полей ровно столько, сколько согласовано в SPRINT-01.
 */

/** Откуда пришло сообщение о судне. */
export type VesselSource = "demo" | "aisstream";

export type Vessel = {
  readonly id: string;

  /**
   * Название приходит от экипажа: может отсутствовать и может содержать что
   * угодно. Показывается только как текст, никогда как HTML.
   */
  readonly name: string | null;

  readonly lat: number;
  readonly lon: number;

  /**
   * Скорость и курс: `null` — значения нет в сообщении, и это не то же самое,
   * что `0`. Поэтому `| null`, а не `?` — компилятор заставит различить
   * «стоит» (`0`) и «неизвестно» (`null`) в каждом месте, где значение читают.
   * Курс движения (не направление носа) в диапазоне [0, 360).
   */
  readonly speedKnots: number | null;
  readonly courseDeg: number | null;

  /** Время сообщения: ISO 8601 с зоной. */
  readonly timestamp: string;

  readonly source: VesselSource;
};

/**
 * Название судна из сообщения. Пустая строка — это не название, а его
 * отсутствие, поэтому превращается в `null`.
 */
export function toVesselName(raw: string): string | null {
  return raw === "" ? null : raw;
}

/** Текст вместо любого неизвестного значения. */
export const NO_DATA = "Нет данных";

/** Подписи источников для карточки. */
const SOURCE_TEXT: Record<VesselSource, string> = {
  demo: "Демонстрационные данные",
  aisstream: "AISStream",
};

export function formatSource(source: VesselSource): string {
  return SOURCE_TEXT[source];
}

/** Координаты: ровно 5 знаков, хвостовые нули сохраняются. */
export function formatPosition(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/**
 * Скорость: до одной десятой, но без хвостового нуля — «12.3 уз», «12 уз»,
 * «0 уз». `0` — это стоящее судно, а не отсутствие данных, поэтому проверяется
 * именно `null`, а не ложность значения.
 */
export function formatSpeed(speedKnots: number | null): string {
  if (speedKnots === null) {
    return NO_DATA;
  }

  // Округление даёт максимум один знак; Number снимает хвостовой ноль
  // («12.0» → «12»), а целые значения оставляет как есть.
  const rounded = Number(speedKnots.toFixed(1));
  return `${rounded} уз`;
}

/** Курс: целые градусы в диапазоне [0, 360) со знаком градуса. */
export function formatCourse(courseDeg: number | null): string {
  if (courseDeg === null) {
    return NO_DATA;
  }

  // % 360 нужен из-за округления: 359.7 округляется в 360, а это тот же 0.
  return `${Math.round(courseDeg) % 360}°`;
}

/**
 * Время сообщения как «12:00:00 UTC». Время берётся в UTC, а не в зоне
 * браузера: сообщение о судне не зависит от того, где открыли страницу.
 * Нераспознанный timestamp — неизвестное значение, а не «Invalid Date».
 */
export function formatTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return NO_DATA;
  }

  const time = parsed.toISOString().slice(11, 19);
  return `${time} UTC`;
}

/** Название: отсутствующее — «Нет данных». Вывод только как текст. */
export function formatName(name: string | null): string {
  return name === null ? NO_DATA : name;
}
