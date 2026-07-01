'use strict';

const { chromium } = require('playwright');

const BASE_URL = 'https://www.aliexpress.com';
const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * ProductScraper encapsulates all browser automation using Playwright.
 *
 * It replaces the previous Selenium + standalone-chrome + chromedriver stack.
 * A single Chromium instance is launched lazily and reused across requests.
 *
 * Everything that varies by environment is configurable so the scraper does
 * not need code changes when running behind a proxy, in a container, or when
 * AliExpress tweaks its markup:
 *   - PLAYWRIGHT_CHROMIUM_PATH : path to a pre-installed Chromium executable
 *   - SCRAPER_PROXY_SERVER / HTTPS_PROXY : outbound proxy for the browser
 *   - SCRAPER_USER_AGENT : override the browser User-Agent
 *   - SCRAPER_HEADLESS=false : run headed (debugging)
 */
class ProductScraper {
    constructor(options = {}) {
        this.options = {
            headless: process.env.SCRAPER_HEADLESS !== 'false',
            executablePath:
                options.executablePath || process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
            proxyServer:
                options.proxyServer ||
                process.env.SCRAPER_PROXY_SERVER ||
                process.env.HTTPS_PROXY ||
                process.env.https_proxy ||
                undefined,
            userAgent: options.userAgent || process.env.SCRAPER_USER_AGENT || DEFAULT_USER_AGENT,
            navigationTimeout: options.navigationTimeout || 45000,
            ...options,
        };
        this._browser = null;
        this._launching = null;
    }

    async _getBrowser() {
        if (this._browser) return this._browser;
        // guard against concurrent launches
        if (this._launching) return this._launching;
        const launchOptions = {
            headless: this.options.headless,
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
        };
        if (this.options.executablePath) launchOptions.executablePath = this.options.executablePath;
        if (this.options.proxyServer) launchOptions.proxy = { server: this.options.proxyServer };
        this._launching = chromium.launch(launchOptions).then((b) => {
            this._browser = b;
            this._launching = null;
            return b;
        });
        return this._launching;
    }

    async _newPage() {
        const browser = await this._getBrowser();
        const context = await browser.newContext({
            userAgent: this.options.userAgent,
            viewport: { width: 1366, height: 900 },
            locale: 'en-US',
        });
        const page = await context.newPage();
        page.setDefaultNavigationTimeout(this.options.navigationTimeout);
        return { page, context };
    }

    /**
     * Search products for a term on a given page.
     * @returns {Promise<{totalPages:number, selectedPage:number, products:Array<{id:string,name:string,url:string}>}>}
     */
    async searchProducts(term, pageNumber = 1) {
        const { page, context } = await this._newPage();
        try {
            const url = `${BASE_URL}/wholesale?SearchText=${encodeURIComponent(term)}&page=${pageNumber}`;
            await page.goto(url, { waitUntil: 'domcontentloaded' });

            // The results grid is lazy-loaded; scroll to force all cards to render.
            await this._autoScroll(page);

            const result = await page.evaluate(() => {
                // Strategy 1 — read AliExpress' embedded search state. This is far more
                // stable than scraping hashed CSS classes. The blob has moved between
                // window.runParams / _init_data_ / _dida_config_ over the years, so try
                // each and dig for an itemList-like array of products.
                function fromEmbeddedState() {
                    const roots = [];
                    if (window.runParams && window.runParams.mods) roots.push(window.runParams.mods);
                    if (window._init_data_ && window._init_data_.data) roots.push(window._init_data_.data);
                    if (window._dida_config_) roots.push(window._dida_config_);
                    for (const root of roots) {
                        // breadth-first search for an object holding both a product list
                        // and pagination info
                        const queue = [root];
                        let guard = 0;
                        while (queue.length && guard < 5000) {
                            guard++;
                            const node = queue.shift();
                            if (!node || typeof node !== 'object') continue;
                            const list = node.itemList || node.items || node.content;
                            if (Array.isArray(list) && list.length && (list[0].productId || list[0].productIds || list[0].product_id)) {
                                const products = list
                                    .map((it) => {
                                        const id = String(it.productId || it.product_id || it.productIds || '').trim();
                                        const name = (it.title && (it.title.displayTitle || it.title.seoTitle)) || it.title || it.subject || '';
                                        let u = it.productDetailUrl || it.detailUrl || it.productUrl || (id ? `/item/${id}.html` : '');
                                        if (u && u.startsWith('//')) u = 'https:' + u;
                                        if (u && u.startsWith('/')) u = 'https://www.aliexpress.com' + u;
                                        return { id, name: String(name).trim(), url: u };
                                    })
                                    .filter((p) => p.id);
                                if (products.length) {
                                    const totalPages =
                                        (node.pageInfo && (node.pageInfo.totalPage || node.pageInfo.pageCount)) ||
                                        (node.resultCount && node.pageSize && Math.ceil(node.resultCount / node.pageSize)) ||
                                        undefined;
                                    return { products, totalPages };
                                }
                            }
                            for (const k of Object.keys(node)) {
                                const v = node[k];
                                if (v && typeof v === 'object') queue.push(v);
                            }
                        }
                    }
                    return null;
                }

                // Strategy 2 — DOM fallback. Product cards are always anchors that link
                // to /item/<id>.html. This survives class-name churn.
                function fromDom() {
                    const seen = new Set();
                    const products = [];
                    document.querySelectorAll('a[href*="/item/"]').forEach((a) => {
                        const href = a.getAttribute('href') || '';
                        const m = href.match(/\/item\/(?:[^/]*?)?(\d{6,})\.html/) || href.match(/(\d{6,})\.html/);
                        if (!m) return;
                        const id = m[1];
                        if (seen.has(id)) return;
                        seen.add(id);
                        let url = href;
                        if (url.startsWith('//')) url = 'https:' + url;
                        if (url.startsWith('/')) url = 'https://www.aliexpress.com' + url;
                        // best-effort name: title attr, aria-label, nested heading, or img alt
                        const name =
                            (a.getAttribute('title') || a.getAttribute('aria-label') || '').trim() ||
                            (a.querySelector('h1,h2,h3,[title]') && a.querySelector('h1,h2,h3,[title]').textContent.trim()) ||
                            (a.querySelector('img') && (a.querySelector('img').getAttribute('alt') || '').trim()) ||
                            '';
                        products.push({ id, name, url });
                    });
                    return products;
                }

                const embedded = fromEmbeddedState();
                let products = embedded ? embedded.products : fromDom();
                let totalPages = embedded ? embedded.totalPages : undefined;

                // pagination fallback from the visible page bar (e.g. "Total 60 pages")
                if (!totalPages) {
                    const barText = document.body.innerText || '';
                    const tm = barText.match(/Total\s+(\d+)\s+page/i) || barText.match(/\/\s*(\d+)/);
                    if (tm) totalPages = parseInt(tm[1], 10);
                }
                return { products, totalPages };
            });

            const products = result.products || [];
            return {
                totalPages: Number.isFinite(result.totalPages) ? result.totalPages : products.length ? 1 : 0,
                selectedPage: parseInt(pageNumber, 10) || 1,
                products,
            };
        } finally {
            await context.close();
        }
    }

    /**
     * Fetch details for a single product by id.
     * @returns {Promise<{productName:string, productPrice:string, productInStock:number}>}
     */
    async getProductById(id) {
        const { page, context } = await this._newPage();
        try {
            await page.goto(`${BASE_URL}/item/${id}.html`, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(1500);
            return await page.evaluate(() => {
                function fromEmbeddedState() {
                    const root = (window.runParams && window.runParams.data) || window._init_data_ || null;
                    if (!root) return null;
                    const queue = [root];
                    let guard = 0;
                    while (queue.length && guard < 5000) {
                        guard++;
                        const node = queue.shift();
                        if (!node || typeof node !== 'object') continue;
                        if (node.titleModule || node.priceModule || node.title) {
                            const name =
                                (node.titleModule && (node.titleModule.subject || node.titleModule.productTitle)) ||
                                node.subject ||
                                node.title ||
                                '';
                            const price =
                                (node.priceModule &&
                                    (node.priceModule.formatedActivityPrice ||
                                        node.priceModule.formatedPrice)) ||
                                '';
                            const stock =
                                (node.quantityModule && node.quantityModule.totalAvailQuantity) ||
                                (node.inventoryModule && node.inventoryModule.totalAvailQuantity) ||
                                undefined;
                            if (name || price) return { name: String(name), price: String(price), stock };
                        }
                        for (const k of Object.keys(node)) {
                            const v = node[k];
                            if (v && typeof v === 'object') queue.push(v);
                        }
                    }
                    return null;
                }

                const embedded = fromEmbeddedState();
                const pick = (sels) => {
                    for (const s of sels) {
                        const el = document.querySelector(s);
                        if (el && el.textContent.trim()) return el.textContent.trim();
                    }
                    return '';
                };
                const productName =
                    (embedded && embedded.name) ||
                    pick(['h1[data-pl="product-title"]', 'h1.product-title-text', 'h1']);
                const productPrice =
                    (embedded && embedded.price) ||
                    pick(['.product-price-value', '[class*="price--current"]', '[class*="Price"]']);
                let stock = embedded && embedded.stock;
                if (stock === undefined) {
                    const txt = pick(['div.product-quantity-info', '[class*="quantity"]']);
                    const sm = txt.match(/(\d+)/);
                    stock = sm ? parseInt(sm[1], 10) : undefined;
                }
                return {
                    productName,
                    productPrice,
                    productInStock: Number.isFinite(stock) ? stock : parseInt(String(stock).match(/\d+/) || [0], 10) || 0,
                };
            });
        } finally {
            await context.close();
        }
    }

    async _autoScroll(page) {
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let total = 0;
                const step = 500;
                const timer = setInterval(() => {
                    window.scrollBy(0, step);
                    total += step;
                    if (total >= document.body.scrollHeight || total > 8000) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 250);
            });
        });
        await page.waitForTimeout(1000);
    }

    async close() {
        if (this._browser) {
            await this._browser.close();
            this._browser = null;
        }
    }
}

module.exports = ProductScraper;
