const multer = require("multer");
const stream = require("stream");

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

function firebaseSafeUpload(fields) {
  return (req, res, next) => {
    if (req.rawBody) {
      const bufferStream = new stream.PassThrough();
      bufferStream.end(req.rawBody);
      req.pipe = bufferStream.pipe.bind(bufferStream); 
    }

    upload.fields(fields)(req, res, next);
  };
}

module.exports = firebaseSafeUpload;
