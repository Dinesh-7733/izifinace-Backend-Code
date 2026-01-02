// const { defineSecret } = require("firebase-functions/params");

// // Define all secrets here once
// const secrets = {
//   MPESA_CONSUMER_KEY: defineSecret("MPESA_CONSUMER_KEY"),
//   MPESA_CONSUMER_SECRET: defineSecret("MPESA_CONSUMER_SECRET"),
//   MPESA_SHORTCODE: defineSecret("MPESA_SHORTCODE"),
//   MPESA_ENV: defineSecret("MPESA_ENV"),
//   MPESA_CONFIRM_URL: defineSecret("MPESA_CONFIRM_URL"),
//   MPESA_VALIDATE_URL: defineSecret("MPESA_VALIDATE_URL")
// };

// // Helper function to get value
// exports.getSecret = async (name) => {
//   if (!secrets[name]) throw new Error(`Secret ${name} not defined`);
//   return (await secrets[name].value()) || "";
// };

// exports.allSecrets = secrets;
