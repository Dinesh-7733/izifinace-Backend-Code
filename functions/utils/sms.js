const africastalking = require("africastalking");
const { normalizeToE164 } = require("./phone");

// ------------------------------
// AfricasTalking SMS client
// ------------------------------
let smsClient = null;
let isSMSInitialized = false;

// Lazy initialize SMS client AFTER onInit sets global.config
const initSMS = () => {
  if (isSMSInitialized) return;

  const AT_USERNAME = (global.config?.atUsername || "").trim();
  const AT_API_KEY = (global.config?.atApiKey || "").trim();

  if (!AT_USERNAME || !AT_API_KEY) {
    console.warn("⚠️ AfricasTalking credentials missing; SMS disabled");
    isSMSInitialized = true;
    return;
  }

  try {
    const client = africastalking({
      apiKey: AT_API_KEY,
      username: AT_USERNAME,
    });

    smsClient = client.SMS;
    console.log("✅ AfricasTalking SMS client initialized");
  } catch (err) {
    console.error("❌ Failed to initialize AfricasTalking:", err);
  }

  isSMSInitialized = true;
};

// ------------------------------
// Send SMS function
// ------------------------------
exports.sendSMS = async (phoneNumber, message) => {
  try {
    if (!isSMSInitialized) initSMS();

    const normalizedPhone = normalizeToE164(phoneNumber, "KE");
    if (!normalizedPhone) throw new Error(`Invalid phone number: ${phoneNumber}`);

    console.log("📨 Sending SMS ->", normalizedPhone, message);

    if (!smsClient) {
      return { success: false, message: "SMS client not initialized" };
    }

    // Construct SMS payload
    const payload = {
      to: [normalizedPhone],
      message
    };

    // ONLY include sender ID if NOT sandbox and sender ID is valid
    const senderId = global.config.atSenderId?.trim();
    if (senderId && global.config.atUsername !== "sandbox") {
      payload.from = senderId;
    }

    const result = await smsClient.send(payload);

    console.log("📩 SMS Response:", JSON.stringify(result, null, 2));
    return result;

  } catch (e) {
    console.error("❌ Error sending SMS:", e);
    throw e;
  }
};
