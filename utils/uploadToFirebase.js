const path = require("path");
const bucket = require("../config/firebase");

/**
 * Upload file to Firebase Storage
 * @param {Object} file - multer file object
 * @param {String} baseName - name to store file as in bucket
 * @param {String} folder - optional folder name (e.g. "borrowers" or "lenders")
 * @returns {Promise<String|null>} - public URL of uploaded file
 */
const uploadToFirebase = async (file, baseName, folder = "borrowers") => {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);

    const ext = path.extname(file.originalname) || ".jpg";
    const fileName = `${folder}/${baseName}_${Date.now()}${ext}`;
    const fileUpload = bucket.file(fileName);

    const stream = fileUpload.createWriteStream({
      metadata: { contentType: file.mimetype },
    });

    stream.on("error", (err) => reject(err));
    stream.on("finish", async () => {
      try {
        await fileUpload.makePublic();
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        resolve(publicUrl);
      } catch (err) {
        reject(err);
      }
    });

    stream.end(file.buffer);
  });
};

module.exports = uploadToFirebase;
