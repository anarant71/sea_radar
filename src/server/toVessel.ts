/**
 * Преобразование одного сообщения `PositionReport` в структуру судна.
 *
 * Написано по сохранённому образцу `data/samples/position-report.sample.json`,
 * а не по документации: регистр полей и вложенность взяты из файла. В образце
 * координаты лежат на двух уровнях и пишутся по-разному — `MetaData.latitude`
 * строчными и округлённые до пяти знаков, `Message.PositionReport.Latitude`
 * с заглавной и полной точности. Берётся второе, как записано в SPRINT-02.
 *
 * Сообщение приходит из сети, поэтому на входе `unknown`: ни одно поле не
 * считается существующим, пока не проверено. Негодное сообщение судна не
 * создаёт — возвращается `null`, и вызывающий просто идёт дальше. Судно с
 * координатами 0,0 не появляется: значений по умолчанию здесь нет вовсе.
 *
 * Накопление набора сюда не входит — это B-12. Функция знает ровно одно
 * сообщение и ничего не помнит между вызовами.
 */

import type { Vessel } from "@/vessel";
import { toVesselName } from "@/vessel";

/** Поле объекта, если на этом месте вообще объект. */
function field(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }

  return (source as Record<string, unknown>)[key];
}

/**
 * Число из сообщения. Строка с числом внутри числом не считается: задание
 * называет координату строкой невалидной, и поблажек для остальных полей тоже
 * нет. NaN и бесконечности отсеиваются здесь же — сравнения с ними ложны, и
 * дальше по коду они прошли бы проверку диапазона молча.
 */
function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Координата в пределах `limit` по модулю: 90 для широты, 180 для долготы.
 *
 * Значения «недоступно» — 91 и 181 — отдельной проверки не требуют: они и так
 * за границей. Отдельная строка для них лишь повторяла бы диапазон.
 */
function toCoordinate(value: unknown, limit: number): number | null {
  const number = asNumber(value);
  if (number === null || number < -limit || number > limit) {
    return null;
  }

  return number;
}

/**
 * Скорость в узлах. Диапазон [0, 102.2] закрыт с обеих сторон; 102.3 —
 * «скорость недоступна», и оно же первое значение за верхней границей.
 *
 * Ноль возвращается нулём: судно стоит, и это известное значение, а не его
 * отсутствие. Карточка покажет «0 уз», а не «Нет данных».
 */
function toSpeedKnots(value: unknown): number | null {
  const number = asNumber(value);
  if (number === null || number < 0 || number > 102.2) {
    return null;
  }

  return number;
}

/**
 * Курс движения в градусах. Диапазон [0, 360) сверху открыт: 360° — это тот же
 * 0°, и именно этим значением AIS передаёт «курс недоступен».
 */
function toCourseDeg(value: unknown): number | null {
  const number = asNumber(value);
  if (number === null || number < 0 || number >= 360) {
    return null;
  }

  return number;
}

/**
 * Идентификатор судна из `MetaData.MMSI`. В образце поле приходит числом
 * (`538002013`), в структуре судна `id` — строка, поэтому число переводится в
 * строку. Строка на этом месте тоже принимается: пустая и из одних пробелов —
 * это отсутствие MMSI, а не идентификатор.
 */
function toVesselId(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }

  return null;
}

/**
 * Время сообщения. `MetaData.time_utc` — не ISO 8601: в образце это
 * `2026-09-17 17:32:03.718165747 +0000 UTC`, то есть стандартный Go-рендер
 * времени — пробел вместо `T`, смещение без двоеточия и название зоны в конце.
 * `new Date()` такую строку не разбирает и даёт Invalid Date.
 *
 * Дробная часть переменной длины: здесь девять знаков (наносекунды), в примере
 * документации — шесть. Поэтому её длина не фиксируется, а лишние знаки
 * отбрасываются — в структуре судна время хранится с миллисекундами.
 */
const TIME_UTC =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))? ([+-]\d{2})(\d{2})(?: \S+)?$/;

function toTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const parts = TIME_UTC.exec(value.trim());
  if (parts === null) {
    return null;
  }

  const [, date, time, fraction, offsetHours, offsetMinutes] = parts;

  // Наносекунды не округляются, а обрезаются: девятый знак на миллисекунду не
  // влияет, а округление сдвинуло бы отметку, по которой в B-12 выбирается
  // самая новая позиция судна.
  const milliseconds = (fraction ?? "").padEnd(3, "0").slice(0, 3);

  const parsed = new Date(
    `${date}T${time}.${milliseconds}${offsetHours}:${offsetMinutes}`,
  );

  // Шаблон пропускает несуществующие даты вроде 2026-13-40 — их ловит уже сам
  // разбор.
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

/**
 * Сообщение → судно, либо `null`, если позиции в сообщении нет.
 *
 * Позиция принимается только при годных координатах, непустом MMSI и
 * разобранном времени. Скорость и курс на это не влияют: судно без известной
 * скорости — это судно, у которого неизвестна скорость, а не отсутствующее
 * судно, и в карточке оно покажет «Нет данных».
 *
 * Локальная проверка `MessageType` не выполняется. Подписка просит источник
 * присылать `PositionReport`, а кадр без пригодной позиции преобразуется в
 * `null`.
 */
export function toVessel(raw: unknown): Vessel | null {
  const meta = field(raw, "MetaData");
  const report = field(field(raw, "Message"), "PositionReport");

  const id = toVesselId(field(meta, "MMSI"));
  const lat = toCoordinate(field(report, "Latitude"), 90);
  const lon = toCoordinate(field(report, "Longitude"), 180);
  const timestamp = toTimestamp(field(meta, "time_utc"));

  if (id === null || lat === null || lon === null || timestamp === null) {
    return null;
  }

  // Название добито пробелами до двадцати символов (`"BERN                "`),
  // поэтому края обрезаются; пустое название — это его отсутствие, и его
  // превращает в `null` общая с демонстрацией `toVesselName`.
  const shipName = field(meta, "ShipName");
  const name =
    typeof shipName === "string" ? toVesselName(shipName.trim()) : null;

  return {
    id,
    name,
    lat,
    lon,
    speedKnots: toSpeedKnots(field(report, "Sog")),
    courseDeg: toCourseDeg(field(report, "Cog")),
    timestamp,
    source: "aisstream",
  };
}
