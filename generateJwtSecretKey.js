const crypto = require('crypto');

const generateJwtSecretKey = () => {
  return crypto.randomBytes(32).toString('hex');
};

const jwtSecretKey = generateJwtSecretKey();
console.log('JWT Secret Key:', jwtSecretKey);