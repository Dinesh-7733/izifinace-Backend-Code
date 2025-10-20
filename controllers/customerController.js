
const OTP = require("../models/OTP");
const User = require("../models/User");
const Borrower = require("../models/customer")

const path = require("path");
const Profile = require("../models/Profile");
const Transaction = require("../models/Transaction")
const Loan = require("../models/Loan");
const CustomerProfile = require("../models/BorrowerProfile");
const bucket = require("../config/firebase");



// Upload to Firebase Storage
const uploadToFirebase = async (file,  baseName) => {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);

    const ext = path.extname(file.originalname) || ".jpg";
    const fileName = `borrowers/${baseName}${ext}`;
    const fileUpload = bucket.file(fileName);

    const stream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
      },
    });

    stream.on("error", (err) => reject(err));
    stream.on("finish", async () => {
      // Make file public
      await fileUpload.makePublic();
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      resolve(publicUrl);
    });

    stream.end(file.buffer);
  });
};


// **Send OTP**
exports.sendOtp = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000);
    console.log(`OTP for ${phone}:`, otp);

    // Set expiry time (5 minutes from now)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Upsert OTP in MongoDB (insert new or update existing)
    await OTP.findOneAndUpdate(
      { phone },
      { otp, expiresAt },
      { upsert: true, new: true }
    );

    // TODO: Send OTP via SMS provider here (e.g., Africa's Talking)

    res.status(200).json({ message: "OTP sent successfully", otp });
  } catch (error) {
    console.error("Error sending OTP:", error);
    res.status(500).json({ error: "Failed to send OTP" });
  }
};



// **Register Customer**

exports.registerCustomer = async (req, res) => {
  try {
    const {
      fullName,
      phone,
      idNumber,
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
      savingsBalance,
    
    } = req.body;

    // ✅ Validate required fields
    if (!fullName || !phone || !idNumber || !req.files?.livePhoto) {
      return res.status(400).json({ message: "Full name, phone, ID number, and live photo are required." });
    }






    // ✅ Check duplicates
    if (await Borrower.findOne({ phone })) {
      return res.status(409).json({ message: "Phone number already registered." });
    }
    if (await Borrower.findOne({ idNumber })) {
      return res.status(409).json({ message: "ID number already registered." });
    }

    // ✅ Upload files to Firebase
    const livePhotoUrl = await uploadToFirebase(req.files.livePhoto[0], "livePhoto");
    const frontIDUrl = await uploadToFirebase(req.files.frontID[0], "frontID");
    const backIDUrl = await uploadToFirebase(req.files.backID[0], "backID");

    // ✅ Create customer
    const customer = new Borrower({
      registeredBy: req.user._id,
      registeredByModel: req.user.role === "agent" ? "Agent" : "User", // dynamically
      agentId: req.user.role === "agent" ? req.user._id : null, // only if agent
      fullName,
      phone,
      idNumber,
      livePhoto: livePhotoUrl,
      frontID: frontIDUrl,
      backID: backIDUrl,
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
      savingsBalance: savingsBalance || 0,
    });

    await customer.save();

    res.status(201).json({ message: "Customer registered successfully.", customer });
  } catch (error) {
    console.error("Error registering customer:", error);
    res.status(500).json({ message: "Server error while registering customer." });
  }
};

// exports.UpdateBorrowerProfile = async (req, res) => {
//   try {
//     const { customerId } = req.params;
//     const profileData = req.body;

//     // Ensure customer exists
//     const customer = await Borrower.findById(customerId);
//     if (!customer) {
//       return res.status(404).json({ message: "Customer not found" });
//     }

//     // Check if profile already exists
//     let profile = await CustomerProfile.findOne({ customer: customerId });

//     if (profile) {
//       // Update profile
//       profile.set(profileData);
//       await profile.save();
//       return res.json({ message: "Customer profile updated", profile });
//     } else {
//       // Create new profile
//       profile = new CustomerProfile({
//         customer: customerId,
//         ...profileData
//       });
//       await profile.save();
//       return res.status(201).json({ message: "Customer profile created", profile });
//     }
//   } catch (error) {
//     console.error("Error adding/updating profile:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };


// Controller to get all customers
exports.getAllCustomers = async (req, res) => {
  try {
    const customers = await Borrower.find()
      
      .sort({ createdAt: -1 }); // latest first

    if (!customers || customers.length === 0) {
      return res.status(404).json({ message: "No customers found" });
    }

    res.status(200).json({
      success: true,
      count: customers.length,
      customers,
    });
  } catch (err) {
    console.error("Error fetching customers:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};





exports.getCustomerWithProfile = async (req, res) => {
  try {
    const { id } = req.params; // use `id` instead of `customerId`

    // 1. Fetch customer core details
    const customer = await Borrower.findById(id).lean();
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // 2. Fetch profile (linked to customer)
    const profile = await CustomerProfile.findOne({ customer: id }).lean();

    // 3. Fetch loans
    const loans = await Loan.find({ borrowerId: id })
      .sort({ createdAt: -1 })
      .lean();

    // 4. Fetch transactions
    const transactions = await Transaction.find({ borrowerId: id })
      .sort({ date: -1 })
      .lean();

    // 5. Return everything in one response
    res.status(200).json({
      customer,
      profile: profile || null,
      loans,
      transactions,
    });
  } catch (error) {
    console.error("Error fetching customer details with profile:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// **Get Borrower's Savings Balance**
exports.getSavings = async (req, res) => {
  try {
    const { customerId } = req.params;
    const userId = req.user ? req.user._id : null; // Ensure JWT middleware is set up

    if (!customerId || !userId) {
      return res.status(400).json({ error: "Invalid request parameters" });
    }

    const customer = await Borrower.findOne({ userId: customerId });
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    if (customer.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.status(200).json({ savingsBalance: customer.savingsBalance });
  } catch (error) {
    console.error("Error fetching savings balance:", error);
    res.status(500).json({ message: "Error fetching savings balance" });
  }
};
