// middleware/timeoutHandler.js
const timeoutHandler = (req, res, next) => {
  // Set timeout for multipart requests (2 minutes)
  req.setTimeout(120000, () => {
    console.log('Request timeout occurred');
  });
  
  res.setTimeout(120000, () => {
    console.log('Response timeout occurred');
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        message: 'Request timeout. Please try again.'
      });
    }
  });
  
  next();
};

module.exports = timeoutHandler;