require("dotenv").config();

module.exports = {
  // Consumer key for the MPESA API
  consumerKey: process.env.CONSUMER_KEY,

  // Consumer secret for the MPESA API
  consumerSecret: process.env.CONSUMER_SECRET,

  // Shortcode for Lipa na M-PESA online payments
  lipaNaMpesaOnlineShortcode: process.env.LIPA_NA_MPESA_ONLINE_SHORTCODE,

  // Security credential for authentication
  securityCredential: process.env.SECURITY_CREDENTIAL,

  // Initiator name for M-PESA transactions
  initiatorName: process.env.INITIATOR_NAME,

  // Base URL for the M-PESA API
  baseUrl: process.env.NODE_ENV === 'production' 
    ? 'https://api.safaricom.co.ke'  // Production base URL
    : 'https://sandbox.safaricom.co.ke', // Sandbox base URL

   // Optional: Define timeouts or other configuration settings
   QueueTimeOutURL: `${process.env.QUEUE_TIMEOUT_URL || ' https://api-xolqbxlejq-uc.a.run.app'}/b2b/queue`, // Queue timeout URL
   ResultURL: `${process.env.RESULT_URL || ' https://api-xolqbxlejq-uc.a.run.app'}/b2b/result`, // Result URL
 };
