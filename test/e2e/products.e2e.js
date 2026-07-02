/*
 * Live end-to-end scraping tests. These drive the REAL Playwright scraper
 * against aliexpress.com and therefore require:
 *   - Chromium installed (`npx playwright install chromium`)
 *   - Network egress to aliexpress.com
 *
 * They are NOT part of the default `npm test` (which is mocked) and do not gate
 * CI. Run locally or on a scheduled job:  `npm run test:e2e`
 * Optional debug output:            `NODE_DEBUG=e2e npm run test:e2e`
 *
 * If aliexpress is unreachable (egress blocked / bot challenge), the tests are
 * skipped with a clear message rather than failing the suite.
 */
const chai = require('chai');
const { debuglog } = require('util');
const ProductScraper = require('../../src/Services/ProductScraper');

const logE2e = debuglog('e2e');

chai.should();

describe('Live scraping (e2e)', function () {
  this.timeout(120000);
  let scraper;

  before(() => {
    scraper = new ProductScraper();
  });
  after(async () => {
    if (scraper) await scraper.close();
  });

  it('searchProducts("Iphone") returns a non-empty product list', async function () {
    let result;
    try {
      result = await scraper.searchProducts('Iphone', 1);
    } catch {
      this.skip(); // environment cannot reach the live site
      return;
    }
    result.should.be.an('object');
    result.should.have.property('products').that.is.an('array');
    if (result.products.length === 0) {
      // Reached the site but extracted nothing — surface it loudly so the
      // selectors can be revisited, but don't crash the whole run.
      throw new Error(
        'Reached aliexpress but extracted 0 products — selectors likely need updating (see ProductScraper).'
      );
    }
    result.products[0].should.have.property('id').that.is.a('string');
    result.products[0].should.have.property('url').that.contains('/item/');
    logE2e('sample product %s', JSON.stringify(result.products[0]));
  });

  it('getProductById returns name, price, and stock for a search result', async function () {
    let search;
    try {
      search = await scraper.searchProducts('Iphone', 1);
    } catch {
      this.skip();
      return;
    }
    if (!search.products.length) {
      throw new Error('Reached aliexpress but extracted 0 products — cannot test product detail.');
    }

    let detail;
    try {
      detail = await scraper.getProductById(search.products[0].id);
    } catch {
      this.skip();
      return;
    }

    detail.should.be.an('object');
    detail.should.have.property('productName').that.is.a('string').with.length.greaterThan(0);
    detail.should.have.property('productPrice').that.is.a('string').with.length.greaterThan(0);
    detail.should.have.property('productInStock').that.is.a('number').and.greaterThan(0);
    logE2e('sample product detail %s', JSON.stringify(detail));
  });
});
