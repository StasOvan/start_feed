const { chromium } = require('playwright');
const url = 'https://www.ozon.ru/product/1603576247';

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    ]
  });

  const context = await browser.newContext({
    // Координаты Москвы (широта, долгота)
    geolocation: { latitude: 55.7558, longitude: 37.6173 },
    permissions: ['geolocation'] // Даём разрешение на геолокацию
  });

  const page = await context.newPage();

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'ru-RU,ru;q=0.9'
  });

  try {
    console.log('Загрузка страницы с геолокацией Москвы...');
    await page.goto(url, {
      timeout: 60000,
      waitUntil: 'networkidle'
    });

    // Проверяем геолокацию (опционально)
    await page.evaluate(() => {
      navigator.geolocation.getCurrentPosition(
        pos => console.log('Геолокация:', pos.coords),
        err => console.error('Ошибка геолокации:', err)
      );
    });

    await page.waitForSelector('h1', { timeout: 10000 });
    console.log('Страница успешно загружена!');
    await page.waitForTimeout(5000);
    
  } catch (err) {
    console.error('Ошибка:', err);
    await page.waitForTimeout(10000);
  } finally {
    await browser.close();
    console.log('Браузер закрыт');
  }
})();