const Loan = require("../models/Loan");
const mongoose = require("mongoose");
const Customer = require("../models/customer");
const Transaction = require("../models/Transaction");
const { initiateB2C, initiateSTKPush } = require("../utils/mpesa"); // Import M-Pesa function
const { sendSMS } = require("../utils/sms");
const User = require("../models/User");
const asyncHandler = require("express-async-handler");
const { normalizeToE164 } = require("../utils/phone");
const Notification = require("../models/Notification");
const AgentModel = require("../models/AgentModel");
// Track loan repayment and send SMS
const AgentCommission = require('../models/AgentCommission');

// Helper: retry function for transient transaction errors
const runTransactionWithRetry = async (txnFunc, session, maxRetries = 3) => {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await txnFunc();
    } catch (err) {
      if (err.hasErrorLabel && err.hasErrorLabel("TransientTransactionError")) {
        attempt++;
        console.warn(`⚠️ Transaction conflict, retrying attempt ${attempt}`);
        continue; // retry
      }
      throw err;
    }
  }
  throw new Error("Transaction failed after retries");
};

exports.trackRepayment = async (req, res) => {
  try {
    const borrowerId = req.borrower._id;
    const { loanId, amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Amount is required and must be greater than zero" });
    }

    // Find borrower
    const borrower = await Customer.findById(borrowerId);
    if (!borrower) {
      return res.status(404).json({ message: "Borrower not found" });
    }

    // Find active loan
    const loan = await Loan.findOne({
      _id: loanId,
      borrowerId,
      status: { $ne: "fully paid" }
    });

    if (!loan) {
      return res.status(404).json({ message: "Loan not found or already fully repaid" });
    }

    // Normalize phone — preparing for STK push
    const rawPhone = borrower.phone || borrower.phoneNumber;
    const customerPhone = normalizeToE164(rawPhone, "KE");

    if (!customerPhone) {
      return res.status(400).json({ message: "Invalid phone number" });
    }

    // Prevent overpayment
    if (amount > loan.balance) {
      return res.status(400).json({
        message: `Repayment exceeds balance. Remaining balance: KES ${loan.balance}.`
      });
    }

    // Create reference for MPESA statement
    const accountRef = `${borrower.fullName}-${borrower.idNumber}-${borrower.phone}-Loan-${loan._id}`;

    // Create pending transaction
    const transaction = new Transaction({
      type: "repayment",
      userId: borrowerId,
      userModel: "Customer",
      loanId: loan._id,
      clientId: loan.clientId,
      phone: customerPhone,
      amount,
      accountReference: accountRef,
      balanceBefore: loan.balance,
      balanceAfter: loan.balance,
      status: "pending"
    });

    await transaction.save();

    /* -------------------------------------------------------
       LIVE MODE ONLY - Always STK — callback will finalize
    ------------------------------------------------------- */

    const stkResponse = await initiateSTKPush(customerPhone, amount, accountRef);

    // Save CheckoutRequestID for callback matching
    transaction.checkoutRequestID = stkResponse.CheckoutRequestID;
    await transaction.save();

    return res.status(200).json({
      message: "Repayment initiated. Complete the payment on your phone.",
      stkResponse,
      transaction
    });

  } catch (error) {
    console.error("❌ Error tracking repayment:", error);
    return res.status(500).json({ message: error.message });
  }
};


// Issue a new loan with M-Pesa disbursement
// Issue Loan
exports.issueLoan = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const lenderId = req.user._id;
    const { borrowerId, amount, totalInterest, duration, repaymentFrequency, phoneNumber } = req.body;

    // --- Validate input ---
    if (!borrowerId || !amount || !totalInterest || !duration || !repaymentFrequency || !phoneNumber) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "All fields are required" });
    }

    // --- Lender check ---
    const lender = await User.findById(lenderId).session(session);
    if (!lender) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Lender not found" });
    }
    if (lender.walletBalance < amount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Insufficient wallet balance" });
    }

    // --- Borrower check ---
    const borrower = await Customer.findById(borrowerId).session(session);
    if (!borrower) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Borrower not found" });
    }
 // --- Check if borrower already has an active/pending/overdue loan ---
    const existingLoan = await Loan.findOne({
      borrowerId,
      status: { $in: ["pending", "active", "overdue"] },
    }).session(session);

    if (existingLoan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `Borrower already has an existing loan (${existingLoan.status}). Only one loan can be active at a time.`,
      });
    }

    // --- Repayment calculation ---
    const totalRepayment = parseFloat(amount) + parseFloat(totalInterest);
    const numInstallments = duration * (repaymentFrequency === "weekly" ? 7 : repaymentFrequency === "monthly" ? 30 : 1);
    const dailyRepayment = totalRepayment / numInstallments;

    // --- Create Loan ---
    const loan = await Loan.create(
      [
        {
          lenderId,
          borrowerId,
          clientId: borrower.idNumber,
          fullName: borrower.fullName,
          phoneNumber,
          lenderPhone: lender.phone,
          amount,
          interest: parseFloat(totalInterest),
          fee: 0,
          totalRepayment,
          balance: totalRepayment,
          dailyRepayment,
          duration,
          dueDate: new Date(Date.now() + duration * 24 * 60 * 60 * 1000),
          status: "pending",
        },
      ],
      { session }
    );

    // --- Deduct lender wallet ---
    lender.walletBalance -= amount;
    await lender.save({ session });

    // --- Create Transaction ---
    const transaction = await Transaction.create(
      [
        {
          userId: lenderId,
          userModel:"User",
          loanId: loan[0]._id,
         type: "loan issued",
          amount,
          status: "pending",
          phone: phoneNumber,
          description: "Loan disbursement",
        },
      ],
      { session }
    );

    // --- Sandbox mode (simulate success) ---
    if (global.config.mpesaEnv === "sandbox")
 {


      transaction[0].status = "successful";
      await transaction[0].save({ session });

      loan[0].status = "active";
      await loan[0].save({ session });

      const normalizedPhone = normalizeToE164(phoneNumber, "KE");
      if (!normalizedPhone) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Invalid borrower phone number" });
      }

      // Send SMS to borrower
      await sendSMS(
        normalizedPhone,
        `✅ Hello ${borrower.fullName}, your loan of KES ${amount} has been issued.\nTotal repayment: KES ${totalRepayment}\nDaily: KES ${dailyRepayment.toFixed(
          2
        )}\nDue date: ${loan[0].dueDate.toDateString()}`
      );

      // Create Notification for lender
      await Notification.create(
        [
          {
            userId: lender._id,
            userModel: "User",   // 👈 Required for refPath
            title: "Loan Issued Successfully",
            message: `You have issued a loan of KES ${amount} to ${borrower.fullName}. Total repayment: KES ${totalRepayment}.`,
            type: "loan_approved",
          },
        ],
        { session }
      );
    }

// --- Create Notification for borrower
await Notification.create(
  [
    {
      userId: borrower._id,
        userModel: "Customer",   // 👈 Required for refPath
      // borrowerId: borrower._id,
      title: "Loan Issued",
      message: `✅ Hello ${borrower.fullName}, your loan of KES ${amount} has been issued. Total repayment: KES ${totalRepayment}. Due date: ${loan[0].dueDate.toDateString()}`,
      type: "loan",
    },
  ],
  { session }
);
    // --- Commit DB transaction ---
    await session.commitTransaction();
    session.endSession();

    // --- Return response ---
   if (global.config.mpesaEnv === "sandbox")
 {
      return res.status(201).json({
        message: "Loan issued successfully (sandbox mode)",
        loan: loan[0],
        transaction: transaction[0],
      });
    } else {
      // --- LIVE MODE ---
      const b2cResponse = await initiateB2C(phoneNumber, amount, transaction[0]._id);

      // Save Mpesa checkoutRequestID for callback mapping
      if (b2cResponse?.OriginatorConversationID) {
        transaction[0].checkoutRequestID = b2cResponse.OriginatorConversationID;
        await transaction[0].save();
      }

      return res.status(201).json({
        message: "Loan initiated successfully. Awaiting B2C confirmation.",
        loan: loan[0],
        transaction: transaction[0],
        b2cResponse,
      });
    }
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Error issuing loan:", error);
    return res.status(500).json({ message: "Error issuing loan", error: error.message });
  }
};

// GET borrower loans (excluding fully paid) by phone
exports.getActiveLoansByPhone = async (req, res) => {
  try {
    const borrower = req.borrower; // Already from token

    const loans = await Loan.find({
      borrowerId: borrower._id,
      status: { $ne: "fully paid" }
    }).sort({ dueDate: 1 });

    res.json({
      success: true,
      borrower: {
        id: borrower._id,
        fullName: borrower.fullName,
        phone: borrower.phone,
        isVerified: borrower.isVerified,
      },
      loans,
    });
  } catch (err) {
    console.error("getActiveLoansByPhone error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get fully paid loans
exports.getFullyPaidLoans = async (req, res) => {
  try {
    const fullyPaidLoans = await Loan.find({ status: "fully paid" }) .populate('borrowerId')
    .sort({ paidDate: -1 });

    res.status(200).json({
      message: "Fully paid loans retrieved successfully",
      loans: fullyPaidLoans,
    });
  } catch (error) {
    console.error("Error fetching fully paid loans:", error);
    res.status(500).json({ message: "Error fetching fully paid loans" });
  }
};



// Controller: Get all customers with total and fully paid loans
exports.getAllCustomersWithLoansFullyPaid = async (req, res) => {
  try {
    // Step 1: Fetch all customers
    const customers = await Borrower.find();

    // Step 2: Aggregate loans per customer
    const loanStats = await Loan.aggregate([
      {
        $group: {
          _id: "$borrowerId",
          totalLoans: { $sum: 1 },
          fullyPaidLoans: {
            $sum: {
              $cond: [{ $eq: ["$status", "fully paid"] }, 1, 0]
            }
          }
        }
      }
    ]);

    // Step 3: Map loan stats to customers
    const customersWithStats = customers.map((customer) => {
      const stats = loanStats.find((l) => l._id.toString() === customer._id.toString());
      return {
        _id: customer._id,
        fullName: customer.fullName,
        phone: customer.phone,
        idNumber: customer.idNumber,
        totalLoans: stats ? stats.totalLoans : 0,
        fullyPaidLoans: stats ? stats.fullyPaidLoans : 0,
        savingsBalance: customer.savingsBalance,
        isVerified: customer.isVerified,
        createdAt: customer.createdAt
      };
    });

    res.status(200).json({ data: customersWithStats });
  } catch (error) {
    console.error("Error fetching customers with loan stats:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};


exports.getFullyPaidLoansByCustomer = async (req, res) => {
  try {
    const { borrowerId } = req.params;

    // 1️⃣ Find borrower
    const borrower = await Customer.findById(borrowerId);
    if (!borrower) {
      return res.status(404).json({ message: "❌ Borrower not found" });
    }

    // 2️⃣ Find loans with status 'fully paid'
    const loans = await Loan.find({
      borrowerId,
      status: "fully paid",
    });

    if (loans.length === 0) {
      return res.status(200).json({ message: "✅ No fully paid loans for this borrower" });
    }

    // 3️⃣ Return fully paid loans
    return res.status(200).json({
      message: "📄 Fully paid loans retrieved successfully",
      borrower: borrower.fullName,
      count: loans.length,
      loans: loans.map(loan => ({
        loanId: loan._id,
        amount: loan.amount,
        interest: loan.interest,
        totalRepayment: loan.totalRepayment,
        repaidAmount: loan.repaidAmount,
        balance: loan.balance,
        duration: loan.duration,
        issueDate: loan.issueDate,
        dueDate: loan.dueDate,
        lastReminderSent: loan.lastReminderSent,
        repayments:loan.repayments
      })),
    });

  } catch (error) {
    console.error("❌ Error fetching fully paid loans:", error);
    return res.status(500).json({
      message: "Error fetching fully paid loans",
      error: error.message,
    });
  }
};



exports.getOutstandingLoans = async (req, res) => {
  try {
    const outstandingLoans = await Loan.find({ status: 'active' })

      .populate('borrowerId'); // Get complete borrower object;
    res.json(outstandingLoans);
  } catch (error) {
    console.error('Error fetching outstanding loans:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


// ----------------------------
// API 1: Get Borrower by ID (with active/overdue loan)
// ----------------------------
exports.getBorrowersWithLoans = async (req, res) => {
  try {
    // 1️⃣ Get all ACTIVE + OVERDUE loans
    const loans = await Loan.find({
      status: { $in: ["active", "overdue"] }
    }).populate("borrowerId"); // Populate borrower details

    if (!loans.length) {
      return res.status(404).json({
        message: "No active or overdue loans found"
      });
    }

    // 2️⃣ Group loans by borrowerId
    const borrowerMap = {};

    loans.forEach((loan) => {
      const borrowerId = loan.borrowerId._id.toString();

      if (!borrowerMap[borrowerId]) {
        borrowerMap[borrowerId] = {
          borrower: loan.borrowerId,
          loanCount: 0,
          loans: []
        };
      }

      borrowerMap[borrowerId].loans.push(loan);
      borrowerMap[borrowerId].loanCount++;
    });

    // 3️⃣ Convert object → array
    const response = Object.values(borrowerMap);

    res.status(200).json({
      success: true,
      totalBorrowers: response.length,
      data: response
    });

  } catch (error) {
    console.error("❌ Error fetching borrowers with loans:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};



// ----------------------------
// API 2: Get All Loans for a Borrower
// ----------------------------
exports.getLoansByBorrower = async (req, res) => {
  try {
    const { borrowerId } = req.params;

    // Step 1: Check borrower exists
    const borrower = await Customer.findById(borrowerId);
    if (!borrower) {
      return res.status(404).json({ message: "Borrower not found" });
    }

    // Step 2: Get active + overdue loans
    const loans = await Loan.find({
      borrowerId,
      status: { $in: ["active", "overdue"] }
    }).sort({ createdAt: -1 });

    res.status(200).json({
      borrower,
      loans,
      totalLoans: loans.length
    });

  } catch (error) {
    console.error("Error fetching loans:", error);
    res.status(500).json({ message: "Server error" });
  }
};



// --- Agent creates a loan request ---
exports.requestLoan = async (req, res) => {
  try {
    const agentId = req.user._id;
    const { borrowerId, amount, totalInterest, duration, repaymentFrequency} = req.body;

    // ✅ Validation
    if (!borrowerId || !amount || !totalInterest || !duration || !repaymentFrequency ) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // ✅ Check borrower existence
    const borrower = await Customer.findById(borrowerId);
    if (!borrower) return res.status(404).json({ message: "Borrower not found" });

    // ✅ Fetch Agent and its assigned Lender
    const agent = await AgentModel.findById(agentId);
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    const lender = await User.findById(agent.lenderId);
    if (!lender) return res.status(404).json({ message: "Assigned lender not found" });

    // ✅ Check if borrower already has active, pending, or overdue loan
    const existingLoan = await Loan.findOne({
      borrowerId,
      status: { $in: [ "active", "overdue"] }
    })
      .populate("requestedByAgentId", "name phone")
      .populate("lenderId", "name phone")
      .populate("borrowerId", "fullName phone email");

    if (existingLoan) {
      return res.status(400).json({
        message: `This borrower already has an existing ${existingLoan.status} loan.`,
        existingLoan
      });
    }

    // ✅ Calculate repayment details
    const totalRepayment = parseFloat(amount) + parseFloat(totalInterest);
    const dailyRepayment = totalRepayment / duration;

    // ✅ Create new loan request
    const loan = await Loan.create({
      lenderId: lender._id,
      borrowerId,
      requestedByAgentId: agentId,
      fullName: borrower.fullName,
       phoneNumber: borrower.phone, // ✅ fetched directly,
      lenderPhone: lender.phone,
      amount,
      interest: totalInterest,
      billRefNumber: borrower.idNumber,
      totalRepayment,
      dailyRepayment,
      duration,
      dueDate: new Date(Date.now() + duration * 24 * 60 * 60 * 1000),
      status: "pending",
      loanRequestStatus: "pending"
    });

    // ✅ Create notifications with phone numbers included
    const notifications = [
      {
        userId: agent._id,
        userModel: "Agent",
        title: "Loan Request Created",
        message: `Loan request for ${borrower.fullName} (${borrower.phone}) of KES ${amount} submitted successfully.`,
        phone: agent.phone || "N/A",
        type: "loan",
      },
      {
        userId: lender._id,
        userModel: "User",
        title: "New Loan Request",
        message: `Agent ${agent.name} (${agent.phone}) submitted a loan request for ${borrower.fullName} (${borrower.phone}) of KES ${amount}.`,
        phone: lender.phone || "N/A",
        type: "loan",
      },
    ];



    await Notification.insertMany(notifications);

    return res.status(201).json({
      message: "Loan request submitted successfully",
      status: loan.status,
      loan
    });

  } catch (error) {
    console.error("Error requesting loan:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getAllLoanRequests = async (req, res) => {
  try {
    const lenderId = req.user._id; // Authenticated lender

    // ✅ Fetch all loans where the lender is this lender and status is pending
    const loans = await Loan.find({
      lenderId: lenderId,
      loanRequestStatus: "pending",
    })
      .populate("borrowerId", "fullName phone idNumber")
      .populate("requestedByAgentId", "name phone")
      .populate("lenderId", "name phone")
      .sort({ createdAt: -1 });

    // ✅ Response
    if (!loans.length) {
      return res.status(200).json({
        message: "No pending loan requests found for this lender.",
        loans: [],
      });
    }

    res.status(200).json({
      message: "Pending loan requests fetched successfully",
      total: loans.length,
      loans,
    });
  } catch (error) {
    console.error("❌ Error fetching loan requests:", error);
    res.status(500).json({
      message: "Error fetching loan requests",
      error: error.message,
    });
  }
};

exports.reviewLoanRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const lenderId = req.user._id;
    const { loanId, action } = req.body;

    if (!loanId || !action) {
      return res.status(400).json({ message: "loanId and action are required" });
    }

    if (!["approved", "rejected"].includes(action)) {
      return res.status(400).json({ message: "Action must be 'approved' or 'rejected'." });
    }

    const loan = await Loan.findById(loanId)
      .populate("borrowerId")
      .populate("requestedByAgentId")
      .populate("lenderId")
      .session(session);

    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }

    if (loan.lenderId._id.toString() !== lenderId.toString()) {
      return res.status(403).json({ message: "Unauthorized review attempt." });
    }

    if (loan.loanRequestStatus !== "pending") {
      return res.status(400).json({ message: `Loan already ${loan.loanRequestStatus}.` });
    }

    const borrower = loan.borrowerId;
    const agent = loan.requestedByAgentId;
    const lender = loan.lenderId;

    // *** REJECTION FLOW ***
// *** REJECTION FLOW ***
if (action === "rejected") {
  loan.loanRequestStatus = "rejected";
 
  await loan.save({ session });

  const notifications = [
    {
      userId: borrower._id,
      userModel: "Customer",
      title: "Loan Rejected",
      message: `Sorry ${borrower.fullName}, your loan of KES ${loan.amount} was rejected.`,
      type: "loan",
    },
  ];

  // Only notify agent if it exists
  if (agent) {
    notifications.push({
      userId: agent._id,
      userModel: "Agent",
      title: "Loan Request Rejected",
      message: `Loan request for ${borrower.fullName} (KES ${loan.amount}) was rejected.`,
      type: "loan_rejected",
    });
  }

  await Notification.insertMany(notifications, { session });

  await session.commitTransaction();
  session.endSession();
  
  return res.status(200).json({ 
    message: "Loan rejected.", 
    loan: {
      id: loan._id,
      amount: loan.amount,
      status: loan.status,
      loanRequestStatus: loan.loanRequestStatus
    }
  });
}


    // *** APPROVAL FLOW ***
    const borrowerActiveLoan = await Loan.findOne({
      borrowerId: borrower._id,
      status: { $in: ["active", "overdue"] }
    }).session(session);

    if (borrowerActiveLoan) {
      await session.abortTransaction();
      session.endSession();
      
      return res.status(400).json({
        message: `Borrower has an existing active loan (${borrowerActiveLoan.status}).`
      });
    }

    // ✅ DON'T DEDUCT LENDER BALANCE IMMEDIATELY - just validate
    if (lender.walletBalance < loan.amount) {
      await session.abortTransaction();
      session.endSession();
      
      return res.status(400).json({ message: "Insufficient wallet balance." });
    }

    console.log(`💰 Lender balance validation: ${lender.walletBalance} -> ${lender.walletBalance - loan.amount} (will deduct on M-Pesa success)`);

    // Update loan to approved but NOT active until callback
    loan.loanRequestStatus = "approved";
    loan.status = "pending"; // Will become "active" in callback
    loan.issuedByLenderId = lender._id;
    await loan.save({ session });

    // Create pending transaction
    const [transaction] = await Transaction.create([{
      userId: lenderId,
      userModel: "User",
      loanId: loan._id,
      type: "loan issued",
      amount: loan.amount,
      status: "pending",
      phone: borrower.phone,
      description: "Loan disbursement",
      balanceBefore: lender.walletBalance,
      balanceAfter: lender.walletBalance - loan.amount, // Expected balance after success
    }], { session });

    // Create agent commission with pending status (will be updated in callback)
    if (agent) {
      await AgentCommission.create([{
        agentId: agent._id,
        loanId: loan._id,
        commissionType: "approval",
        amount: loan.amount * 0.0495,
        status: "pending"
      }], { session });
    }

    const b2cResponse = await initiateB2C(borrower.phone, loan.amount, transaction._id);

    if (!b2cResponse || !b2cResponse.OriginatorConversationID) {
      throw new Error("Invalid B2C response from M-Pesa");
    }

    // ✅ CRITICAL FIX: Save ALL relevant IDs for callback matching
    transaction.checkoutRequestID = b2cResponse.OriginatorConversationID;
    transaction.conversationID = b2cResponse.ConversationID;
    await transaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    console.log(`📞 Loan B2C Initiated: 
      OriginatorConversationID: ${b2cResponse.OriginatorConversationID}
      ConversationID: ${b2cResponse.ConversationID}
    `);
    
    return res.status(200).json({
      message: "Loan approved — awaiting M-Pesa confirmation.",
      loan: {
        id: loan._id,
        amount: loan.amount,
        status: loan.status,
        loanRequestStatus: loan.loanRequestStatus
      },
      transaction: {
        id: transaction._id,
        amount: transaction.amount,
        status: transaction.status,
        checkoutRequestID: transaction.checkoutRequestID
      },
      b2cResponse: {
        ConversationID: b2cResponse.ConversationID,
        OriginatorConversationID: b2cResponse.OriginatorConversationID,
        ResponseDescription: b2cResponse.ResponseDescription
      }
    });

  } catch (err) {
    try {
      if (session.inTransaction()) {
        console.log("🔄 Aborting transaction due to error");
        await session.abortTransaction();
      }
    } catch (abortError) {
      console.error("Error aborting transaction:", abortError);
    } finally {
      session.endSession();
    }
    
    console.error("❌ Review loan error:", err);
    
    // ✅ USER-FRIENDLY ERROR MESSAGES
    let errorMessage = "Error reviewing loan request";
    if (err.message.includes("insufficient")) {
      errorMessage = "Insufficient wallet balance";
    } else if (err.message.includes("M-Pesa")) {
      errorMessage = "M-Pesa service temporarily unavailable";
    }
    
    return res.status(500).json({ 
      message: errorMessage, 
      error: process.env.NODE_ENV === 'development' ? err.message : undefined 
    });
  }
};

exports.getActiveLoansByAgent = asyncHandler(async (req, res) => {
  const agentId = req.user._id;

  // Fetch full data
  const loans = await Loan.find({
    requestedByAgentId: agentId,
    loanRequestStatus: "approved",
    status: "active",
  })
    .populate("borrowerId") // ✅ Return full customer object
    .populate("lenderId")   // ✅ Return full lender object (User model)
    .sort({ createdAt: -1 });

  if (!loans || loans.length === 0) {
    return res.status(200).json({
      success: true,
      message: "No active loans found for this agent",
      loans: [],
    });
  }

  res.status(200).json({
    success: true,
    totalActiveLoans: loans.length,
    loans,
  });
});
