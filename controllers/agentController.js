const asyncHandler = require("express-async-handler");
const Borrower = require("../models/customer")
const bcrypt = require("bcryptjs");
const AgentModel = require("../models/AgentModel");
const { issueSession, signAccess } = require("../utils/tokens-redis");
const OTP = require("../models/OTP");
const uploadToFirebase = require("../utils/uploadToFirebase");

// @desc    Register a new agent (by lender)
// @route   POST /api/agents
// @access  Private (Lender only)






const registerAgent = async (req, res) => {
  try {
    const lenderId = req.user._id; // from protect middleware
    const { name, phone, password } = req.body;
    console.log("ph:",phone);
    
    if (!name || !phone || !password) {
      return res.status(400).json({ message: "Please provide name, phone, and password" });
    }

        // ✅ Password must be exactly 6 digits (numbers only)
    const passwordRegex = /^\d{6}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        message: "Password must be exactly 6 digits and contain only numbers (e.g., 123456)"
      });
    }
    // Only lenders can register agents
    if (req.user.role !== "lender") {
      console.log();
      
      return res.status(403).json({ message: "Only lenders can register agents" });
    }

    // Check if phone already exists
    const existingAgent = await AgentModel.findOne({ phone });
    if (existingAgent) {
      return res.status(400).json({ message: "Agent with this phone number already exists" });
    }
const plainPassword = password; // keep a copy
    // Create agent
    const agent = await AgentModel.create({
      lenderId,
      name,
      role:"agent",
      phone,
      password
    });

    if (agent) {
      return res.status(201).json({
        _id: agent._id,
        name: agent.name,
        phone: agent.phone,
        password: plainPassword ,// return it safely
        status: agent.status,
        totalCustomers: agent.totalCustomers,
        totalEarnings: agent.totalEarnings,
        role: agent.role
      });
    } else {
      return res.status(400).json({ message: "Invalid agent data" });
    }
  } catch (error) {
    console.error("Error registering agent:", error);
    return res.status(500).json({ message: "Server error while registering agent" });
  }
};




const changePassword = async (req, res) => {
  try {
    const agentId = req.agent._id; // <- use req.agent instead of req.user
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: "Please provide old and new password" });
    }

    // Find agent
    const agent = await AgentModel.findById(agentId);
    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }
if (!/^\d{6}$/.test(newPassword)) {
  return res.status(400).json({
    message: "New password must be exactly 6 digits and contain only numbers (e.g., 123456)"
  });
}
    // Check old password
    const isMatch = await agent.matchPassword(oldPassword);
    if (!isMatch) {
      return res.status(401).json({ message: "Old password is incorrect" });
    }

    // Update password (will be hashed automatically via pre-save)
    agent.password = newPassword;
    await agent.save();

    return res.status(200).json({ message: "Password changed successfully", newPassword: newPassword });
  } catch (error) {
    console.error("Error changing password:", error);
    return res.status(500).json({ message: "Server error while changing password" });
  }
};

const loginAgent = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ message: "Phone and password are required" });
    }

    // Find agent with password field
    const agent = await AgentModel.findOne({ phone }).select("+password");
    if (!agent) return res.status(401).json({ message: "Invalid credentials" });

    // Verify password
    const isMatch = await bcrypt.compare(password, agent.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    // Check agent status
    if (agent.status !== "Active") {
      return res.status(403).json({ message: "Agent is inactive. Contact lender." });
    }

    // Generate access token
    const accessToken = signAccess({ sub: agent._id.toString(), role: agent.role });

    // Generate refresh token (store in DB or session store)
    const { refreshToken } = await issueSession(agent._id.toString(), {
      ua: req.get("user-agent"),
      ip: req.ip
    });

    return res.status(200).json({
      message: "Login successful",
      accessToken,
      refreshToken,
      agent: {
        id: agent._id,
        name: agent.name,
        phone: agent.phone,
        role: agent.role
      }
    });
  } catch (err) {
    console.error("Agent login error:", err);
    return res.status(500).json({ message: "Error logging in" });
  }
};





const registerCustomer = async (req, res) => {
  try {
    const {
      idNumber,
      fullName,
      phone,
      dateOfBirth,
      gender,
      maritalStatus,
      altPhoneNumber,
      physicalAddress,
      gpsLocation,
      occupation,
      monthlyIncomeRange,
      nextOfKinName,
      nextOfKinPhone,
      preferredMobileMoney,
      savingsGoal,
      loanConsent,
      kraPin,
      agreementAcceptance,
      preferences,
      savingsBalance
    } = req.body;

    const registeredBy = req.user._id;
    const registeredByModel = req.user.role === "agent" ? "Agent" : "User";

    // ✅ Role check (extra safety)
    if (!["agent", "lender", "admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied: cannot register customer" });
    }

    // ✅ Validate required fields
    if (!idNumber || !fullName || !phone ) {
      return res.status(400).json({ error: "FullName, ID number, phone, and OTP are required" });
    }



    // ✅ Validate files
    const files = req.files;
    if (!files?.frontID || !files?.backID || !files?.livePhoto) {
      return res.status(400).json({ error: "Front ID, Back ID, and Live Photo are required" });
    }

    // ✅ Upload files to Firebase
    const frontIDUrl = await uploadToFirebase(files.frontID[0], "frontID");
    const backIDUrl = await uploadToFirebase(files.backID[0], "backID");
    const livePhotoUrl = await uploadToFirebase(files.livePhoto[0], "livePhoto");

    // ✅ Check duplicates
    if (await Borrower.findOne({ phone })) return res.status(409).json({ error: "Phone number already registered" });
    if (await Borrower.findOne({ idNumber })) return res.status(409).json({ error: "ID number already registered" });

    // ✅ Create customer
    const customer = new Borrower({
      registeredBy,
      registeredByModel,          // dynamic model
      agentId: req.user.role === "agent" ? registeredBy : null, // only if agent
      fullName,
      phone,
      idNumber,
      frontID: frontIDUrl,
      backID: backIDUrl,
      livePhoto: livePhotoUrl,
      isVerified: true,
      dateOfBirth,
      gender,
      maritalStatus,
      altPhoneNumber,
      physicalAddress,
      gpsLocation,
      occupation,
      monthlyIncomeRange,
      nextOfKinName,
      nextOfKinPhone,
      preferredMobileMoney,
      savingsGoal,
      loanConsent,
      kraPin,
      agreementAcceptance,
      preferences: preferences || {},
      savingsBalance: savingsBalance || 0
    });

    await customer.save();

    // ✅ If agent, update their customers array
    if (req.user.role === "agent") {
      const agent = await AgentModel.findById(registeredBy);
      if (agent) await agent.addCustomer(customer._id);
    }

    res.status(201).json({
      message: "Customer registered and verified successfully",
      customer
    });

  } catch (error) {
    console.error("Error registering customer:", error);
    res.status(500).json({ error: "Error registering customer" });
  }
};



const getAgentProfile = asyncHandler(async (req, res) => {
  // req.user is set by your 'protect' middleware
  const agent = await AgentModel.findById(req.user._id)
    .select("-password") // exclude password
    .populate("customers"); // populate all customer fields if needed

  if (!agent) {
    return res.status(404).json({ message: "Agent not found" });
  }

  res.status(200).json(agent); // return the whole agent object
});

module.exports = { registerAgent ,changePassword,loginAgent , registerCustomer ,getAgentProfile};
