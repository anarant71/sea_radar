import { test, expect } from '@playwright/test';

/**
 * Тесты выбора судна. Проверяют только выбор и карточку: движение здесь не
 * проверяется — оно проверено визуально, автоматическая проверка с управляемым
 * временем относится к релизу R3.
 *
 * Суда и карточка ищутся только по data-атрибутам. Текст и классы для поиска не
 * используются: название приходит от экипажа и может быть любым, а классы —
 * деталь оформления.
 */

const VESSEL_ID = 'demo-1';

test.beforeEach(async ({ page }) => {
  // Тайлы карты не загружаются: иначе тест зависел бы от сети и от доступности
  // tile.openstreetmap.org. Значки судов рисует Leaflet сам, без тайлов.
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await page.goto('/');
});

test('на странице три элемента с data-vessel-id', async ({ page }) => {
  await expect(page.locator('[data-vessel-id]')).toHaveCount(3);
});

test('клик по судну открывает карточку этого судна', async ({ page }) => {
  await page.locator(`[data-vessel-id="${VESSEL_ID}"]`).click();

  await expect(page.locator(`[data-card-vessel-id="${VESSEL_ID}"]`)).toBeVisible();
  // Карточка на странице одна: открыта карточка выбранного судна, а не ещё одна рядом.
  await expect(page.locator('[data-card-vessel-id]')).toHaveCount(1);
});

test('повторный клик по тому же судну карточку не закрывает', async ({ page }) => {
  const vessel = page.locator(`[data-vessel-id="${VESSEL_ID}"]`);
  const card = page.locator(`[data-card-vessel-id="${VESSEL_ID}"]`);

  await vessel.click();
  await expect(card).toBeVisible();

  await vessel.click();
  await expect(card).toBeVisible();
});

test('ID с HTML-разметкой остаётся текстом в атрибуте значка', async ({ page }) => {
  const id = '"><img src=x><span data-injected="true">';

  await page.route('**/api/snapshot', (route) => route.fulfill({
    json: {
      ok: true,
      vessels: [{
        id,
        name: null,
        lat: 51,
        lon: 1.4,
        speedKnots: null,
        courseDeg: null,
        timestamp: '2026-01-01T12:00:00.000Z',
        source: 'aisstream',
      }],
      collectedAt: '2026-01-01T12:00:15.000Z',
      windowSeconds: 15,
      count: 1,
      truncated: false,
      reason: 'window_elapsed',
    },
  }));

  await page.getByRole('button', { name: 'Загрузить настоящие позиции' }).click();

  const icon = page.locator('.vessel-icon');
  await expect(icon).toHaveCount(1);
  await expect(icon).toHaveAttribute('data-vessel-id', id);
  await expect(icon.locator('img, [data-injected="true"]')).toHaveCount(0);
});
