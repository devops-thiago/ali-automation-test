'use strict';

const ProductScraper = require('../Services/ProductScraper');

// Default singleton scraper. Tests inject a stub via setScraper() so the API
// layer can be exercised without touching the network or launching a browser.
let scraper = new ProductScraper();

exports.setScraper = (instance) => {
    scraper = instance;
};

exports.getProducts = (req, res) => {
    /**
     #swagger.start
     #swagger.path = '/products'
     #swagger.method = 'get'
     #swagger.tags = ['Products']
     #swagger.description = 'Paginated search for products'
     #swagger.parameters['term'] = {
        in: 'query',
        description: 'search term',
        type: 'string'
     }
     #swagger.parameters['page'] = {
       in: 'query',
       description: 'search page',
       type: 'string'
     }
     #swagger.responses[200] = {
       schema: {
         totalPages: 10,
         selectedPage: 1,
         products: [{
           id: "1",
           name: "some product",
           url: "product_url.html"
         }]
       },
       description: 'Products found.'
     }
     #swagger.end
     */
    (async () => {
        const term = req.query.term;
        const page = typeof req.query.page === 'undefined' ? 1 : req.query.page;
        if (!term) {
            return res.status(400).json({ error: "query parameter 'term' is required" });
        }
        try {
            const result = await scraper.searchProducts(term, page);
            res.json(result);
        } catch (e) {
            console.error('searchProducts failed:', e);
            res.status(502).json({ error: 'failed to retrieve products', detail: e.message });
        }
    })();
};

exports.getProductById = (req, res) => {
    /**
     #swagger.start
     #swagger.path = '/product/{id}'
     #swagger.method = 'get'
     #swagger.tags = ['Products']
     #swagger.description = 'Get Product by ID'
     #swagger.parameters['id'] = {
        description: 'product ID',
        type: 'string'
     }
     #swagger.responses[200] = {
       schema: {
         productName: "some product",
         productPrice: "US$ 1.00",
         productInStock: 200
       },
       description: 'Product found.'
     }
     #swagger.end
     */
    (async () => {
        try {
            const result = await scraper.getProductById(req.params.id);
            res.json(result);
        } catch (e) {
            console.error('getProductById failed:', e);
            res.status(502).json({ error: 'failed to retrieve product', detail: e.message });
        }
    })();
};
