var process = require('process');
const express = require('express');
const cors = require('cors');
const app = express();
require('./src/Routes/index')(app);
app.use(cors());
app.use(express.json());
// start server on port 8080
app.listen(8080);

// proper handling signals
process.on('SIGINT', function onSigint() {
  process.exit(0);
});
process.on('SIGTERM', function onSigterm() {
  process.exit(0);
});

module.exports = app; // for testing
