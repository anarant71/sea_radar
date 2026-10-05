/**
 * Снимок на стороне браузера: форма ответа `/api/snapshot`, разбор ответа и
 * тексты панели.
 *
 * Тексты — часть контракта с заказчиком и с будущими тестами, поэтому собраны
 * здесь литералами и в разметке не повторяются. Числа в подписи (15 с, лимит
 * 100) берутся из ответа и из конфигурации, а не пишутся в строку руками: иначе
 * при смене константы подпись врала бы.
 *
 * Ключ сюда не попадает и попасть не может: модуль знает только тело ответа,
 * а в нём ключа нет.
 */

import { SNAPSHOT_VESSEL_LIMIT } from "@/config";
import { messageFor } from "@/server/snapshotError";
import type { Vessel } from "@/vessel";
import { formatSource, formatTimestamp } from "@/vessel";

/**
 * Тело ответа маршрута. Успех и ошибка различаются полем `ok` — так же, как их
 * различает сервер.
 */
export type SnapshotResponse =
  | {
      readonly ok: true;
      readonly vessels: readonly Vessel[];
      readonly collectedAt: string;
      readonly windowSeconds: number;
      readonly count: number;
      readonly truncated: boolean;
      readonly reason: "window_elapsed" | "limit_reached";
    }
  | {
      readonly ok: false;
      readonly attemptedAt: string;
      readonly error: { readonly code: string; readonly message: string };
    };

/**
 * Что показано на экране. Пустой ответ отдельным состоянием не выделен: это тот
 * же успех с нулём судов, и подпись у него та же — разное только сообщение под
 * ней. Разводить их в два состояния значило бы дублировать сборку подписи.
 */
export type Screen =
  | { readonly kind: "idle-demo" }
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly snapshot: Extract<SnapshotResponse, { ok: true }> }
  | { readonly kind: "error"; readonly message: string };

/** Сообщение под подписью, когда за срок сбора не пришло ни одного судна. */
const EMPTY_MESSAGE = "За время сбора позиции не получены";

/** Начало сообщения об ошибке; дальше идёт текст из тела ответа. */
const ERROR_PREFIX = "Не удалось получить данные: ";

/** Подпись источника, когда на карте судов нет из-за ошибки. */
const ERROR_LABEL = "Данных на карте нет";

/** Подпись источника, пока идёт сбор. */
const LOADING_LABEL = "Загрузка…";

/** Надпись на кнопке. */
export const LOAD_BUTTON_TEXT = "Загрузить настоящие позиции";

/**
 * Подпись источника для загруженного снимка.
 *
 * «Выборка неполная» стоит всегда, а не только при обрыве по лимиту: за
 * пятнадцать секунд в снимок попадают только суда, успевшие передать позицию, —
 * это не все суда района ни при каком исходе. Отдельная приписка про лимит
 * добавляется сверху, когда сбор оборвался на сотне.
 */
export function snapshotLabel(
  snapshot: Extract<SnapshotResponse, { ok: true }>,
): string {
  const base =
    `${formatSource("aisstream")} · снимок за ${snapshot.windowSeconds} с` +
    ` · получен ${formatTimestamp(snapshot.collectedAt)}` +
    ` · судов: ${snapshot.count} · выборка неполная`;

  return snapshot.truncated
    ? `${base} · остановлено на лимите ${SNAPSHOT_VESSEL_LIMIT}`
    : base;
}

/** Подпись источника для любого состояния экрана. */
export function screenLabel(screen: Screen, demoLabel: string): string {
  switch (screen.kind) {
    case "idle-demo":
      return demoLabel;
    case "loading":
      return LOADING_LABEL;
    case "loaded":
      return snapshotLabel(screen.snapshot);
    case "error":
      return ERROR_LABEL;
  }
}

/**
 * Сообщение под подписью, если оно есть. У демонстрации и непустого снимка его
 * нет — там говорит сама подпись.
 */
export function screenMessage(screen: Screen): string | null {
  if (screen.kind === "error") {
    return `${ERROR_PREFIX}${screen.message}`;
  }

  if (screen.kind === "loaded" && screen.snapshot.count === 0) {
    return EMPTY_MESSAGE;
  }

  return null;
}

/**
 * Ответ маршрута → состояние экрана.
 *
 * Ошибочный ответ показывает `message` из тела: формулировку выбирает сервер,
 * интерфейс её не сочиняет и не дополняет. Тело без `ok` — случай, которого в
 * нашем контракте нет; он трактуется как внутренняя ошибка, а не как пустой
 * успех, чтобы сломанный ответ не выглядел как «судов нет».
 */
export function toScreen(body: unknown): Screen {
  if (typeof body !== "object" || body === null || !("ok" in body)) {
    return { kind: "error", message: messageFor("internal") };
  }

  const response = body as SnapshotResponse;

  return response.ok
    ? { kind: "loaded", snapshot: response }
    : { kind: "error", message: response.error.message };
}

/** Суда, которые показывает карта. Во всех состояниях, кроме снимка, их нет. */
export function screenVessels(screen: Screen): readonly Vessel[] {
  return screen.kind === "loaded" ? screen.snapshot.vessels : [];
}
