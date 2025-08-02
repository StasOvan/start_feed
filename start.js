// ##### ТУТ РЕДАКТИРУЕМ КОЭФФИЦИЕНТЫ ##### //
const config = {

    keywords_WB: {
        "Meyvel_выкл": 0.95,
        "Fenix": 0.90,
		"РИФ": 0.98,
        "Discovery_выкл": 0.93
    },
    keywords_OZON: {
        "Meyvel_выкл": 0.95,
        "Fenix": 0.90,
		"РИФ": 1.031,
        "Discovery_выкл": 0.93
    },

// ##### --- ##### //

    xmlUrl: 'https://www.turistore.ru/marketplace/4249949.xml'    

};


const axios = require('axios');
const { parseString, Builder } = require('xml2js');
const { chromium } = require('playwright');


class Parser {

    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
    }

    async init() {

        if (this.browser) await this.close();

        this.browser = await chromium.launch({
            channel: 'chrome',
            headless: false,
            args: [
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '--disable-blink-features=AutomationControlled',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64)...',
                '--start-maximized', // Автоматически разворачиваем на весь экран
                '--reset-variation-state', // Сбрасываем экспериментальные флаги
                '--disable-extensions', // Отключаем расширения
                '--disable-default-apps' // Отключаем стандартные приложения
            ],
            ignoreDefaultArgs: [
                '--enable-automation' // Отключаем автоматизацию
            ]
        });

        
        this.context = await this.browser.newContext({
            // ### Это для геолокации (Москва)
            // geolocation: { 
            //     latitude: 55.7558,
            //     longitude: 37.6173,
            //     accuracy: 50
            // },
            // permissions: ['geolocation'],
            locale: 'ru-RU',
            viewport: { width: 1280, height: 1024 },// Принудительно устанавливаем размер окна
            screen: { width: 1280, height: 1024 }
        });

        // Дополнительны context
        const page = await this.context.newPage();
        await page.setViewportSize({ width: 1280, height: 1024 });
        this.page = page;
        // await this.context.route('**/*.{png,jpg,jpeg,svg,gif,webp}', route => route.abort());
        // await this.context.route('**/*.css', route => route.abort());
        await this.page.setExtraHTTPHeaders({
            'Accept-Language': 'ru-RU,ru;q=0.9',
            // 'X-Forwarded-For': '95.84.0.0' // Москва геолокация
        });
    }

    async parseOzon(articleOzon) {
        if (!articleOzon || articleOzon.trim() === '') {
            return this.getEmptyPricesOzon();
        }

        const url = `https://www.ozon.ru/product/${articleOzon}`;
        
        try {
                        
            await this.page.goto(url, { 
                timeout: 10000,
                //waitUntil: 'domcontentloaded',
                waitUntil: 'networkidle'
            });

            const priceWidget = await this.page.waitForSelector('[data-widget="webPrice"]', { timeout: 5000 });
            
            const prices = await priceWidget.$$eval('*', nodes => {
                return nodes
                    .map(node => node.textContent.match(/\d[\d\s]*₽/)?.[0])
                    .filter(Boolean)
                    .map(text => parseInt(text.replace(/\D/g, ''), 10))
                    .filter(num => !isNaN(num));
            });

            return this.formatPricesOzon(prices);

        } catch (error) {
            console.error(`Ошибка артикул(${articleOzon}):`, error.message);
            return this.getEmptyPricesOzon();
        }
    }

    async parseWB(articleWB) {
        
        if (!articleWB || articleWB.trim() === '') {
            return this.getEmptyPricesWB();
        }

        const url = `https://www.wildberries.ru/catalog/${articleWB}/detail.aspx`;
        
        try {
            
            await this.page.goto(url, { 
                timeout: 30000, 
                waitUntil: 'domcontentloaded',
            });

            
            await Promise.race([ // Ждем либо появление ценового блока, 404, либо флага что товар не найден
                this.page.waitForSelector(".price-block__content", { timeout: 15000 }),
                this.page.waitForSelector(".content404__title", { timeout: 15000 }),
                this.page.waitForSelector(".sold-out-product__text", { timeout: 15000 })    
            ]);

            await this.page.waitForTimeout(1000);

            const prices = {
                price_wb_1: await this.parsePrice('.price-block__wallet-price'),
                price_wb_2: await this.parsePrice('.price-block__final-price'),
                price_wb_3: await this.parsePrice('.price-block__old-price span')
            };

            return prices;

        } catch (error) {
            console.error(`Ошибка артикул(${articleWB}):`, error.message);
            return this.getEmptyPricesWB();
        }
    }

    async parsePrice(selector) { // это для WB
            const element = await this.page.$(selector);
            if (!element) return "Not found";
            
            const text = await element.textContent();
            const price = text.replace(/[^\d]/g, '');
            return price || "Not found";
    }

    formatPricesOzon(prices) {
        return {
            price_ozon_1: String(prices[0]) || "Not found",
            price_ozon_2: String(prices[1]) || "Not found",
            price_ozon_3: String(prices[2]) || "Not found"
        };
    }

    getEmptyPricesOzon() {
        return { price_ozon_1: "Not found", price_ozon_2: "Not found", price_ozon_3: "Not found" };
    }

    getEmptyPricesWB() {
        return { price_wb_1: "Not found", price_wb_2: "Not found", price_wb_3: "Not found" }; 
    }

    async close() {
        await this.context.close();
        await this.browser.close();
    }
}


function calculatePrices (type, price_zakup, price_mrc, prices) {

    switch (type) {
        
        case "ozon": // Расчеты для Озон
            
            if (Object.values(prices).every(price => price === "Not found")) { // если все цены "Not found"
                prices.price_ozon_1 = prices.price_ozon_2 = prices.price_ozon_3 = price_mrc * 1.4;
            }
            break;
        
        case "wb": // Расчеты для WB
            break;
    } 


}


async function processFeed() {
  
    try {

        // Загрузка XML
        console.log('Загрузка XML-фида...');
        const response = await axios.get(config.xmlUrl);
        const xmlData = response.data;

        // Парсинг XML
        const parsedData = await new Promise((resolve, reject) => {
            parseString(xmlData, (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });

        // Обработка каждого offer
        const offers = parsedData.yml_catalog.shop[0].offers[0].offer;
        console.log(`Найдено ${offers.length} товаров`);

        offers.forEach(offer => {            // Добавление новых тегов
            // ToDo: здесь расчет function calculatePrices
        });

        // Сборка обратно в XML
        const builder = new Builder({
        renderOpts: { pretty: true, indent: '  ', newline: '\n' }
        });
        const modifiedXml = builder.buildObject(parsedData);
        
        // test
        const parser = new Parser();
        await parser.init();
        
        let i = 1;
        for (const offer of offers) {
            if (offer.article_ozon && offer.article_ozon[0]) {
                process.stdout.write(`[${i}] Артикул OZON: ${offer.article_ozon[0]}...`);
                const ozonPrices = await parser.parseOzon(offer.article_ozon[0]);
                // Object.assign(offer, calculatePrices("ozon", offer.price_zakup, offer.price_mrc, ozonPrices));
                console.log(ozonPrices);
            }
            if (offer.article_wb && offer.article_wb[0]) {
                process.stdout.write(`[${i}]   Артикул WB: ${offer.article_wb[0]}...`);
                const wbPrices = await parser.parseWB(offer.article_wb[0]);
                console.log(wbPrices);
            }
            if (i++ == 20) break;
        }

        await parser.close();

        return modifiedXml;

    } catch (err) {
        console.error('Ошибка:', err.message);
        throw err;
    }
}

// Запуск обработки
processFeed()
    .then(xml => {
        console.log('\nОбработка завершена!');
    // Здесь передать xml на FTP или дальше обрабатывать
    })
    .catch(() => process.exit(1));

