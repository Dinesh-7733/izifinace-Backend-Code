const busboy = require("@fastify/busboy");

const busboyMiddleware = (req, res, next) => {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    return res.status(400).json({ error: "Content-Type must be multipart/form-data" });
  }

  const bb = busboy({
    headers: req.headers,
    limits: { fileSize: 5 * 1024 * 1024, files: 3 }
  });

  const files = {};
  const fields = {};

  bb.on("file", (fieldname, file, info) => {
    const { filename, mimeType } = info;
    const chunks = [];

    file.on("data", (chunk) => chunks.push(chunk));
    file.on("end", () => {
      files[fieldname] = [
        {
          buffer: Buffer.concat(chunks),
          originalname: filename,
          mimetype: mimeType,
          size: Buffer.concat(chunks).length,
        },
      ];
    });
  });

  bb.on("field", (fieldname, val) => {
    fields[fieldname] = val;
  });

  bb.on("close", () => {
    req.files = files;
    req.body = fields;
    next();
  });

  bb.on("error", (err) => {
    console.error("❌ Busboy Error:", err);
    return res.status(400).json({
      error: "File upload failed",
      details: err.message,
    });
  });

  // IMPORTANT FOR FIREBASE
  if (!req.rawBody) {
    return res.status(400).json({
      error: "Missing rawBody — enable rawBody support in Firebase Functions",
    });
  }

  bb.end(req.rawBody);
};

module.exports = busboyMiddleware;
