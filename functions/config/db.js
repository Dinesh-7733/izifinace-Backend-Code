// config/db.js
const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGO_URI?.trim();

  if (!uri) {
    console.warn('⚠️ MONGO_URI not set; skipping MongoDB connection initialization.');
    return;
  }

  // Already connected
  if (mongoose.connection.readyState === 1) {
    return;
  }

  try {
    // Use unified topology and modern options
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    // Optional: Retry once after a short delay
    await new Promise((res) => setTimeout(res, 1000));
    try {
      await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
      console.log('✅ MongoDB connected on retry');
    } catch (retryErr) {
      console.error('❌ MongoDB retry failed:', retryErr.message);
      throw retryErr;
    }
  }
};

module.exports = connectDB;
