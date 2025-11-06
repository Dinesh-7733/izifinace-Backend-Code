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

// ✅ Customer repayment (STK Push supported)
exports.trackRepayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const postCommitTasks = [];

  try {
    const borrowerId = req.borrower._id; // ✅ Borrower ID from middleware
    const { loanId, amount } = req.body;

    console.log("📌 Repayment request:", { borrowerId, loanId, amount });

    if (!amount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Amount is required" });
    }

    // 1️⃣ Find borrower
    const borrower = await Customer.findById(borrowerId).session(session);
    if (!borrower) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Borrower not found" });
    }

    // 2️⃣ Find loan (must belong to borrower & be active)
    const loan = await Loan.findOne({
      _id: loanId,
      borrowerId,
      status: { $ne: "fully paid" }
    }).session(session);

    if (!loan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Loan not found or not active" });
    }

    // 3️⃣ Normalize phone number
    const rawPhone = borrower.phone || borrower.phoneNumber;
    const customerPhone = normalizeToE164(rawPhone, "KE");
    if (!customerPhone) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Invalid borrower phone number" });
    }

    // 4️⃣ Prevent overpayment
    if (amount > loan.balance) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `Repayment amount exceeds remaining balance. Remaining balance is KES ${loan.balance}.`
      });
    }

    // 5️⃣ Create pending transaction
    const [transaction] = await Transaction.create([{
      type: "repayment",
      userId: borrowerId,
      userModel: "Customer",
      loanId: loan._id,
      clientId: loan.clientId,
      phone: customerPhone,
      transactionId: `STK-${Date.now()}`,
      amount,
      balanceBefore: loan.balance,
      balanceAfter: loan.balance,
      status: "pending"
    }], { session });

    let stkResponse = null;

    // --- 🔹 SANDBOX MODE ---
    if (process.env.MPESA_ENV === "sandbox") {
      loan.balance -= amount;
      loan.repaidAmount += amount;
      if (loan.balance <= 0) {
        loan.balance = 0;
        loan.status = "fully paid";
      }

      loan.repayments.push({
        amount,
        transactionId: transaction._id,
        date: new Date()
      });
      await loan.save({ session });

      borrower.loanBalance = loan.balance;
      await borrower.save({ session });

      transaction.balanceAfter = loan.balance;
      transaction.status = "successful";
      await transaction.save({ session });

      // Post-commit tasks
      postCommitTasks.push(async () => {
        // Borrower notification
        await Notification.create({
          userId: borrower._id,
          userModel: "Customer",
          title: "Repayment Successful",
          message: `✅ Dear ${borrower.fullName}, your repayment of KES ${amount} has been received. Remaining balance: KES ${loan.balance}.`,
          type: "repayment"
        });

        await sendSMS(customerPhone,
          `✅ Dear ${borrower.fullName}, your repayment of KES ${amount} has been received. Remaining balance: KES ${loan.balance}. Loan ID: ${loan._id}`
        );

        // Lender notification
        const lender = await Customer.findById(loan.lenderId);
        if (lender) {
          await Notification.create({
            userId: lender._id,
            userModel: "User",
            title: "Loan Repayment Received",
            message: `Borrower ${borrower.fullName} repaid KES ${amount} for Loan ID: ${loan._id}. Remaining balance: KES ${loan.balance}.`,
            type: "repayment"
          });

          await sendSMS(lender.phone,
            `📢 Borrower ${borrower.fullName} repaid KES ${amount} for Loan ID: ${loan._id}. Remaining: KES ${loan.balance}.`
          );
        }
      });

      await session.commitTransaction();
      session.endSession();

      for (const task of postCommitTasks) await task();

      stkResponse = {
        MerchantRequestID: transaction._id,
        CheckoutRequestID: transaction._id,
        ResponseCode: "0",
        ResponseDescription: "Sandbox mode - balance updated directly",
        CustomerMessage: "Repayment successful in test mode"
      };

      return res.status(200).json({
        message: "Repayment processed successfully (sandbox mode)",
        stkResponse,
        transaction,
        loan
      });
    }

    // --- 🔹 LIVE MODE (STK Push) ---
    stkResponse = await initiateSTKPush(customerPhone, amount);

    // Save real STK ID
    transaction.transactionId = stkResponse.CheckoutRequestID || transaction._id;
    await transaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      message: "Repayment initiated. Awaiting STK Push confirmation.",
      stkResponse,
      transaction
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Error tracking repayment:", error);
    return res.status(500).json({ message: "Error tracking repayment", error: error.message });
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
    if (process.env.MPESA_ENV === "sandbox") {


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
    if (process.env.MPESA_ENV === "sandbox") {
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
    // Step 1: Get all active/overdue loans
    const loans = await Loan.find({
      status: { $in: ["active", "overdue"] }
    });

    if (loans.length === 0) {
      return res.status(404).json({ message: "No active/overdue loans found" });
    }

    // Step 2: Group loans by borrowerId
    const borrowerLoanMap = {};
    loans.forEach(loan => {
      const borrowerId = loan.borrowerId.toString();
      if (!borrowerLoanMap[borrowerId]) {
        borrowerLoanMap[borrowerId] = [];
      }
      borrowerLoanMap[borrowerId].push(loan);
    });

    // Step 3: Fetch borrower details + loan count
    const borrowersWithLoans = await Promise.all(
      Object.keys(borrowerLoanMap).map(async (borrowerId) => {
        const borrower = await Borrower.findById(borrowerId);
        return {
          borrower,
          loanCount: borrowerLoanMap[borrowerId].length
        };
      })
    );

    res.status(200).json(borrowersWithLoans);

  } catch (error) {
    console.error("Error fetching borrowers with loans:", error);
    res.status(500).json({ message: "Server error" });
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

    // Step 2: Get all loans (active, overdue, fully paid, pending, etc.)
    const loans = await Loan.find({ borrowerId, status: "active", }).sort({ createdAt: -1 });

    res.status(200).json({ borrower, loans });

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

    // --- Validation ---
    if (!loanId || !action) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "loanId and action are required" });
    }
    if (!["approved", "rejected"].includes(action)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Invalid action. Use 'approved' or 'rejected'." });
    }

    // --- Fetch loan ---
    const loan = await Loan.findById(loanId)
      .populate("borrowerId", "fullName phone idNumber savingsBalance")
      .populate("requestedByAgentId", "name phone")
      .populate("lenderId", "name phone walletBalance")
      .session(session);

    if (!loan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Loan not found" });
    }

    const lender = loan.lenderId;
    const borrower = loan.borrowerId;
    const agent = loan.requestedByAgentId;

    if (lender._id.toString() !== lenderId.toString()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: "You are not authorized to review this loan." });
    }

    if (loan.loanRequestStatus !== "pending") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `This loan request has already been ${loan.loanRequestStatus}.`,
      });
    }

    // --- REJECT FLOW ---
    if (action === "rejected") {
      loan.loanRequestStatus = "rejected";
      await loan.save({ session });

      await Notification.insertMany(
        [
          {
            userId: agent._id,
            userModel: "Agent",
            title: "Loan Request Rejected",
            message: `Loan request for ${borrower.fullName} (KES ${loan.amount}) was rejected by lender.`,
            type: "loan_rejected",
          },
          {
            userId: borrower._id,
            userModel: "Customer",
            title: "Loan Rejected",
            message: `⚠️ Sorry ${borrower.fullName}, your loan request of KES ${loan.amount} was rejected.`,
            type: "loan",
          },
        ],
        { session, ordered: true }
      );

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        message: "Loan request rejected successfully.",
        loan,
      });
    }

    // --- APPROVE FLOW ---
    if (action === "approved") {

      // Check if borrower already has active/overdue loan
      const existingLoan = await Loan.findOne({
        borrowerId: borrower._id,
        status: { $in: ["active", "overdue"] },
      }).session(session);

      if (existingLoan) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          message: `Borrower already has an existing loan (${existingLoan.status}). Cannot approve a new loan.`,
        });
      }

      if (lender.walletBalance < loan.amount) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Insufficient wallet balance" });
      }

      // Deduct lender wallet
      lender.walletBalance -= loan.amount;
      await lender.save({ session });

      // Update loan
      loan.loanRequestStatus = "approved";
      loan.status = "active";
      loan.issuedByLenderId = lender._id;
      await loan.save({ session });

      // Create Transaction
      const transaction = await Transaction.create(
        [
          {
            userId: lenderId,
             userModel: "User", // <--- add this
            loanId: loan._id,
            type: "loan issued",
            amount: loan.amount,
            status: "pending",
            phone: borrower.phone,
            description: "Loan disbursement",
          },
        ],
        { session }
      );

      // Sandbox mode simulation
      if (process.env.MPESA_ENV === "sandbox") {
      

        transaction[0].status = "successful";
        await transaction[0].save({ session });

        loan.status = "active";
        await loan.save({ session });

        const normalizedPhone = normalizeToE164(borrower.phone, "KE");
        if (normalizedPhone) {
          await sendSMS(
            normalizedPhone,
            `✅ Hello ${borrower.fullName}, your loan of KES ${loan.amount} has been issued.\nTotal repayment: KES ${loan.totalRepayment}\nDaily: KES ${loan.dailyRepayment.toFixed(
              2
            )}\nDue date: ${loan.dueDate.toDateString()}`
          );
        }

        await Notification.insertMany(
          [
            {
              userId: lender._id,
              userModel: "User",
              title: "Loan Issued Successfully",
              message: `You have issued a loan of KES ${loan.amount} to ${borrower.fullName}. Total repayment: KES ${loan.totalRepayment}.`,
              type: "loan_approved",
            },
            {
              userId: borrower._id,
              userModel: "Customer",
              title: "Loan Issued",
              message: `✅ Hello ${borrower.fullName}, your loan of KES ${loan.amount} has been issued. Total repayment: KES ${loan.totalRepayment}. Due date: ${loan.dueDate.toDateString()}`,
              type: "loan",
            },
            {
              userId: agent._id,
              userModel: "Agent",
              title: "Loan Request Approved",
              message: `Your loan request for ${borrower.fullName} (KES ${loan.amount}) has been approved and issued.`,
              type: "loan_approved",
            },
          ],
          { session, ordered: true }
        );
      } else {
        // --- LIVE MODE: Trigger M-Pesa B2C ---
        const b2cResponse = await initiateB2C(borrower.phone, loan.amount, transaction[0]._id);

        // Save Mpesa checkoutRequestID
        if (b2cResponse?.OriginatorConversationID) {
          transaction[0].checkoutRequestID = b2cResponse.OriginatorConversationID;
          await transaction[0].save();
        }
      }

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        message: process.env.MPESA_ENV === "sandbox"
          ? "Loan approved and issued successfully (sandbox mode)"
          : "Loan approved successfully. Awaiting B2C confirmation.",
        loan,
        transaction: transaction[0],
      });
    }
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Error reviewing loan request:", error);
    return res.status(500).json({
      message: "Error reviewing loan request",
      error: error.message,
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
