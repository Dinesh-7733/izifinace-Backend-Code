// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('express-async-handler');
const config = require('../config/config');
const customer = require('../models/customer');
const AgentModel = require('../models/AgentModel');
const { defineSecret } = require("firebase-functions/params");

// Protect routes, role-based
// Protect routes and attach user/agent


const JWT_ACCESS_SECRET = defineSecret("JWT_ACCESS_SECRET");


const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = jwt.verify(token, JWT_ACCESS_SECRET.value());

      const id = decoded.sub || decoded.id || decoded.userId || decoded.agentId;
      if (!id) return res.status(401).json({ message: "Invalid token payload" });

      // ✅ REMOVED .select("-password") - now password will be included
      let user = await User.findById(id);
      if (!user) user = await AgentModel.findById(id);

      if (!user) return res.status(401).json({ message: "User/Agent not found" });

      // Always attach as req.user for consistency
      req.user = user;
      req.role = user.role;

      // Also attach specific role for backward compatibility
      if (user.role === "agent") {
        req.agent = user;
      } else if (user.role === "lender") {
        req.lender = user;
      }

      next();
    } catch (error) {
      console.error("Auth error:", error.message);
      return res.status(401).json({ message: "Not authorized, token failed" });
    }
  } else {
    return res.status(401).json({ message: "Not authorized, no token" });
  }
});
/**
 * Middleware for borrower authentication
 */
const borrowerProtect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    try {
      token = req.headers.authorization.split(" ")[1];
const decoded = jwt.verify(token, JWT_ACCESS_SECRET.value());

      const borrowerId = decoded.sub || decoded.borrowerId || decoded.id;
      if (!borrowerId) {
        return res.status(401).json({ success: false, message: "Invalid token payload" });
      }

      const borrower = await customer.findById(borrowerId).select("-password");
      if (!borrower) {
        return res.status(401).json({ success: false, message: "Borrower not found" });
      }

      req.borrower = borrower; // Attach borrower
      next();
    } catch (error) {
      console.error("Borrower Auth error:", error.message);
      return res.status(401).json({ success: false, message: "Not authorized, token failed" });
    }
  } else {
    return res.status(401).json({ success: false, message: "Not authorized, no token" });
  }
});


const agentProtect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    try {
      // Get token from header
      token = req.headers.authorization.split(" ")[1];

      // Verify token
const decoded = jwt.verify(token, JWT_ACCESS_SECRET.value());

      // Your tokens use `sub`; fallback to legacy fields
      const agentId = decoded.sub || decoded.agentId || decoded.id;
      if (!agentId) {
        return res.status(401).json({ success: false, message: "Invalid token payload" });
      }

      // Find agent in DB
      const agent = await AgentModel.findById(agentId).select("-password");
      if (!agent) {
        return res.status(401).json({ success: false, message: "Agent not found" });
      }

      req.agent = agent; // Attach agent to request
      next();
    } catch (error) {
      console.error("Agent Auth error:", error.message);
      return res.status(401).json({ success: false, message: "Not authorized, token failed" });
    }
  } else {
    return res.status(401).json({ success: false, message: "Not authorized, no token" });
  }
};


module.exports = { protect ,borrowerProtect ,agentProtect};



