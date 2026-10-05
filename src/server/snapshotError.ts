/**
 * Коды ошибок снимка и их тексты. Тексты — часть контракта с интерфейсом:
 * интерфейс показывает `message` как есть, поэтому формулировки заданы здесь
 * литералами и нигде больше не повторяются.
 *
 * Сырой текст ошибки провайдера или исключения в `message` не попадает: наружу
 * идёт только одна из этих пяти строк. Иначе в ответ могла бы просочиться
 * внутренняя подробность, вплоть до подставленного в URL ключа.
 */

export type SnapshotErrorCode =
  | "no_api_key"
  | "connect_failed"
  | "provider_error"
  | "disconnected"
  | "internal";

const MESSAGES: Record<SnapshotErrorCode, string> = {
  no_api_key: "Ключ AISStream не настроен",
  connect_failed: "Не удалось подключиться к источнику",
  provider_error: "Источник вернул ошибку",
  disconnected: "Соединение с источником разорвано",
  internal: "Внутренняя ошибка сервера",
};

export function messageFor(code: SnapshotErrorCode): string {
  return MESSAGES[code];
}
