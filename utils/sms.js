const africastalking = require("africastalking");
const { normalizeToE164 } = require("./phone");

const AT = africastalking({
  apiKey: process.env.AT_API_KEY,
  username: process.env.AT_USERNAME,
});

const sms = AT.SMS;

exports.sendSMS = async (phoneNumber, message) => {
  try {
    // ✅ Normalize phone before sending
    const normalizedPhone = normalizeToE164(phoneNumber, "KE");

    if (!normalizedPhone) {
      throw new Error(`Invalid phone number format: ${phoneNumber}`);
    }

    console.log("Sending SMS ->", normalizedPhone, message);

    const response = await sms.send({
      to: [normalizedPhone],   // AfricasTalking expects array
      message,
      from: process.env.AT_SENDER_ID || undefined,
    });

    console.log("SMS Response:", JSON.stringify(response, null, 2));
    return response;
  } catch (error) {
    console.error("Error sending SMS:", error.message);
    throw error;
  }
};
