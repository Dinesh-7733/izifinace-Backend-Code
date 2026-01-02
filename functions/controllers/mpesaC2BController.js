// controllers/c2bController.js
const mongoose = require("mongoose");
const Loan = require("../models/Loan");
const Transaction = require("../models/Transaction");
const Customer = require("../models/customer");
const { sendSMS } = require("../utils/sms");
const User = require("../models/User");
const Notification = require("../models/Notification");

// functions/controllers/mpesaC2B.controller.js
const axios = require("axios");
const { getMpesaToken } = require("../utils/mpesaC2BService");
const AgentCommission = require("../models/AgentCommission");
const AgentModel = require("../models/AgentModel");
const Profile = require("../models/Profile");

exports.registerC2B = async (req, res) => {
  try {
    const token = await getMpesaToken();

    const mode = (global.config.mpesaEnv || "sandbox")
      .trim()
      .toLowerCase();

    const url =
      mode === "live"
        ? "https://api.safaricom.co.ke/mpesa/c2b/v2/registerurl"
        : "https://sandbox.safaricom.co.ke/mpesa/c2b/v2/registerurl";

    // 🔥 Hardcoded fallback URLs
    const fallbackValidateUrl =
      "https://api-qqxc6zwzmq-uc.a.run.app/api/c2b/validate";

    const fallbackConfirmUrl =
      "https://api-qqxc6zwzmq-uc.a.run.app/api/c2b/confirm";

    // 🔥 Use secret → otherwise fallback
    const shortCode = (global.config.mpesaShortcode || "").trim();
    const validateUrl =
      (global.config.mpesaC2bValidateUrl || fallbackValidateUrl).trim();
    const confirmUrl =
      (global.config.mpesaC2bConfirmUrl || fallbackConfirmUrl).trim();

    // ---- Validations ----
    if (!shortCode || shortCode.length < 5) {
      return res.status(400).json({
        success: false,
        message: `Shortcode is invalid or missing. Got: "${shortCode}"`,
      });
    }

    if (!confirmUrl.startsWith("https://")) {
      return res.status(400).json({
        success: false,
        message: `Confirmation URL must be HTTPS. Got: "${confirmUrl}"`,
      });
    }

    if (!validateUrl.startsWith("https://")) {
      return res.status(400).json({
        success: false,
        message: `Validation URL must be HTTPS. Got: "${validateUrl}"`,
      });
    }

    const payload = {
      ShortCode: shortCode,
      ResponseType: "Completed",
      ConfirmationURL: confirmUrl,
      ValidationURL: validateUrl,
    };

    console.log("📌 Registering C2B with:", {
      mode,
      url,
      payload,
    });

    const { data } = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 20000,
    });

    return res.json({
      success: true,
      message: "C2B URLs Registered Successfully",
      environment: mode.toUpperCase(),
      registered: {
        ShortCode: shortCode,
        ConfirmationURL: confirmUrl,
        ValidationURL: validateUrl,
      },
      safaricomResponse: data,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Register Error:", err.response?.data || err.message);

    return res.status(500).json({
      success: false,
      message: "Failed to register C2B URLs",
      environment: global.config.mpesaEnv,
      error: err.response?.data || err.message,
    });
  }
};



// ---------------- VALIDATION ----------------
exports.validationHandler = async (req, res) => {
  try {
    console.log("📩 Validation Callback:", req.body);

    const billRefNumber = (req.body?.BillRefNumber || "").trim();
    const amount = Number(req.body?.TransAmount || 0);

    if (!billRefNumber) {
      return res.status(200).json({
        ResultCode: 1,
        ResultDesc: "Missing BillRefNumber",
      });
    }

    // 1️⃣ Find Customer by National ID
    const customer = await Customer.findOne({ idNumber: billRefNumber });

    // -------------------------
    // CUSTOMER NOT FOUND
    // -------------------------
    if (!customer) {
      console.warn("⚠️ Customer not found. No SMS sent (MSISDN is hashed).");

      return res.status(200).json({
        ResultCode: 0,  // Always ACCEPT money
        ResultDesc: "Customer not found — Payment accepted"
      });
    }

    // 2️⃣ Find Loan linked to this customer and ID
    const loan = await Loan.findOne({
      borrowerId: customer._id,
      status: { $in: ["active", "overdue"] },
      billRefNumber: billRefNumber
    });

    // -------------------------
    // LOAN NOT FOUND
    // -------------------------
    if (!loan) {
      console.warn("⚠️ Loan not found for this customer");

      await sendSMS(
        customer.phone,
        `Thank you ${customer.fullName} for making a payment to IziFinance. No active loan was found. Please contact support to confirm your balance.`
      );

      return res.status(200).json({
        ResultCode: 0, // STILL accept payment
        ResultDesc: "Loan not found — Payment accepted"
      });
    }

    // -------------------------
    // LOAN FOUND → VALIDATION SUCCESS
    // -------------------------
    await sendSMS(
      customer.phone,
      `Hello ${customer.fullName}, your payment of KES ${amount} has been validated successfully.`
    );

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Validation Passed"
    });

  } catch (error) {
    console.error("❌ Validation Error:", error);
    return res.status(200).json({
      ResultCode: 1,
      ResultDesc: "Server Error"
    });
  }
};






// ---------------- CONFIRMATION ----------------
const handleAgentFullRepaymentCommission = async (loan, transaction, session) => {
  try {
    const FIXED_REPAYMENT_COMMISSION = 100;

    const existingCommission = await AgentCommission.findOne({
      agentId: loan.requestedByAgentId,
      loanId: loan._id,
      commissionType: "full_repayment",
    }).session(session);

    if (existingCommission) return;

    const commission = new AgentCommission({
      agentId: loan.requestedByAgentId,
      loanId: loan._id,
      commissionType: "full_repayment",
      amount: FIXED_REPAYMENT_COMMISSION,
      status: "earned",
      transactionId: transaction._id,
      earnedAt: new Date(),
    });

    await commission.save({ session });

    // Add to agent wallet
    const agent = await AgentModel.findById(loan.requestedByAgentId).session(session);
    if (agent) {
      agent.walletBalance += FIXED_REPAYMENT_COMMISSION;
      await agent.save({ session });
    }

  } catch (error) {
    console.error("❌ Error handling agent full repayment commission:", error);
  }
};

exports.confirmationHandler = async (req, res) => {
  console.log("💰 Payment Confirmation Callback:", req.body);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const BillRefNumber = req.body?.BillRefNumber?.trim();
    const Amount = Number(req.body?.TransAmount) || 0;
    const MpesaTransactionId = req.body?.TransID;

    if (!BillRefNumber || !Amount) {
      return res.status(200).json({
        ResultCode: 1,
        ResultDesc: "Missing BillRef or Amount"
      });
    }

    // 1️⃣ FIND CUSTOMER
    const customer = await Customer.findOne({ idNumber: BillRefNumber }).session(session);

    if (!customer) {
      console.warn("⚠️ Customer not found. NO SMS sent (MSISDN is hashed in sandbox).");

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: "Customer not found – Payment accepted"
      });
    }

    // 2️⃣ FIND LOAN FOR THIS CUSTOMER
    const loan = await Loan.findOne({
      borrowerId: customer._id,
      status: { $in: ["active", "overdue"] },
      billRefNumber: BillRefNumber
    }).session(session);

    // 3️⃣ IF LOAN NOT FOUND → SEND SMS TO CUSTOMER
    if (!loan) {
      console.warn("⚠️ Loan not found for this ID. Sending SMS to customer.");

      await sendSMS(
        customer.phone,
        `Thank you ${customer.fullName} for your payment to IziFinance. No active loan was found. Please contact support to confirm your balance.`
      );

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: "Loan not found – Payment accepted"
      });
    }

    // 4️⃣ LOAN FOUND → PROCESS REPAYMENT
    loan.repaidAmount += Amount;
    loan.balance -= Amount;

    let fullyPaid = false;

    if (loan.balance <= 0) {
      loan.balance = 0;
      loan.status = "fully paid";
      fullyPaid = true;

      if (loan.requestedByAgentId) {
        await handleAgentFullRepaymentCommission(
          loan,
          { _id: MpesaTransactionId },
          session
        );
      }
    }

    loan.repayments.push({
      amount: Amount,
      date: new Date(),
      transactionId: MpesaTransactionId
    });

    await loan.save({ session });

    // Update lender
    const lender = await User.findById(loan.lenderId).session(session);
    if (lender) {
      lender.walletBalance += Amount;
      await lender.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    // 5️⃣ SEND SUCCESS SMS TO CUSTOMER
    await sendSMS(
      customer.phone,
      `Dear ${customer.fullName}, your repayment of KES ${Amount} was received. Remaining balance: KES ${loan.balance}. Ref: ${MpesaTransactionId}`
    );

    // 6️⃣ SEND SMS TO LENDER
    if (lender) {
      await sendSMS(
        lender.phone,
        `💰 Repayment received from ${customer.fullName}. Amount: KES ${Amount}. New balance: KES ${loan.balance}.`
      );
    }

    // 7️⃣ AGENT NOTIFICATION IF FULLY PAID
    if (fullyPaid && loan.requestedByAgentId) {
      const agent = await AgentModel.findById(loan.requestedByAgentId);
      await sendSMS(
        agent.phone,
        `🎉 Borrower ${customer.fullName} has fully repaid their loan. Your commission has been recorded.`
      );
    }

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Payment processed successfully"
    });

  } catch (error) {
    console.error("❌ Confirmation Error:", error);

    await session.abortTransaction();
    session.endSession();

    return res.status(200).json({
      ResultCode: 1,
      ResultDesc: "Transaction failed"
    });
  }
};






// ---------------- SIMULATION ----------------
exports.simulatePayment = async (req, res) => {
  try {
    const token = await getMpesaToken();

    const url = "https://sandbox.safaricom.co.ke/mpesa/c2b/v2/simulate";

    const payload = {
      ShortCode: global.config.mpesaShortcode,
      BillRefNumber: req.body.billRef || "TEST123",
      Amount: req.body.amount || "10",
      Msisdn: req.body.phone || "254708374149",
      CommandID: "CustomerPayBillOnline",
    };

    const { data } = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}` },
    });

    return res.json({ success: true, message: "Simulation Sent", safaricom: data });
  } catch (err) {
    console.error("Simulation Error:", err.response?.data || err.message);
    return res.status(500).json({ success: false, error: err.response?.data || err.message });
  }
};




