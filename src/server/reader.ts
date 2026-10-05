/**
 * Сбор снимка позиций из AISStream.
 *
 * Модуль сетевого кода не содержит и часов не вызывает: соединение и время
 * приходят параметрами. Из-за этого сборщик можно проверить заготовленными
 * сообщениями и управляемым временем, не открывая сокет и не имея ключа.
 *
 * Разбор полей сюда не входит — сообщение превращает в судно `toVessel`.
 * Здесь только накопление набора и правила завершения.
 */

import {
  AISSTREAM_URL,
  SNAPSHOT_VESSEL_LIMIT,
  SNAPSHOT_WINDOW_SECONDS,
  SUBSCRIPTION_BOUNDING_BOXES,
} from "@/config";
import type { SnapshotErrorCode } from "@/server/snapshotError";
import { toVessel } from "@/server/toVessel";
import type { Vessel } from "@/vessel";

/**
 * Соединение с источником — ровно то, чем пользуется сборщик. Боевая
 * реализация оборачивает WebSocket, тестовая просто вызывает обработчики.
 */
export type Transport = {
  readonly send: (payload: string) => void;
  readonly close: () => void;
  readonly onOpen: (handler: () => void) => void;
  /** Сообщение приходит строкой: декодирование кадра — забота реализации. */
  readonly onMessage: (handler: (data: string) => void) => void;
  readonly onError: (handler: () => void) => void;
  readonly onClose: (handler: () => void) => void;
};

/** Часы: отметка времени и таймер срока. */
export type Clock = {
  readonly now: () => Date;
  readonly setTimer: (ms: number, callback: () => void) => unknown;
  readonly clearTimer: (handle: unknown) => void;
};

/**
 * Почему сбор закончился. Оба значения — успех: окно истекло при живом
 * соединении либо набрался предел. Неуспешные исходы сюда не попадают, у них
 * код ошибки.
 */
export type CollectReason = "window_elapsed" | "limit_reached";

/** Исход сбора: набор судов либо код ошибки. */
export type CollectResult =
  | {
      readonly ok: true;
      readonly vessels: readonly Vessel[];
      readonly collectedAt: Date;
      readonly reason: CollectReason;
      /** Набор оборван пределом: в районе есть суда, которых здесь нет. */
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly code: SnapshotErrorCode; readonly attemptedAt: Date };

export type CollectOptions = {
  readonly apiKey: string;
  readonly transport: Transport;
  readonly clock: Clock;
  /** Отмена запроса клиентом: освобождает ресурсы, результат не отдаётся. */
  readonly signal?: AbortSignal;
};

/** Подписка на район. Ключ входит сюда и больше никуда не копируется. */
function subscriptionPayload(apiKey: string): string {
  return JSON.stringify({
    APIKey: apiKey,
    BoundingBoxes: SUBSCRIPTION_BOUNDING_BOXES,
    FilterMessageTypes: ["PositionReport"],
  });
}

/**
 * Снимок позиций за срок сбора либо ошибка.
 *
 * Срок отсчитывается от входа в функцию, а не от открытия соединения: по
 * заданию в 15 секунд входят и соединение, и отправка подписки.
 *
 * Набор живёт внутри одного вызова и наружу не переживает: между запросами
 * ничего не хранится и не накапливается.
 */
export function collectSnapshot(options: CollectOptions): Promise<CollectResult> {
  const { apiKey, transport, clock, signal } = options;

  return new Promise<CollectResult>((resolve) => {
    // Состояние соединения. `subscribed` отделяет «не смогли подключиться» от
    // «подключились и потеряли связь»: это разные коды ошибки в задании.
    let subscribed = false;

    // Результат отдаётся ровно один раз. Поздние события — сообщение после
    // предела, закрытие после конца окна — уже ничего не меняют.
    let settled = false;
    let timer: unknown = null;

    /**
     * Набор: одна позиция на судно. Ключ — `id` из MMSI, поэтому сто сообщений
     * об одном судне дают одну запись, а предел считает суда, а не сообщения.
     *
     * Рядом с судном лежит его время в миллисекундах — то же, что в
     * `timestamp`, но числом. Хранится, а не разбирается заново при каждом
     * сравнении: сравнение идёт на каждое входящее сообщение.
     */
    const byId = new Map<string, { vessel: Vessel; timeMs: number }>();

    /**
     * Освобождение ресурсов: таймер, подписка на отмену, соединение. Вызывается
     * из `finish` и из отмены — других путей закрыть сбор нет, поэтому
     * «закрыть ресурсы во всех исходах» выполняется само.
     */
    const release = () => {
      settled = true;

      if (timer !== null) {
        clock.clearTimer(timer);
        timer = null;
      }

      signal?.removeEventListener("abort", onAbort);

      // Закрытие соединения не должно помешать вернуть уже готовый результат.
      try {
        transport.close();
      } catch {
        // Источник мог отвалиться раньше — для ответа это ничего не меняет.
      }
    };

    /** Единственный выход с результатом: ресурсы снимаются до его отдачи. */
    const finish = (result: CollectResult) => {
      if (settled) {
        return;
      }
      release();
      resolve(result);
    };

    /**
     * Успешное завершение. Собранный набор отдаётся только отсюда: ошибка,
     * разрыв идут через `fail`, отмена — через `release`, и частичный набор
     * не возвращают.
     */
    const succeed = (reason: CollectReason) => {
      finish({
        ok: true,
        vessels: [...byId.values()].map((entry) => entry.vessel),
        collectedAt: clock.now(),
        reason,
        truncated: reason === "limit_reached",
      });
    };

    const fail = (code: SnapshotErrorCode) => {
      finish({ ok: false, code, attemptedAt: clock.now() });
    };

    function onAbort() {
      // Ответ никто не ждёт: результат не отдаётся, только закрываются сокет
      // и таймер. Поздние события отсекает `settled`.
      if (!settled) {
        release();
      }
    }

    if (signal !== undefined) {
      if (signal.aborted) {
        release();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    // Срок ставится до соединения: время на подключение входит в те же 15 с.
    timer = clock.setTimer(SNAPSHOT_WINDOW_SECONDS * 1000, () => {
      // Соединение открылось и подписка ушла — это успех, даже если судов ноль:
      // их могло не быть в районе, и это не ошибка.
      if (subscribed) {
        succeed("window_elapsed");
        return;
      }

      // Срок кончился, а подключиться так и не вышло.
      fail("connect_failed");
    });

    transport.onOpen(() => {
      // Подписка уходит сразу после открытия: AISStream даёт на неё несколько
      // секунд и закрывает соединение, если её нет.
      try {
        transport.send(subscriptionPayload(apiKey));
        subscribed = true;
      } catch {
        // Отправить подписку не удалось — значит, соединения фактически нет.
        fail("connect_failed");
      }
    });

    transport.onMessage((data) => {
      // Сообщение после завершения набор не меняет. Проверка стоит и здесь, а
      // не только в `finish`: иначе поздний кадр успел бы записаться в `byId`
      // между завершением и закрытием сокета.
      if (settled) {
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        // Источник прислал не JSON — это ошибка на его стороне.
        fail("provider_error");
        return;
      }

      // Служебные кадры (подтверждение подписки) и сообщения без валидной
      // позиции судна не создают: `toVessel` возвращает `null`, и мы просто
      // ждём дальше. Это не ошибка — источник вправе прислать что угодно.
      const vessel = toVessel(parsed);
      if (vessel === null) {
        return;
      }

      // Время сообщения, а не порядок прихода: сообщения могут прийти не в том
      // порядке, в каком составлены. Точность — миллисекунда: `timestamp`
      // собран `toVessel` с обрезкой наносекунд, и разбор здесь точный.
      const timeMs = Date.parse(vessel.timestamp);

      const known = byId.get(vessel.id);
      if (known !== undefined && timeMs <= known.timeMs) {
        // Метка не новее известной — остаётся принятая первой. Строгое «>»
        // ниже и есть это правило: при равных метках замены не происходит.
        return;
      }

      // Новое сообщение заменяет судно целиком, а не дописывает поля: иначе
      // у судна остались бы скорость и курс из прошлой позиции.
      byId.set(vessel.id, { vessel, timeMs });

      // Предел считается после записи и по числу судов: сто сообщений об одном
      // судне размер не увеличат, и сбор пойдёт до конца окна.
      if (byId.size >= SNAPSHOT_VESSEL_LIMIT) {
        succeed("limit_reached");
      }
    });

    transport.onError(() => {
      // До открытия — «не удалось подключиться», и ответ уходит немедленно, не
      // дожидаясь конца срока. После — ошибка уже на стороне источника.
      fail(subscribed ? "provider_error" : "connect_failed");
    });

    transport.onClose(() => {
      // Закрытие после подписки — потерянная связь; до подписки — неудавшееся
      // подключение. Собранное к этому моменту не отдаётся: набор за оборванное
      // окно неполон, и выдать его успехом значило бы соврать о районе.
      fail(subscribed ? "disconnected" : "connect_failed");
    });
  });
}

/** Боевые часы. */
export const systemClock: Clock = {
  now: () => new Date(),
  setTimer: (ms, callback) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Боевое соединение поверх WebSocket. В Node 22 `WebSocket` есть глобально,
 * поэтому отдельной библиотеки не нужно.
 */
export function createWebSocketTransport(): Transport {
  const socket = new WebSocket(AISSTREAM_URL);
  let errorHandler = () => {};

  return {
    send: (payload) => socket.send(payload),
    close: () => socket.close(),
    onOpen: (handler) => socket.addEventListener("open", () => handler()),
    onMessage: (handler) => {
      socket.addEventListener("message", (event: MessageEvent) => {
        const { data } = event;

        // Источник шлёт бинарные кадры с UTF-8 JSON внутри, но может прислать и
        // строку. Blob разбирается асинхронно, поэтому обрабатывается отдельно.
        if (typeof data === "string") {
          handler(data);
          return;
        }

        if (data instanceof Blob) {
          void data.text().then(handler, () => errorHandler());
          return;
        }

        handler(new TextDecoder().decode(data as ArrayBuffer));
      });
    },
    onError: (handler) => {
      errorHandler = handler;
      socket.addEventListener("error", handler);
    },
    onClose: (handler) => socket.addEventListener("close", () => handler()),
  };
}
