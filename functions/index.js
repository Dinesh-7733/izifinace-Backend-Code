const functions = require('firebase-functions');
const { app } = require('../app');

// Export Express app as an HTTP function
exports.api = functions.https.onRequest(app);


