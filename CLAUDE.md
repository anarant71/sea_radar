# Sea Radar

Локальное учебное веб-приложение: карта пролива Дувр и суда на ней. Запускается на ноутбуке преподавателя, наружу не открывается.
Задание заказчика — `docs/tasks/PROJECT_BRIEF.md`. Последняя спецификация спринта — `docs/tasks/SPRINT-03.md`. Читай их из репозитория, а не по пересказу.

## Стек

- Node.js 24, npm
- TypeScript 6.x, режим `strict`
- Next.js 16 (App Router) + React 19
- Leaflet 1.9.x — библиотека карт, подключается **только на клиенте**
- Слой карты: OpenStreetMap Standard, атрибуция «© OpenStreetMap contributors»

Других библиотек не добавлять без явного согласования.

## Команды

```
npm run dev      # разработка, http://localhost:3000
npm run build    # production-сборка; на ней ловится обращение Leaflet к window
npm start        # запуск собранного приложения
```

## Текущее состояние и границы

- R1 реализует карту, демонстрационные суда и карточку.
- R2 добавляет серверный снимок AISStream через `GET /api/snapshot`.
- R3 содержит проверки преобразования данных, сбора, движения и состояний интерфейса. Независимое ревью B-17 не считать выполненным, пока его результат отдельно не зафиксирован.
- Последнее задание в репозитории — `docs/tasks/SPRINT-03.md`. Перед изменениями читай brief и актуальный спринт целиком.

Не добавлять вне согласованного задания:
- другие внешние источники, дополнительные API-маршруты или режимы работы;
- аутентификацию, публичное размещение, историю движения или новые районы;
- новые зависимости или тестовые раннеры без согласования;
- папки и пустые модули «на будущее».

Существующие кнопку загрузки, endpoint `/api/snapshot` и тесты не удалять и не отключать из-за ограничений более раннего спринта.

## Секреты

Ключ доступа к источнику данных не должен попасть в исходный код, в вывод на экран и в передаваемые заказчику файлы.
Не читать `.env*` и не выводить их содержимое. Не печатать значения переменных окружения. Если для работы нужен секрет — сказать об этом, а не искать его в файлах.

## Данные

Ноль и «нет данных» — разные вещи. Скорость `0` — это стоящее судно и показывается как `0 уз`; неизвестное значение показывается как «Нет данных».
Название судна приходит от экипажа и может содержать что угодно. Показывать его как текст, никогда не как HTML.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
