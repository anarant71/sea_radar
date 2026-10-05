/**
 * `GET /api/snapshot` — снимок настоящих позиций.
 *
 * Отдаёт набор судов, собранный за срок сбора. Пустой набор — это успех с
 * `vessels: []`, а не ошибка: судов в районе могло не быть, и интерфейс
 * говорит об этом отдельными словами.
 *
 * Обработчик серверный: ключ читается здесь и в браузер не попадает. Соединение
 * с AISStream открывает сервер приложения, а не страница.
 */

import { SNAPSHOT_WINDOW_SECONDS } from "@/config";
import { readApiKey } from "@/server/apiKey";
import {
  collectSnapshot,
  createWebSocketTransport,
  systemClock,
} from "@/server/reader";
import type { SnapshotErrorCode } from "@/server/snapshotError";
import { messageFor } from "@/server/snapshotError";

// Node runtime: нужен WebSocket и серверное окружение. В Next.js 16 это уже
// значение по умолчанию, а Edge объявлен устаревшим, — строка стоит явно,
// потому что задание называет её частью контракта.
export const runtime = "nodejs";

// Снимок зависит от момента запроса: ответ не кэшируется и не пререндерится.
export const dynamic = "force-dynamic";

function errorResponse(code: SnapshotErrorCode, attemptedAt: Date): Response {
  return Response.json(
    {
      ok: false,
      attemptedAt: attemptedAt.toISOString(),
      error: { code, message: messageFor(code) },
    },
    { status: 502 },
  );
}

export async function GET(request: Request): Promise<Response> {
  // Ключа нет — отвечаем сразу, соединение не открывается вовсе.
  const apiKey = readApiKey();
  if (!apiKey.ok) {
    return errorResponse("no_api_key", systemClock.now());
  }

  try {
    const result = await collectSnapshot({
      apiKey: apiKey.key,
      transport: createWebSocketTransport(),
      clock: systemClock,
      signal: request.signal,
    });

    if (!result.ok) {
      return errorResponse(result.code, result.attemptedAt);
    }

    return Response.json({
      ok: true,
      vessels: result.vessels,
      collectedAt: result.collectedAt.toISOString(),
      // Константа окна, а не фактическая длительность: при завершении по
      // пределу сбор занял меньше, но в подписи на экране стоит те же 15 с.
      windowSeconds: SNAPSHOT_WINDOW_SECONDS,
      count: result.vessels.length,
      truncated: result.truncated,
      reason: result.reason,
    });
  } catch {
    // Текст исключения наружу не отдаётся: в нём может оказаться что угодно,
    // вплоть до подставленного в адрес ключа. Наружу — фиксированная фраза.
    return errorResponse("internal", systemClock.now());
  }
}
