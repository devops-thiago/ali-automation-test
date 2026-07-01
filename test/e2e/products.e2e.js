/*
 * Live end-to-end scraping tests. These drive the REAL Playwright scraper
 * against aliexpress.com and therefore require:
 *   - Chromium installed (`npx playwright install chromium`)
 *   - Network egress to aliexpress.com
 *
 * They are NOT part of the default `npm test` (which is mocked) and do not gate
 * CI. Run locally or on a scheduled job:  `npm run test:e2e`
 *
 * If aliexpress is unreachable (egress blocked / bot challenge), the tests are
 * skipped with a clear message rather than failing the suite.
 */
const chai = require('chai');
const ProductScraper = require('../../src/Services/ProductScraper');

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
        } catch (e) {
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
        // eslint-disable-next-line no-console
        console.log('Sample product:', JSON.stringify(result.products[0]));
    });
});
