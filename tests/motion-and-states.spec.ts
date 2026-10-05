import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * B-16. Движение демонстрационных судов и состояния интерфейса R2.
 *
 * Время страницы — только через page.clock: часы поставлены на паузу до
 * загрузки, и тики демонстрации происходят ровно тогда, когда тест продвигает
 * время. Реальных ожиданий нет. Сборщик в этих тестах не участвует: ответ
 * GET /api/snapshot подменяется, настоящий endpoint не вызывается.
 *
 * Все ожидаемые значения — литералы: координаты взяты из маршрута demo-1 в
 * config.ts, тексты — из SPRINT-03. Суда и карточка ищутся по data-атрибутам.
 */

const VESSEL_ID = 'demo-1';

/** Момент, на котором часы страницы стоят при загрузке. */
const PAUSED_AT = new Date('2026-09-10T13:00:00Z');

/** Длина тика демонстрации (DEMO_TICK_MS), литералом. */
const TICK_MS = 2000;

test.beforeEach(async ({ page }) => {
  // Тайлы не загружаются: тест не зависит от сети и tile.openstreetmap.org.
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
});

/** Значение строки карточки по её подписи. */
function cardValue(card: Locator, label: string): Locator {
  return card.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd');
}

test.describe('движение демонстрационных судов', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: PAUSED_AT });
    await page.clock.pauseAt(PAUSED_AT);
    await page.goto('/');
    // На паузе стоят и таймеры, которыми пользуются загрузка карты и Leaflet.
    // Часы двигаются короткими шагами, пока значок не появится: суммарно это
    // сотни миллисекунд, меньше одного тика, — демонстрация не сдвигается.
    await expect(async () => {
      await page.clock.runFor(50);
      await expect(page.locator(`[data-vessel-id="${VESSEL_ID}"]`)).toBeVisible({ timeout: 100 });
    }).toPass();
    await expect(
      page.locator(`[data-card-vessel-id]`),
      'до клика карточки нет',
    ).toHaveCount(0);
  });

  test('через несколько тиков судно сдвинулось, карточка показывает новые координаты', async ({ page }) => {
    const vessel = page.locator(`[data-vessel-id="${VESSEL_ID}"]`);
    const card = page.locator(`[data-card-vessel-id="${VESSEL_ID}"]`);

    await vessel.click();
    await expect(cardValue(card, 'Координаты')).toHaveText('51.00000, 1.45000');
    const before = await vessel.boundingBox();

    // Три тика: demo-1 на точке с индексом 3 своего маршрута.
    await page.clock.runFor(3 * TICK_MS);

    await expect(cardValue(card, 'Координаты')).toHaveText('50.94000, 1.30000');
    const after = await vessel.boundingBox();
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after).not.toEqual(before);
  });

  test('за концом маршрута судно стоит: 0 уз, курс и время последнего шага', async ({ page }) => {
    const vessel = page.locator(`[data-vessel-id="${VESSEL_ID}"]`);
    const card = page.locator(`[data-card-vessel-id="${VESSEL_ID}"]`);

    await vessel.click();

    // У demo-1 десять точек: на последнюю оно приходит девятым тиком, в
    // 13:00:18 UTC. Продвигаем с запасом — до двенадцатого тика.
    await page.clock.runFor(12 * TICK_MS);

    await expect(cardValue(card, 'Координаты')).toHaveText('50.85000, 1.00000');
    await expect(cardValue(card, 'Скорость')).toHaveText('0 уз');
    await expect(cardValue(card, 'Курс')).toHaveText('252°');
    await expect(cardValue(card, 'Время')).toHaveText('13:00:18 UTC');
    const stopped = await vessel.boundingBox();

    // Ещё пять тиков: ничего не меняется, включая время сообщения.
    await page.clock.runFor(5 * TICK_MS);

    await expect(cardValue(card, 'Координаты')).toHaveText('50.85000, 1.00000');
    await expect(cardValue(card, 'Скорость')).toHaveText('0 уз');
    await expect(cardValue(card, 'Курс')).toHaveText('252°');
    await expect(cardValue(card, 'Время')).toHaveText('13:00:18 UTC');
    expect(await vessel.boundingBox()).toEqual(stopped);
  });
});

test.describe('состояния R2 при подменённом /api/snapshot', () => {
  async function loadWith(page: Page, status: number, body: unknown) {
    await page.route('**/api/snapshot', (route) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Загрузить настоящие позиции' }).click();
  }

  test('ошибка: судов нет, «Данных на карте нет», сообщение с текстом ошибки', async ({ page }) => {
    await loadWith(page, 502, {
      ok: false,
      attemptedAt: '2026-09-10T13:00:00Z',
      error: { code: 'provider_error', message: 'Источник данных вернул ошибку' },
    });

    await expect(page.getByText('Данных на карте нет', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Не удалось получить данные: Источник данных вернул ошибку', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-vessel-id]')).toHaveCount(0);
  });

  test('пустой ответ: подпись «судов: 0», сообщение о пустом сборе', async ({ page }) => {
    await loadWith(page, 200, {
      ok: true,
      vessels: [],
      collectedAt: '2026-09-10T13:00:15Z',
      windowSeconds: 15,
      count: 0,
      truncated: false,
      reason: 'window_elapsed',
    });

    await expect(page.getByText('судов: 0')).toBeVisible();
    await expect(
      page.getByText('За время сбора позиции не получены', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-vessel-id]')).toHaveCount(0);
  });

  test('судно без скорости и курса: «Нет данных» в обоих полях, нейтральный значок', async ({ page }) => {
    const id = '235000001';
    await loadWith(page, 200, {
      ok: true,
      vessels: [
        {
          id,
          name: 'NO SPEED',
          lat: 51.0,
          lon: 1.45,
          speedKnots: null,
          courseDeg: null,
          timestamp: '2026-09-10T13:00:05Z',
          source: 'aisstream',
        },
      ],
      collectedAt: '2026-09-10T13:00:15Z',
      windowSeconds: 15,
      count: 1,
      truncated: false,
      reason: 'window_elapsed',
    });

    const vessel = page.locator(`[data-vessel-id="${id}"]`);
    await expect(vessel).toHaveAttribute('data-icon', 'neutral');

    await vessel.click();
    const card = page.locator(`[data-card-vessel-id="${id}"]`);
    await expect(cardValue(card, 'Скорость')).toHaveText('Нет данных');
    await expect(cardValue(card, 'Курс')).toHaveText('Нет данных');
  });
});
