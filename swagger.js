const swaggerAutogen = require('swagger-autogen')();

const outputFile = './swagger_output.json';
const endpointsFiles = ['./src/Routes/ProductRoute.js'];

const doc = {
  info: {
    version: '1.0.0',
    title: 'ali-automation-test',
    description: 'Automated test example of aliexpress.com website',
  },
  host: 'localhost:8080',
  basePath: '/',
  schemes: ['http'],
  produces: ['application/json'],
  tags: [
    {
      name: 'Products',
      description: 'Endpoints',
    },
  ],
};

swaggerAutogen(outputFile, endpointsFiles, doc);
