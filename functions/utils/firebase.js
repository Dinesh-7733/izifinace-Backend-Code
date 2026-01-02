// firebase.js
const { initializeApp, cert } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');
const path = require('path');

// Path to your service account JSON
const serviceAccountPath = path.join(__dirname, 'config/firebase-service.json');

const serviceAccount = require(serviceAccountPath);

initializeApp({
  credential: cert(serviceAccount),
  storageBucket: 'your-project-id.appspot.com', // replace with your bucket name
});

const bucket = getStorage().bucket();

module.exports = bucket;
