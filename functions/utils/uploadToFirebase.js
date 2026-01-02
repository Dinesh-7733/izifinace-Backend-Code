const path = require("path");
const bucket = require("../config/firebase"); 
// <-- this must export the initialized bucket

/**
 * Upload a file to Firebase Storage
 * @param {Object} file - multer file object
 * @param {String} baseName - clean base name
 * @param {String} folder - folder inside bucket (default: borrowers)
 * @returns {Promise<String|null>}
 */
const uploadToFirebase = async (file, baseName, folder = "borrowers") => {
  return new Promise(async (resolve, reject) => {
    try {
      if (!file) return resolve(null);

      // Check if storage is configured
      if (!bucket || !bucket.isConfigured) {
        console.warn("⚠️ Firebase Storage NOT configured. Skipping upload.");
        return resolve(null);
      }

      // Create unique filename
      const ext = path.extname(file.originalname) || ".jpg";
      const safeBase = baseName.replace(/[^a-zA-Z0-9_-]/g, "");
      const fileName = `${folder}/${safeBase}_${Date.now()}${ext}`;

      const fileRef = bucket.file(fileName);

      const stream = fileRef.createWriteStream({
        metadata: {
          contentType: file.mimetype,
        },
        resumable: false,
      });

      stream.on("error", (err) => {
        console.error("🔥 Firebase upload error:", err);
        reject(err);
      });

      stream.on("finish", async () => {
        try {
          // Make file public
          await fileRef.makePublic();

          const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

          resolve(publicUrl);
        } catch (err) {
          console.error("🔥 Error making file public:", err);
          reject(err);
        }
      });

      // Write buffer to Firebase Storage
      stream.end(file.buffer);
    } catch (err) {
      reject(err);
    }
  });
};

module.exports = uploadToFirebase;
