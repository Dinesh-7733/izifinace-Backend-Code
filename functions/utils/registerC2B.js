// const axios = require("axios");
// const functions = require("firebase-functions/v2/https");
// const { logger } = require("firebase-functions");
// const { getSecret, allSecrets } = require("../utils/secrets");

// exports.registerC2B = functions.onRequest(
//   { secrets: Object.values(allSecrets) },
//   async (req, res) => {
//     try {
//       if (req.method !== "POST") {
//         return res.status(405).json({ error: "Only POST allowed." });
//       }

//       // Load secrets
//       const mpesaConsumerKey = (await getSecret("MPESA_CONSUMER_KEY")).trim();
//       const mpesaConsumerSecret = (await getSecret("MPESA_CONSUMER_SECRET")).trim();
//       const mpesaShortcode = (await getSecret("MPESA_SHORTCODE")).trim();
//       const mpesaEnv = (await getSecret("MPESA_ENV")).trim().toLowerCase();
//       const confirmUrl = (await getSecret("MPESA_CONFIRM_URL")).trim();
//       const validateUrl = (await getSecret("MPESA_VALIDATE_URL")).trim();

//       logger.info("🔍 LOADED SECRETS:", {
//         mpesaShortcode,
//         mpesaEnv,
//         confirmUrl,
//         validateUrl
//       });

//       if (!mpesaShortcode || !confirmUrl || !validateUrl) {
//         return res.status(400).json({
//           success: false,
//           message: "Missing C2B config values"
//         });
//       }

//       // Environment selection
//       const isSandbox = mpesaEnv === "sandbox";
//       const baseUrl = isSandbox
//         ? "https://sandbox.safaricom.co.ke"
//         : "https://api.safaricom.co.ke";

//       logger.info(`🌍 M-PESA ENVIRONMENT: ${mpesaEnv}`);
//       logger.info(`🔗 BASE URL: ${baseUrl}`);

//       // Get OAuth token
//       const auth = Buffer.from(`${mpesaConsumerKey}:${mpesaConsumerSecret}`).toString("base64");

//       logger.info("🔑 Requesting OAuth token...");

//       const tokenResponse = await axios.get(
//         `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
//         { headers: { Authorization: `Basic ${auth}` } }
//       );

//       const token = tokenResponse.data.access_token;
//       logger.info("🔓 OAuth Token Received.");

//       // Correct registration endpoint based on environment
//       const registerUrl = isSandbox
//         ? `${baseUrl}/mpesa/c2b/v1/registerurl`
//         : `${baseUrl}/mpesa/c2b/v2/registerurl`;

//       logger.info(`📡 Register URL: ${registerUrl}`);

//       // Send registration request
//       const mpesaResponse = await axios.post(
//         registerUrl,
//         {
//           ShortCode: mpesaShortcode,
//           ResponseType: "Completed",
//           ConfirmationURL: confirmUrl,
//           ValidationURL: validateUrl
//         },
//         {
//           headers: {
//             Authorization: `Bearer ${token}`,
//             "Content-Type": "application/json"
//           }
//         }
//       );

//       logger.info("🎯 C2B Registration Success:", mpesaResponse.data);

//       return res.json({
//         success: true,
//         environment: mpesaEnv,
//         result: mpesaResponse.data
//       });

//     } catch (error) {
//       logger.error("❌ REGISTRATION FAILED:", error.response?.data || error.message);

//       return res.status(500).json({
//         success: false,
//         error: error.response?.data || error.message
//       });
//     }
//   }
// );
