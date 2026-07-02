const ProductRoute = require('./ProductRoute');
const SwaggerRoutes = require('./SwaggerRoutes');
module.exports = (app) => {
  ProductRoute(app);
  SwaggerRoutes(app);
};
