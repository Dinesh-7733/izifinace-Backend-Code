// app.js
require("dotenv").config();
require("./utils/cron/loanCron.js");
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const { ensureRedis } = require('./utils/redis');

// Initialize Express App
const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors({ origin: true }));

// Health check route
app.get("/ping", (req, res) => res.send("pong"));

// Routes registration (after DB and Redis init below)

// Global Error Handling Middleware (registered after routes below as well)

// One-time startup: DB and Redis
(async () => {
  try {
    await connectDB();
    await ensureRedis();

    // Routes
    app.use("/api/auth", require("./routes/authRoutes"));
    app.use("/api/wallet", require("./routes/walletRoutes"));
    app.use("/api/loans", require("./routes/loanRoutes"));
    app.use("/api/customers", require("./routes/customerRoutes"));
    app.use("/api/suggestions", require("./routes/suggestionRoutes"));
    app.use("/ussd", require("./routes/ussdRoutes"));
    app.use("/api/mpesa", require("./routes/mpesaCallbackRoutes"));
    app.use("/api/transactions", require("./routes/transactionRoutes"));
    app.use("/api/stats", require("./routes/statsRoutes"));
    app.use("/api/profile", require("./routes/profileRoutes"));
    // app.use("/api/borrowers-profile", require("./routes/borrowerRoutes"));
    app.use("/api/reminder", require("./routes/reminderRoutes.js") );
    app.use("/api/customer", require("./routes/profileRoutes"));
    app.use("/api/notifications", require("./routes/notificationRoutes"));
    app.use("/api/otp", require("./routes/otpRoutes"));
    app.use("/api", require("./routes/activityRoutes"));
    app.use("/api/auth/borrower", require("./routes/borrowerauthRouter.js"));
    app.use("/api/agent", require("./routes/agentRoutes.js"));
    app.use("/api/lender",require("./routes/lenderRoutes.js"))
    // 404 handler
    app.use((req, res, next) => {
      res.status(404).json({ message: "API Route Not Found" });
    });

    // Error handler
    app.use((err, req, res, next) => {
      console.error("Error encountered:");
      console.error("Message:", err.message);
      console.error("Stack:", err.stack);
      console.error("Request Headers:", JSON.stringify(req.headers, null, 2));
      console.error("Request Body:", JSON.stringify(req.body, null, 2));
      console.error("Request URL:", req.originalUrl);
      res.status(500).json({ message: "Internal Server Error" });
    });
  } catch (e) {
    console.error("Startup error:", e);
  }
})();

module.exports = { app };


