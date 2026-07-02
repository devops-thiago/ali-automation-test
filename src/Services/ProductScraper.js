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
      executablePath: options.executablePath || process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
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
              if (
                Array.isArray(list) &&
                list.length &&
                (list[0].productId || list[0].productIds || list[0].product_id)
              ) {
                const products = list
                  .map((it) => {
                    const id = String(it.productId || it.product_id || it.productIds || '').trim();
                    const name =
                      (it.title && (it.title.displayTitle || it.title.seoTitle)) ||
                      it.title ||
                      it.subject ||
                      '';
                    let u =
                      it.productDetailUrl ||
                      it.detailUrl ||
                      it.productUrl ||
                      (id ? `/item/${id}.html` : '');
                    if (u && u.startsWith('//')) u = 'https:' + u;
                    if (u && u.startsWith('/')) u = 'https://www.aliexpress.com' + u;
                    return { id, name: String(name).trim(), url: u };
                  })
                  .filter((p) => p.id);
                if (products.length) {
                  const totalPages =
                    (node.pageInfo && (node.pageInfo.totalPage || node.pageInfo.pageCount)) ||
                    (node.resultCount &&
                      node.pageSize &&
                      Math.ceil(node.resultCount / node.pageSize)) ||
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
            const m =
              href.match(/\/item\/(?:[^/]*?)?(\d{6,})\.html/) || href.match(/(\d{6,})\.html/);
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
              (a.querySelector('h1,h2,h3,[title]') &&
                a.querySelector('h1,h2,h3,[title]').textContent.trim()) ||
              (a.querySelector('img') &&
                (a.querySelector('img').getAttribute('alt') || '').trim()) ||
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
        totalPages: Number.isFinite(result.totalPages)
          ? result.totalPages
          : products.length
            ? 1
            : 0,
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
      try {
        await page.waitForSelector(
          '[data-pl="product-title"], [class*="price-default--current"], script[type="application/ld+json"]',
          { timeout: 15000 }
        );
      } catch (_) {
        /* partial page may still expose JSON-LD or title */
      }
      await page.waitForTimeout(500);

      return await page.evaluate(() => {
        function pickText(sels) {
          for (const s of sels) {
            const el = document.querySelector(s);
            if (el && el.textContent.trim()) return el.textContent.trim();
          }
          return '';
        }

        function flattenJsonLd(value) {
          const out = [];
          const stack = [value];
          while (stack.length) {
            const current = stack.pop();
            if (Array.isArray(current)) {
              stack.push(...current);
              continue;
            }
            if (!current || typeof current !== 'object') continue;
            if (current['@graph']) {
              const graph = current['@graph'];
              stack.push(...(Array.isArray(graph) ? graph : [graph]));
              continue;
            }
            out.push(current);
          }
          return out;
        }

        function parseJsonLdProduct() {
          for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
              const items = flattenJsonLd(JSON.parse(script.textContent));
              for (const item of items) {
                if (!item || item['@type'] !== 'Product') continue;
                const offer = item.offers || (Array.isArray(item.offers) ? item.offers[0] : null);
                let price = '';
                if (offer && offer.price != null) {
                  const amount = String(offer.price);
                  const currency = offer.priceCurrency || '';
                  if (currency === 'BRL') price = `R$${amount.replace('.', ',')}`;
                  else if (currency === 'USD') price = `US$ ${amount}`;
                  else if (currency) price = `${currency} ${amount}`;
                  else price = amount;
                }
                const availability = offer && offer.availability ? String(offer.availability) : '';
                return {
                  name: item.name ? String(item.name).trim() : '',
                  price,
                  inStock: availability.includes('InStock')
                    ? 1
                    : availability.includes('OutOfStock')
                      ? 0
                      : undefined,
                };
              }
            } catch (_) {
              /* ignore malformed JSON-LD */
            }
          }
          return null;
        }

        function fromEmbeddedState() {
          const roots = [];
          if (window.runParams && Object.keys(window.runParams).length)
            roots.push(window.runParams);
          if (window.runParams && window.runParams.data) roots.push(window.runParams.data);
          if (window._init_data_) roots.push(window._init_data_);
          if (window._dida_config_) roots.push(window._dida_config_);
          if (Array.isArray(window.data)) roots.push(...window.data);

          let name = '';
          let price = '';
          let stock;

          const queue = roots.slice();
          let guard = 0;
          while (queue.length && guard < 8000) {
            guard++;
            const node = queue.shift();
            if (!node || typeof node !== 'object') continue;

            if (node.titleModule && typeof node.titleModule === 'object') {
              const candidate =
                node.titleModule.subject ||
                node.titleModule.productTitle ||
                node.titleModule.displayTitle ||
                '';
              if (candidate) name = String(candidate).trim();
            }
            if (node.priceModule && typeof node.priceModule === 'object') {
              const candidate =
                node.priceModule.formatedActivityPrice ||
                node.priceModule.formattedActivityPrice ||
                node.priceModule.formatedPrice ||
                node.priceModule.formattedPrice ||
                '';
              if (candidate) price = String(candidate).trim();
            }
            if (node.quantityModule && typeof node.quantityModule === 'object') {
              const candidate = node.quantityModule.totalAvailQuantity;
              if (Number.isFinite(candidate) && candidate > 0) stock = candidate;
            }
            if (node.inventoryModule && typeof node.inventoryModule === 'object') {
              const candidate = node.inventoryModule.totalAvailQuantity;
              if (Number.isFinite(candidate) && candidate > 0) stock = candidate;
            }

            for (const k of Object.keys(node)) {
              const v = node[k];
              if (v && typeof v === 'object') queue.push(v);
            }
          }
          if (!name && !price && stock === undefined) return null;
          return { name, price, stock };
        }

        function parseStockFromDom() {
          const chunks = [
            document.body.innerText || '',
            ...[...document.querySelectorAll('[class*="quantity"]')].map(
              (el) => el.textContent || ''
            ),
          ];
          const bodyText = chunks.join('\n');
          const patterns = [
            /(\d[\d.,]*)\s*(?:pieces?|peças?)\s*(?:available|dispon[ií]ve(?:is|l))/i,
            /only\s+(\d[\d.,]*)\s+left/i,
            /(?:restam|remaining)\s+(\d[\d.,]*)/i,
            /(\d[\d.,]*)\s+in\s+stock/i,
            /Limite de\s+(\d[\d.,]*)\s+peç/i,
            /Limit(?:ed to)?\s+(\d[\d.,]*)\s+(?:piece|item)/i,
          ];
          for (const re of patterns) {
            const m = bodyText.match(re);
            if (m) {
              const n = parseInt(String(m[1]).replace(/\D/g, ''), 10);
              if (Number.isFinite(n) && n > 0) return n;
            }
          }
          const qtyInput = document.querySelector(
            '.comet-v2-input-number-input, input[class*="quantity"], input[type="number"]'
          );
          if (qtyInput && qtyInput.max) {
            const n = parseInt(qtyInput.max, 10);
            if (Number.isFinite(n) && n > 0) return n;
          }
          return undefined;
        }

        const jsonLd = parseJsonLdProduct();
        const embedded = fromEmbeddedState();
        const domName = pickText([
          'h1[data-pl="product-title"]',
          '[data-pl="product-title"]',
          '[class*="title--title"]',
          'h1.product-title-text',
        ]);
        const domPrice = pickText([
          '[class*="price-default--current"]',
          '[data-pl="product-price"]',
          '.product-price-value',
          '[class*="price--current"]',
          '[class*="Price--current"]',
        ]);
        const metaPrice = document.querySelector('meta[itemprop="price"]')?.content;
        const metaCurrency = document.querySelector('meta[itemprop="priceCurrency"]')?.content;
        let metaFormattedPrice = '';
        if (metaPrice) {
          if (metaCurrency === 'BRL') metaFormattedPrice = `R$${metaPrice.replace('.', ',')}`;
          else if (metaCurrency === 'USD') metaFormattedPrice = `US$ ${metaPrice}`;
          else if (metaCurrency) metaFormattedPrice = `${metaCurrency} ${metaPrice}`;
          else metaFormattedPrice = metaPrice;
        }

        const productName =
          domName ||
          (embedded && embedded.name) ||
          (jsonLd && jsonLd.name) ||
          (document.title && !/^aliexpress$/i.test(document.title) ? document.title.trim() : '');

        const productPrice =
          domPrice ||
          (embedded && embedded.price) ||
          (jsonLd && jsonLd.price) ||
          metaFormattedPrice;

        let stock;
        if (embedded && Number.isFinite(embedded.stock) && embedded.stock > 0) {
          stock = embedded.stock;
        } else {
          stock = parseStockFromDom();
        }
        if (stock === undefined && jsonLd && jsonLd.inStock !== undefined) {
          stock = jsonLd.inStock;
        }

        return {
          productName,
          productPrice,
          productInStock: Number.isFinite(stock) ? stock : 0,
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
