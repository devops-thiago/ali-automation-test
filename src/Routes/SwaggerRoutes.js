const swaggerUi = require('swagger-ui-express');
const swaggerFile = require('../../swagger_output.json');
module.exports = (app) => {
  app.use('/doc', swaggerUi.serve, swaggerUi.setup(swaggerFile));
};
