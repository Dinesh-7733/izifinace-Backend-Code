const admin = require("firebase-admin");
const { getStorage } = require("firebase-admin/storage");
const { Writable } = require("stream");

// Required environment vars
const requiredEnv = ["PROJECT_ID", "CLIENT_EMAIL", "FB_PRIVATE_KEY", "STORAGE_BUCKET"];
const missing = requiredEnv.filter((key) => !process.env[key]?.trim());

let bucket;
const configured = missing.length === 0;

if (!configured) {
  console.warn(`⚠️ Firebase Storage NOT configured. Missing: ${missing.join(", ")}`);

  // Safe No-Op Writable Stream
  const noopStream = () => {
    const sink = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    process.nextTick(() => sink.emit("finish"));
    return sink;
  };

  bucket = {
    name: "unconfigured-storage",
    isConfigured: false,
    file: () => ({
      createWriteStream: noopStream,
      makePublic: async () => {},
    }),
  };

} else {
  const serviceAccount = {
    type: "service_account",
    project_id: process.env.PROJECT_ID.trim(),
    client_email: process.env.CLIENT_EMAIL.trim(),

    // 🔥 FIX: Convert \n to real newlines
    private_key: process.env.FB_PRIVATE_KEY.replace(/\\n/g, "\n").trim(),
  };

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.STORAGE_BUCKET.trim(),
    });
  }

  bucket = getStorage().bucket(process.env.STORAGE_BUCKET.trim());
  bucket.isConfigured = true;
}

module.exports = bucket;
