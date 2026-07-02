process.env.NODE_ENV = 'test';

const chai = require('chai');
const chaiHttp = require('chai-http');
const { request } = require('chai-http');
const server = require('../server');
const ProductController = require('../src/Controllers/ProductController');

chai.use(chaiHttp.default);
chai.should();

// Deterministic fake scraper — the API layer is tested without launching a
// browser or hitting the network, so CI is fast and reliable.
const sampleProducts = [
  { id: '1005001', name: 'iPhone 15 case', url: 'https://www.aliexpress.com/item/1005001.html' },
  { id: '1005002', name: 'iPhone charger', url: 'https://www.aliexpress.com/item/1005002.html' },
];

const okScraper = {
  async searchProducts(term, page) {
    return { totalPages: 10, selectedPage: parseInt(page, 10) || 1, products: sampleProducts };
  },
  async getProductById() {
    return { productName: 'iPhone 15 case', productPrice: 'US$ 1.00', productInStock: 200 };
  },
};

describe('Products API (mocked scraper)', () => {
  beforeEach(() => ProductController.setScraper(okScraper));

  describe('GET /products', () => {
    it('returns the product list contract for a term', (done) => {
      request
        .execute(server)
        .get('/products')
        .query({ term: 'Iphone' })
        .end((err, res) => {
          res.should.have.status(200);
          res.body.should.be.an('object');
          res.body.should.have.property('totalPages').that.is.a('number');
          res.body.should.have.property('selectedPage').eq(1);
          res.body.should.have.property('products').that.is.an('array');
          res.body.products.length.should.be.gt(0);
          res.body.products[0].should.have.all.keys('id', 'name', 'url');
          done();
        });
    });

    it('honours the page query parameter', (done) => {
      request
        .execute(server)
        .get('/products')
        .query({ term: 'Iphone', page: 2 })
        .end((err, res) => {
          res.should.have.status(200);
          res.body.selectedPage.should.eq(2);
          done();
        });
    });

    it('returns 400 when term is missing', (done) => {
      request
        .execute(server)
        .get('/products')
        .end((err, res) => {
          res.should.have.status(400);
          res.body.should.have.property('error');
          done();
        });
    });

    it('returns 502 when the scraper fails', (done) => {
      ProductController.setScraper({
        async searchProducts() {
          throw new Error('boom');
        },
      });
      request
        .execute(server)
        .get('/products')
        .query({ term: 'Iphone' })
        .end((err, res) => {
          res.should.have.status(502);
          res.body.should.have.property('error');
          done();
        });
    });
  });

  describe('GET /product/:id', () => {
    it('returns product detail contract', (done) => {
      request
        .execute(server)
        .get('/product/1005001')
        .end((err, res) => {
          res.should.have.status(200);
          res.body.should.be.an('object');
          res.body.should.have.property('productName');
          res.body.should.have.property('productPrice');
          res.body.should.have.property('productInStock').that.is.a('number');
          res.body.productInStock.should.be.gt(0);
          done();
        });
    });
  });
});
