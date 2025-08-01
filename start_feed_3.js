
// ### edited by Stas
const config = {
    //### Тут искомые ключевые слова и коэффициенты
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

    //### ---

    xmlUrl: 'https://www.turistore.ru/marketplace/4249949.xml'    

};
// ### end by Stas




const axios = require("axios");
const xml2js = require("xml2js");
const fs = require("fs");
const { Cluster } = require("playwright-cluster");
const cron = require("node-cron");
const ftp = require("basic-ftp");


const readline = require('readline');

function waitForSpaceKey() {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    process.stdin.on('keypress', (str, key) => {
      if (key.name === 'space') {
        rl.close();
        resolve();
      }
    });
    
    console.log('Нажмите ПРОБЕЛ для продолжения...');
  });
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const calculatePrices = (offer, platform) => {
    const isOzon = platform === 'ozon';
    const price1 = isOzon ? offer.price_ozon_1 : offer.price_wb_1;
    const price2 = isOzon ? offer.price_ozon_2 : offer.price_wb_2;
    const basePrice = isOzon ? offer.price_ozon : offer.price_wb;
    const priceKey1 = isOzon ? 'reprice_ozon_1' : 'reprice_wb_1';
    const priceKey2 = isOzon ? 'reprice_ozon_2' : 'reprice_wb_2';
    const minMultiplier = isOzon ? 1.8 : 1.75;

    if (price1 === "NotFound" && price2 === "NotFound") {
        const minPrice = (+offer.price_mrc * (isOzon ? 1.45 : 1.45)).toFixed(2);
        offer[priceKey1] = minPrice;
        offer[priceKey2] = minPrice;
    } else {
        const priceVal1 = isNaN(+price1) ? +price2 : +price1;
        const priceVal2 = isNaN(+price2) ? 0 : +price2;
        const ratio = price2 === "NotFound" ? (isOzon ? 1.3 : 1.3) : 1;
        const stock = price2 === "NotFound" ? 0 : 1;

        offer[priceKey1] = (+offer.price_mrc * ratio + +basePrice * stock - priceVal1 * stock + 
                        (+offer.price_mrc - priceVal1) * (1 - (priceVal1 + 1) / (+basePrice + 1)) * stock).toFixed(2);
        
        offer[priceKey2] = (+offer.price_mrc * ratio + +basePrice * stock - priceVal2 * stock + 
                        (+offer.price_mrc - priceVal2) * (1 - (priceVal2 + 1) / (+basePrice + 1)) * stock).toFixed(2);
    }

    const minPrice = +offer.price_zakup * minMultiplier;
    if (+offer[priceKey1] < minPrice) {
        offer[priceKey1] = minPrice.toFixed(2);
    }
    if (+offer[priceKey2] < minPrice) {
        offer[priceKey2] = minPrice.toFixed(2);
    }
};

async function fetchPrices() {

    const response = await axios.get( config.xmlUrl , { headers: { "Content-Type": "application/xml" } });

    const xmlData = response.data;
    const parser = new xml2js.Parser();
    const jsonData = await parser.parseStringPromise(xmlData);
    const offers = jsonData.yml_catalog.shop[0].offers[0].offer;
    console.log(`Найдено товаров: ${offers.length}`);

    const currentDate = new Date();
    currentDate.setHours(currentDate.getHours() + 3); // Добавляем 3 часа для московского времени

    // Форматируем дату в формате гггг-мм-дд чч:мм:сс
    const formattedDate = currentDate.toISOString().replace("T", " ").split(".")[0];

    jsonData.yml_catalog.$.date = formattedDate; // Добавляем отформатированную дату

    const builder = new xml2js.Builder();
    const updatedXml = builder.buildObject(jsonData);
    fs.writeFileSync("updated_offers.xml", updatedXml);

    try {
        let z = 0;
        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            maxConcurrency: 4, // Уменьшите, если проблемы остаются
            playwrightOptions: {
                // Явно указываем Firefox и отключаем Chrome
                browserName: 'firefox',  // Ключевая настройка!
                headless: false,
                firefoxUserPrefs: {
                    "javascript.options.mem.max": 8192,
                    "browser.cache.memory.enable": false
                },
                // Отключаем автоматический выбор Chrome
                channel: null,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox"
                ]
            }
        });
            // playwrightOptions: {
            //     headless: true,
            //     firefoxUserPrefs: {
            //         "dom.webdriver.enabled": false,
            //         "useAutomationExtension": false
            //     },
            //     args: [
            //         "--disable-gpu",
            //         "--disable-dev-shm-usage"
            //     ]
            // }
        

        // const cluster = await Cluster.launch({
        //     // browser: "firefox",
        //     concurrency: Cluster.CONCURRENCY_PAGE,
        //     maxConcurrency: 8,
        //     playwrightOptions: {
        //         headless: false,
        //         args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-infobars", "--window-size=1380,1000", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors"],
        //     },
        // });


        // Ozon task
        await cluster.task(async ({ page, data: offer }) => {
            if (page.isClosed()) {
                console.log("Страница закрыта. Пропускаем.");
                return;
            }

            const articleOzon = offer.article_ozon[0];
            console.log(`${z++} / ${offers.length} OZON`);

            if (!articleOzon) {
                console.log(`Пропуск товара: ${offer.name[0]} — отсутствует article_ozon.`);
                offer.price_ozon_1 = "NotFound";
                offer.price_ozon_2 = "NotFound";
                offer.price_ozon_3 = "NotFound";
                calculatePrices(offer, 'ozon');
                return;
            }

            const ozonUrl = `https://www.ozon.ru/product/${articleOzon}`;
            let attempts = 0;
            const maxAttempts = 2;
            let pageLoaded = false;

            while (attempts < maxAttempts && !pageLoaded) {
                try {
                    await page.goto(ozonUrl, { timeout: 20000 });
                    
                    await page.waitForSelector('[data-widget="webOutOfStock"], div[data-widget="webPrice"] span, [data-widget="error"]', { timeout: 20000 });
                    pageLoaded = true;
                } catch (error) {
                    attempts++;
                    console.log(`Ошибка при загрузке страницы для товара: ${offer.name[0]} (${ozonUrl}). Попытка ${attempts} из ${maxAttempts}.`);
                    if (attempts >= maxAttempts) {
                        console.log(`Не удалось загрузить страницу после ${maxAttempts} попыток. Пропускаем.`);
                        offer.price_ozon_1 = "NotFound";
                        offer.price_ozon_2 = "NotFound";
                        offer.price_ozon_3 = "NotFound";
                        calculatePrices(offer, 'ozon');
                        return;
                    }
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            const hasErrorStock = (await page.$('[data-widget="webOutOfStock"]')) !== null;
            const hasError = (await page.$('[data-widget="error"]')) !== null;

            if (hasErrorStock || hasError) {
                console.log(`Товар недоступен: ${offer.name[0]} (${ozonUrl}). Пропускаем.`);
                offer.price_ozon_1 = "NotFound";
                offer.price_ozon_2 = "NotFound";
                offer.price_ozon_3 = "NotFound";
                calculatePrices(offer, 'ozon');
                return;
            }

            await page.waitForSelector('div[data-widget="webPrice"] span');
            const prices = await page.evaluate(() => {
                const priceElements = document.querySelectorAll('div[data-widget="webPrice"] span');
                return Array.from(priceElements).map(el => el.innerText.replace(/\s+/g, " ").trim());
            });
            let price1 = "NotFound";
            let price2 = "NotFound";
            let price3 = "NotFound";

            if (prices.length === 6) {
                price1 = prices[1];
                price2 = prices[3];
                price3 = prices[4];
            } else if (prices.length === 5) {
                price1 = prices[1];
                price2 = prices[3];
            } else if (prices.length === 2) {
                const hasOzonCard = prices.some(price => price.includes("c Ozon Картой"));
                price2 = prices[1];
                price1 = hasOzonCard ? prices[0] : "NotFound";
            } else if (prices.length === 1) {
                price2 = prices[0];
            }

            offer.price_ozon_1 = price1.trim().replace(/\s+/g, "").replace(/₽|BYN/g, "").replace(/,/g, ".");
            offer.price_ozon_2 = price2.trim().replace(/\s+/g, "").replace(/₽|BYN/g, "").replace(/,/g, ".");
            offer.price_ozon_3 = price3.trim().replace(/\s+/g, "").replace(/₽|BYN/g, "").replace(/,/g, ".");

            calculatePrices(offer, 'ozon');
        });
        for (const offer of offers) {
            cluster.queue(offer);
        }
        await cluster.idle();

        z = 0;
        await cluster.task(async ({ page, data: offer }) => {
            if (page.isClosed()) {
                console.log("Страница закрыта. Пропускаем.");
                return;
            }

            // await page.setViewportSize({ width: 1280, height: 720 });
            const articleWB = offer.article_wb[0];
            const WBUrl = `https://www.wildberries.ru/catalog/${articleWB}/detail.aspx`;
            console.log(`${z++} / ${offers.length} WB ${WBUrl}`);
            
            if (!articleWB) {
                console.log(`Пропуск товара: ${offer.name[0]} — отсутствует articleWB.`);
                offer.price_wb_1 = "NotFound";
                offer.price_wb_2 = "NotFound";
                offer.price_wb_3 = "NotFound";
                calculatePrices(offer, 'wb');
                return;
            }

            let attempts = 0;
            const maxAttempts = 1;
            let pageLoaded = false;
            
            while (attempts < maxAttempts && !pageLoaded) {
                try {
                    await page.route('**/*', (route) => {
                    const resourceType = route.request().resourceType();
                    
                    // 2. Блокируем ненужные ресурсы
                    if (['font', 'image', 'media'].includes(resourceType)) {
                        route.abort();
                    } else {
                        route.continue();
                    }
                    });

                    await page.goto(WBUrl, { timeout: 20000});
                    await page.waitForSelector(".price-block__content, .content404, .product-page__grid", {timeout: 900000});
                    pageLoaded = true;
                    await waitForSpaceKey();
                } catch (error) {
                    attempts++;
                    console.log(`Ошибка: (${WBUrl}).`);
                    if (attempts >= maxAttempts) {
                        // console.log(`Не удалось загрузить страницу после ${maxAttempts} попыток. Пропускаем.`);
                        offer.price_wb_1 = "NotFound";
                        offer.price_wb_2 = "NotFound";
                        offer.price_wb_3 = "NotFound";
                        calculatePrices(offer, 'wb');
                        return;
                    }
                    await waitForSpaceKey();
                }

                
            }

            const prices = await page.evaluate(() => {
                const walletPriceElement = document.querySelector(".price-block__wallet-price") || 
                                        document.querySelector(".price-block__wallet-price.red-price");
                const finalPriceElement = document.querySelector("ins.price-block__final-price") || 
                                        document.querySelector(".price-block__final-price.red-price");
                const oldPriceElement = document.querySelector(".price-block__old-price > span");
                return {
                    walletPrice: walletPriceElement ? walletPriceElement.textContent.trim().replace(/\s+/g, "").replace(/₽/g, "") : "NotFound",
                    finalPrice: finalPriceElement ? finalPriceElement.textContent.trim().replace(/\s+/g, "").replace(/₽/g, "") : "NotFound",
                    oldPrice: oldPriceElement ? oldPriceElement.textContent.trim().replace(/\s+/g, "").replace(/₽/g, "") : "NotFound"
                };
            });
            console.log(prices)  

            offer.price_wb_1 = prices.walletPrice.trim().replace(/\s+/g, "").replace(/₽|BYN/g, "").replace(/,/g, ".");
            offer.price_wb_2 = prices.finalPrice.trim().replace(/\s+/g, "").replace(/₽|BYN/g, "").replace(/,/g, ".");
            offer.price_wb_3 = prices.oldPrice.trim().replace(/\s+/g, "").replace(/₽|BYN/g, "").replace(/,/g, ".");

            calculatePrices(offer, 'wb');
        });

       for (const offer of offers) {
            cluster.queue(offer);
        }

        await cluster.idle();

        await delay(3000);
        await cluster.close();
		
		for (const offer of offers) {
            const isAllPricesWB_NotFound = 
                offer.price_wb_1 === "NotFound" && 
                offer.price_wb_2 === "NotFound" && 
                offer.price_wb_3 === "NotFound";

            if (isAllPricesWB_NotFound) {
                const minAllowedWB = (+offer.price_mrc * 1.4).toFixed(2);
                offer.reprice_wb_1 = minAllowedWB;
                offer.reprice_wb_2 = minAllowedWB;

            } else {
                const minPriceWB = +offer.price_zakup * 1.75;
                if (offer.reprice_wb_1 !== "NotFound" && +offer.reprice_wb_1 < minPriceWB) {
                    offer.reprice_wb_1 = minPriceWB.toFixed(2);
                }
                if (offer.reprice_wb_2 !== "NotFound" && +offer.reprice_wb_2 < minPriceWB) {
                    offer.reprice_wb_2 = minPriceWB.toFixed(2);
                }
            }

            const isAllPricesOzon_NotFound = 
                offer.price_ozon_1 === "NotFound" && 
                offer.price_ozon_2 === "NotFound" && 
                offer.price_ozon_3 === "NotFound";

            if (isAllPricesOzon_NotFound) {
                const minAllowedOzon = (+offer.price_mrc * 1.4).toFixed(2);
                offer.reprice_ozon_1 = minAllowedOzon;
                offer.reprice_ozon_2 = minAllowedOzon;
            } else {
                const minPriceOzon = +offer.price_zakup * 1.8;
                if (offer.reprice_ozon_1 !== "NotFound" && +offer.reprice_ozon_1 < minPriceOzon) {
                    offer.reprice_ozon_1 = minPriceOzon.toFixed(2);
                }
                if (offer.reprice_ozon_2 !== "NotFound" && +offer.reprice_ozon_2 < minPriceOzon) {
                    offer.reprice_ozon_2 = minPriceOzon.toFixed(2);
                }
            }
        }

        const builder = new xml2js.Builder();

        const updatedXml = builder.buildObject(jsonData);

        // Сохраняем обновленный XML в файл
        fs.writeFileSync("updated_offers.xml", updatedXml);
        console.log("Обновленный XML сохранён как updated_offers.xml");

        // Загружаем файл на FTP-сервер
        await uploadFile();
        
    } catch (error) {
        console.error("Ошибка при получении данных:", error);
    }
}


// Функция для загрузки файла на FTP-сервер
async function uploadFile() {
    const client = new ftp.Client();
    client.ftp.verbose = true;

    try {
        await client.access({
            host: "31.31.196.253",
            user: "u3030928_ForRepr",
            password: "159753852rR",
            secure: false,
        });

        // Переходим в нужную директорию на сервере
        await client.cd("/www/marketplace-turistore.ru/feed_3/");

        // Загрузка файла в указанную директорию
        await client.uploadFrom("updated_offers.xml", "updated_offers.xml");
        console.log("Файл updated_offers.xml успешно загружен на сервер по пути /www/marketplace-turistore.ru/feed_3/.");
    } catch (err) {
        console.error("Ошибка при загрузке файла:", err);
    } finally {
        client.close();
    }
}


// Настройка cron-расписания (запуск в 4:00, 7:00, 11:00, 15:00, 19:00)
cron.schedule("0 4,7,11,15,19 * * *", async () => {
    console.log("Запуск задачи по расписанию (4:00, 7:00, 11:00, 15:00, 19:00)");
    try {
        await fetchPrices();
        await processKeywords();
    } catch (error) {
        console.error("Ошибка при выполнении задач по расписанию:", error);
    }
});

// Запуск при старте приложения (при команде из терминала: node start_s.js)
(async () => {
    try {
        await fetchPrices();
        await processKeywords();
    } catch (error) {
        console.error("Ошибка в основном потоке:", error);
        process.exit(1);
    }
})();


// ### edited by Stas

async function processKeywords() {

    try {

        const xmlData = fs.readFileSync('updated_offers.xml', 'utf-8');
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(xmlData);
        
        // получение offers 
        const offers = result.yml_catalog.shop.offers.offer;
        
        // Проходим по всем offer 
        for (const offer of offers) {
            // и ищем ключевые слова
            for (const [keyword, multiplier] of Object.entries(config.keywords_WB))
                if (offer.name.includes(keyword)) {
                    applyMultiplier(offer, 'wb', multiplier);
                    console.log(`Найден ${keyword} в товаре ${offer.name}`);
                    console.log(`Применен коэффициент для WB: ${multiplier}`);
                    break;
                }
            
            for (const [keyword, multiplier] of Object.entries(config.keywords_OZON))
                if (offer.name.includes(keyword)) {
                    applyMultiplier(offer, 'ozon', multiplier);
                    console.log(`Найден ${keyword} в товаре ${offer.name}`);
                    console.log(`Применен коэффициент для OZON: ${multiplier}`);
                    break;
                }

        }
        
        const builder = new xml2js.Builder();
        const updatedXml = builder.buildObject(result);
        fs.writeFileSync('updated_offers.xml', updatedXml);
        console.log('Файл успешно обработан и сохранен (by Stas)');

        uploadFile(); // грузим по ФТП
        
    } catch (error) {

        console.error('Ошибка:', error);

    }

}

// вспомогательная функция для изменения коэффициента
function applyMultiplier(offer, marketplace, multiplier) {

    const fields = {
        wb: ['reprice_wb_1', 'reprice_wb_2'],
        ozon: ['reprice_ozon_1', 'reprice_ozon_2']
    };
    
    for (const field of fields[marketplace])
        if (offer[field] && offer[field] !== 'NotFound') {
            const currentValue = parseFloat(offer[field]);
            if (!isNaN(currentValue)) offer[field] = (currentValue * multiplier).toFixed(2);
        }
    
}
