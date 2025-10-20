// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('express-async-handler');
const config = require('../config/config');
const customer = require('../models/customer');
const AgentModel = require('../models/AgentModel');


// Protect routes, role-based
// Protect routes and attach user/agent
const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    try {
      token = req.headers.authorization.split(" ")[1];

      // Verify token
      const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);

      // Get id from token payload (supports multiple keys)
      const id = decoded.sub || decoded.id || decoded.userId || decoded.agentId;
      if (!id) {
        return res.status(401).json({ message: "Invalid token payload" });
      }

      // Find user first
      let user = await User.findById(id).select("-password");

      // If no user, check agent
      if (!user) user = await AgentModel.findById(id).select("-password");

      if (!user) return res.status(401).json({ message: "User/Agent not found" });

      req.user = user;              // Attach to request
      req.role = user.role || "agent"; // Save role for convenience

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
      const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);

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
      const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);

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



