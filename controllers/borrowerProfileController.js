const fs = require("fs");
const path = require("path");
const BorrowerProfile = require("../models/BorrowerProfile"); // Use BorrowerProfile model
const OTP = require("../models/OTP");

// Borrower registration
exports.registerBorrower = async (req, res) => {
  try {
    const { idNumber, fullName, phone, otp } = req.body;
    const userId = req.user._id;

    // 1️⃣ Validate required fields
    if (!idNumber || !fullName || !phone || !otp) {
      return res.status(400).json({ error: "All fields including OTP are required" });
    }

    // 2️⃣ Verify OTP
    const record = await OTP.findOne({ phone });
    if (!record) return res.status(400).json({ error: "OTP not found" });
    if (record.expiresAt < new Date()) return res.status(400).json({ error: "OTP expired" });
    if (record.otp !== otp) return res.status(400).json({ error: "Invalid OTP" });

    await OTP.deleteOne({ phone }); // ✅ Delete OTP after success

    // 3️⃣ Validate files
    const files = req.files;
    if (!files?.frontID || !files?.backID || !files?.livePhoto) {
      return res.status(400).json({ error: "Front ID, Back ID, and Live Photo are required" });
    }

    // 4️⃣ Save files locally
    const saveFileLocally = async (field, baseName) => {
      const f = files[field]?.[0];
      if (!f) return null;
      const ext = path.extname(f.originalname) || ".jpg";
      const dir = path.join("uploads", "borrowers", userId.toString());
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${baseName}${ext}`);
      fs.writeFileSync(filePath, f.buffer);
      return filePath;
    };

    const frontIDUrl = await saveFileLocally("frontID", "frontID");
    const backIDUrl = await saveFileLocally("backID", "backID");
    const livePhotoUrl = await saveFileLocally("livePhoto", "livePhoto");

    // 5️⃣ Check if phone already exists
    const phoneExists = await BorrowerProfile.findOne({ phone });
    if (phoneExists) {
      return res.status(409).json({ error: "Phone number already registered" });
    }

    // 6️⃣ Check if ID number already exists
    const idExists = await BorrowerProfile.findOne({ idNumber });
    if (idExists) {
      return res.status(409).json({ error: "ID number already registered" });
    }

    // 7️⃣ Save borrower profile to DB and mark as verified
    const profile = new BorrowerProfile({
      userId,
      fullName,
      phone,
      idNumber,
      frontID: frontIDUrl,
      backID: backIDUrl,
      livePhoto: livePhotoUrl,
      isVerified: true // ✅ Mark verified immediately
    });

    await profile.save();

    res.status(201).json({
      message: "Borrower profile registered and verified successfully",
      profile
    });

  } catch (error) {
    console.error("Error registering borrower profile:", error);



    res.status(500).json({ error: "Error registering borrower profile" });
  }
};


exports.getAllBorrowers = async (req, res) => {
  try {
    const borrowers = await BorrowerProfile.find().sort({ createdAt: -1 });

    res.status(200).json({
      count: borrowers.length,
      data: borrowers
    });
  } catch (error) {
    console.error("Error fetching borrowers:", error);
    res.status(500).json({ error: "Error fetching borrower profiles" });
  }
};