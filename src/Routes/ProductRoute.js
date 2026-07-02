const ProductController = require('../Controllers/ProductController');
module.exports = (app) => {
  app.get('/products', ProductController.getProducts);
  app.get('/product/:id', ProductController.getProductById);
};
