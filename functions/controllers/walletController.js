const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { initiateSTKPush, initiateB2C } = require("../utils/mpesa");
const Borrower = require("../models/customer")

const mongoose = require("mongoose");
const { sendSMS } = require("../utils/sms");
const Notification = require("../models/Notification");
const Profile = require("../models/Profile");
const WithdrawRequest = require("../models/WithdrawRequest");

// Send balance via SMS
exports.sendBalanceSMS = async (req, res) => {
  try {
    const { userId } = req.body;

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get the balance
    let balance;
    if (user.role === "borrower") {
      const borrower = await Borrower.findOne({ userId: user._id });
      balance = borrower.savingsBalance;
    } else if (user.role === "lender") {
      balance = user.walletBalance;
    }

    // Send SMS
    const message = `Your current balance is Ksh ${balance}.`;
    await sendSMS(user.phone, message);

    res.status(200).json({ message: "Balance sent via SMS" });
  } catch (error) {
    console.error("Error sending balance via SMS:", error);
    res.status(500).json({ message: "Error sending balance via SMS" });
  }
};

exports.deposit = async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.user._id;

    if (!amount) return res.status(400).json({ message: "Amount is required" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.isPhoneVerified)
      return res.status(403).json({ message: "Phone number not verified" });

    // ⭐ Fetch Profile To Get Full Name & Phone
    const profile = await Profile.findOne({ userId });
    if (!profile) return res.status(404).json({ message: "Profile not found" });

    // ⭐ Create Dynamic Reference
    const accountRef = `${profile.fullName}-${profile.phone}`;

    // Create transaction as pending
    const depositTransaction = new Transaction({
      userId,
      userModel: "User",
      type: "savings",
      amount: Number(amount),
      status: "pending",
      phone: profile.phone,
      accountReference: accountRef
    });

    await depositTransaction.save();

    // 🌍 LIVE MODE ONLY - Start STK push
    const stkResponse = await initiateSTKPush(profile.phone, amount, accountRef);

    // Save CheckoutRequestID
    depositTransaction.checkoutRequestID = stkResponse.CheckoutRequestID;
    await depositTransaction.save();

    return res.status(200).json({
      message: "Deposit initiated successfully. Awaiting M-Pesa confirmation.",
      stkResponse,
    });

  } catch (error) {
    console.error("❌ Error depositing money:", error);
    res.status(500).json({ message: error.message });
  }
};



// Withdraw money from wallet (B2C)
exports.withdraw = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user._id;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Valid amount is required" });
    }

    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.phone) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "User phone number not found" });
    }

    // ✅ BETTER VALIDATION: Check if amount is valid number
    const withdrawalAmount = Number(amount);
    if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Invalid amount" });
    }

    if (user.walletBalance < withdrawalAmount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ 
        message: "Insufficient balance", 
        currentBalance: user.walletBalance,
        requestedAmount: withdrawalAmount 
      });
    }

    // ✅ DON'T DEDUCT BALANCE IMMEDIATELY - just validate
    const balanceBefore = user.walletBalance;
    const expectedBalanceAfter = balanceBefore - withdrawalAmount;

    console.log(`💰 Balance validation: ${balanceBefore} -> ${expectedBalanceAfter} (will deduct on M-Pesa success)`);

    // Create a pending withdrawal transaction WITHOUT deducting balance
    const withdrawalTransaction = await Transaction.create(
      [{
        userId,
        type: "withdrawal",
        userModel: "User",
        amount: withdrawalAmount,
        status: "pending",
        phone: user.phone,
        balanceBefore: balanceBefore,
        balanceAfter: expectedBalanceAfter, // Expected balance after successful withdrawal
        createdAt: new Date(),
      }],
      { session }
    );

    const transaction = withdrawalTransaction[0];

    console.log(`📝 Transaction created: ${transaction._id}, Amount: ${transaction.amount}`);

    // --- LIVE ENVIRONMENT ONLY ---
    const normalizedPhone = user.phone.startsWith('+') ? user.phone : `+${user.phone}`;
    
    console.log(`🚀 Initiating B2C payment to: ${normalizedPhone}, Amount: ${withdrawalAmount}`);
    
    const b2cResponse = await initiateB2C(normalizedPhone, withdrawalAmount);

    if (!b2cResponse || !b2cResponse.OriginatorConversationID) {
      throw new Error("Invalid B2C response from M-Pesa");
    }

    // ✅ CRITICAL FIX: Save ALL relevant IDs for callback matching
    transaction.checkoutRequestID = b2cResponse.OriginatorConversationID;
    transaction.conversationID = b2cResponse.ConversationID;
    
    await transaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    console.log(`📞 B2C Initiated: 
      OriginatorConversationID: ${b2cResponse.OriginatorConversationID}
      ConversationID: ${b2cResponse.ConversationID}
    `);

    return res.status(200).json({
      message: "Withdrawal initiated. Awaiting MPESA confirmation.",
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
      },
    });

  } catch (error) {
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
    
    console.error("🔥 Withdrawal Error:", error);
    
    // ✅ USER-FRIENDLY ERROR MESSAGES
    let errorMessage = "Error processing withdrawal";
    if (error.message.includes("insufficient balance")) {
      errorMessage = "Insufficient balance for withdrawal";
    } else if (error.message.includes("phone")) {
      errorMessage = "Invalid phone number format";
    } else if (error.message.includes("M-Pesa")) {
      errorMessage = "M-Pesa service temporarily unavailable";
    }
    
    res.status(500).json({ 
      message: errorMessage, 
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
};


exports.depositSavings = async (req, res) => {
  try {
    const { amount } = req.body;
    const borrower = req.borrower; // borrower comes from auth middleware

    if (!borrower || !borrower._id) {
      return res.status(401).json({ message: "Unauthorized or borrower not found" });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    // Ensure borrower phone exists
    let phoneNumber = borrower.phone;
    if (!phoneNumber) {
      return res.status(400).json({ message: "Phone number not found for this borrower" });
    }

    // ⭐ Dynamic Reference Format: FullName-ID-Phone
    const accountRef = `${borrower.fullName}-${borrower.idNumber}-${borrower.phone}`;

    // Create pending transaction
    const transaction = new Transaction({
      userId: borrower._id,
      userModel: "Customer",
      type: "customer deposit",
      amount: Number(amount),
      status: "pending",
      phone: phoneNumber,
      accountReference: accountRef, 
      balanceBefore: borrower.savingsBalance,
      balanceAfter: borrower.savingsBalance
    });

    await transaction.save();

    /* -----------------------------------------------------
       SANDBOX MODE: we skip MPESA and directly credit wallet
    ------------------------------------------------------*/
    if (global.config.mpesaEnv === "sandbox") {
      borrower.savingsBalance += Number(amount);
      await borrower.save();

      transaction.status = "successful";
      transaction.transactionId = `TEST-${Date.now()}`;
      transaction.balanceAfter = borrower.savingsBalance;
      await transaction.save();

      // Create notification (NO SMS in sandbox)
      await Notification.create({
        userId: borrower._id,
        userModel: "Customer",
        title: "Deposit Successful",
        message: `KES ${amount} deposited into your savings successfully.`,
        type: "deposit"
      });

      return res.status(200).json({
        message: "Deposit completed successfully (sandbox mode)",
        savingsBalance: borrower.savingsBalance,
        transaction
      });
    }

    /* -----------------------------------------------------
       LIVE MODE: Send STK Push → Callback will update balance
    ------------------------------------------------------*/
    const stkResponse = await initiateSTKPush(phoneNumber, amount, accountRef);

    transaction.checkoutRequestID = stkResponse.CheckoutRequestID;
    await transaction.save();

    return res.status(200).json({
      message: "Deposit request sent. Complete the payment on your phone.",
      stkResponse,
      transaction
    });

  } catch (error) {
    console.error("❌ Error in depositSavings:", error);
    res.status(500).json({ message: error.message });
  }
};

exports.withdrawCustomerSavings = async (req, res) => {
  try {
    const borrower = req.borrower;
    const { amount } = req.body;

    if (!borrower || !borrower._id)
      return res.status(401).json({ message: "Unauthorized" });

    const withdrawalAmount = Number(amount);
    if (!withdrawalAmount || withdrawalAmount <= 0)
      return res.status(400).json({ message: "Invalid amount" });

    const customer = await Borrower.findById(borrower._id);
    if (!customer)
      return res.status(404).json({ message: "Customer not found" });

    if (customer.savingsBalance < withdrawalAmount)
      return res.status(400).json({ message: "Insufficient savings balance" });

    const balanceBefore = customer.savingsBalance;
    const expectedBalanceAfter = balanceBefore - withdrawalAmount;

    console.log(
      `💰 Savings validation: ${balanceBefore} → ${expectedBalanceAfter}`
    );

    const accountRef = `${customer.fullName}-${customer.idNumber}-${customer.phone}`;

    // ✅ CREATE TRANSACTION WITHOUT SESSION
    const transaction = await Transaction.create({
      userId: customer._id,
      userModel: "Customer",
      type: "customer withdrawal",
      amount: withdrawalAmount,
      status: "pending",
      phone: customer.phone,
      accountReference: accountRef,
      balanceBefore,
      balanceAfter: expectedBalanceAfter,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    // 🔁 Call M-Pesa AFTER transaction exists
    const b2cResponse = await initiateB2C(customer.phone, withdrawalAmount);

    if (!b2cResponse?.OriginatorConversationID) {
      await Transaction.findByIdAndUpdate(transaction._id, {
        status: "failed",
        failureReason: "Invalid B2C response",
      });
      throw new Error("Invalid B2C response from M-Pesa");
    }

    // ✅ UPDATE REFERENCES
    await Transaction.findByIdAndUpdate(transaction._id, {
      checkoutRequestID: b2cResponse.OriginatorConversationID,
      conversationID: b2cResponse.ConversationID,
      mpesaRequestRef: b2cResponse.OriginatorConversationID,
    });

    // 🔔 Notification (no session needed)
    await Notification.create({
      userId: customer._id,
      userModel: "Customer",
      title: "Savings Withdrawal Initiated",
      message: `KES ${withdrawalAmount} withdrawal initiated. Awaiting M-Pesa confirmation.`,
      type: "withdraw",
    });

    console.log(`📞 B2C INITIATED
      OriginatorConversationID: ${b2cResponse.OriginatorConversationID}
      ConversationID: ${b2cResponse.ConversationID}
      TransactionID: ${transaction._id}
    `);

    return res.status(200).json({
      message: "Withdrawal request sent to M-Pesa",
      transaction: {
        id: transaction._id,
        amount: transaction.amount,
        status: transaction.status,
        checkoutRequestID: b2cResponse.OriginatorConversationID,
        conversationID: b2cResponse.ConversationID,
      },
    });

  } catch (error) {
    console.error("❌ Customer Withdrawal Error:", error.message);

    return res.status(500).json({
      message: "Error processing savings withdrawal",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};



exports.requestAgentWithdrawal = async (req, res) => {
  try {
    const { amount } = req.body;
    const agent = req.agent;

    if (!agent) return res.status(401).json({ message: "Unauthorized" });

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    // Require minimum balance of 1000 to withdraw
    if (agent.walletBalance < 1000) {
      return res.status(400).json({
        message: "Minimum wallet balance of KES 1000 is required before withdrawal."
      });
    }

    if (amount > agent.walletBalance) {
      return res.status(400).json({ message: "Insufficient wallet balance" });
    }

    const withdrawal = new WithdrawRequest({
      agentId: agent._id,
      lenderId: agent.lenderId,
      amount,
      status: "pending",
    });

    await withdrawal.save();

    return res.status(200).json({
      message: "Withdrawal request sent to lender for approval.",
      withdrawal
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.reviewAgentWithdrawRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const lenderId = req.user?._id;
    const { withdrawalId, action } = req.body;

    if (!withdrawalId || !action) {
      throw new Error("withdrawalId and action are required");
    }

    if (!["approved", "rejected"].includes(action)) {
      throw new Error("Action must be 'approved' or 'rejected'");
    }

    const request = await WithdrawRequest.findById(withdrawalId)
      .populate("agentId")
      .populate("lenderId")
      .session(session);

    if (!request) throw new Error("Withdrawal request not found");

    if (request.lenderId._id.toString() !== lenderId.toString()) {
      throw new Error("Unauthorized — this request does not belong to this lender");
    }

    if (request.status !== "pending") {
      throw new Error(`Request already processed (${request.status})`);
    }

    const agent = request.agentId;
    if (!agent) throw new Error("Agent data missing in withdrawal request");

    /** ------------------- ❌ REJECTION FLOW ------------------- **/
    if (action === "rejected") {
      request.status = "rejected";
      request.reason = req.body.reason || "No reason provided";

      await request.save({ session });

      await Notification.create(
        {
          userId: agent._id,
          userModel: "Agent",
          title: "Withdrawal Request Rejected",
          message: `Your withdrawal request of KES ${request.amount} was rejected.`,
          type: "withdrawal_reject",
        },
        { session }
      );

      await session.commitTransaction();

      return res.status(200).json({
        success: true,
        message: "Withdrawal rejected.",
        request,
      });
    }

    /** ------------------- ✅ APPROVAL FLOW ------------------- **/

    if (agent.walletBalance == null) {
      throw new Error("Agent wallet balance not found");
    }

    if (agent.walletBalance < request.amount) {
      throw new Error("Insufficient wallet balance for approval");
    }

    request.status = "approved";
    await request.save({ session });

    const reference = `${agent.name}-${agent.phone}-AGENT-${Date.now()}`;

    const [transaction] = await Transaction.create(
      [{
        userId: agent._id,
        userModel: "Agent",
        withdrawalRequestId: request._id,
        type: "agent withdrawal",
        amount: request.amount,
        status: "pending",
        phone: agent.phone,
        accountReference: reference,
        balanceBefore: agent.walletBalance,
        balanceAfter: agent.walletBalance - request.amount,
      }],
      { session }
    );

    request.transactionId = transaction._id;
    await request.save({ session });

    // Send B2C request
    let b2cResponse;
    try {
      b2cResponse = await initiateB2C(agent.phone, request.amount, reference);
    } catch (mpesaErr) {
      throw new Error("M-Pesa B2C payout failed: " + mpesaErr.message);
    }

    if (!b2cResponse?.ConversationID) {
      throw new Error("Invalid B2C response from M-Pesa");
    }

    transaction.checkoutRequestID = b2cResponse.OriginatorConversationID;
    transaction.conversationID = b2cResponse.ConversationID;

    await transaction.save({ session });

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Withdrawal approved — awaiting M-Pesa confirmation.",
      request,
      transaction,
      b2cResponse,
    });

  } catch (err) {
    console.error("❌ ERROR IN reviewAgentWithdrawRequest:", err);

    try {
      if (session.inTransaction()) await session.abortTransaction();
    } catch (abortErr) {
      console.error("⚠️ Failed to abort transaction:", abortErr);
    }

    session.endSession();

    return res.status(500).json({
      success: false,
      message: "Error processing withdrawal request",
      error: err.message,
    });
  }
};

exports.getPendingWithdrawalsForLender = async (req, res) => {
  try {
    const lender = req.lender;

    if (!lender) {
      return res.status(403).json({ message: "Access denied. Lender only." });
    }

    const withdrawals = await WithdrawRequest.find({
      lenderId: lender._id,
      status: "pending",
    })
      .populate("agentId", "name email phone walletBalance")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: withdrawals.length,
      withdrawals,
    });

  } catch (error) {
    console.error("Get pending withdrawals error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
