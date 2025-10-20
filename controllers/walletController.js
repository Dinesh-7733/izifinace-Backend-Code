const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { initiateSTKPush, initiateB2C } = require("../utils/mpesa");

const mongoose = require("mongoose");
const { sendSMS } = require("../utils/sms");
const Notification = require("../models/Notification");

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
    if (!user.isPhoneVerified) return res.status(403).json({ message: "Phone number not verified" });

    const phoneNumber = process.env.MPESA_ENV === "sandbox"
      ? "254708374149"
      : user.phone;

    // --- Create transaction as pending ---
    const depositTransaction = new Transaction({
      userId,
      type: "savings",
      amount: Number(amount),
      status: "pending",
      phone: phoneNumber
    });

    await depositTransaction.save();

    let stkResponse = null;

    // --- Test/Sandbox Mode: directly credit wallet ---
    if (process.env.MPESA_ENV === "sandbox") {
      user.walletBalance += Number(amount);
      await user.save();

      depositTransaction.status = "successful";
      depositTransaction.checkoutRequestID = `TEST-${Date.now()}`;
      await depositTransaction.save();

        // ✅ Create notification
  await Notification.create({
    userId: user._id,
    userModel: "User",
    title: "Deposit Successful",
    message: `You deposited KES ${amount} into your wallet successfully.`,
    type: "deposit"
  });

      stkResponse = {
        MerchantRequestID: depositTransaction.checkoutRequestID,
        CheckoutRequestID: depositTransaction.checkoutRequestID,
        ResponseCode: "0",
        ResponseDescription: "Sandbox mode - wallet updated directly",
        CustomerMessage: "Deposit successful in test mode"
      };

      return res.status(200).json({
        message: "Deposit completed successfully (sandbox mode)",
        stkResponse
      });
    }

    // --- Live Mode: initiate real STK Push ---
    stkResponse = await initiateSTKPush(phoneNumber, amount);

    depositTransaction.checkoutRequestID = stkResponse.CheckoutRequestID;
    await depositTransaction.save();

    res.status(200).json({
      message: "Deposit initiated successfully",
      stkResponse,
    });

  } catch (error) {
    console.error("Error depositing money:", error.message);
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

    if (!amount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Amount is required" });
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

    if (user.walletBalance < amount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Insufficient balance" });
    }

    // Create a pending withdrawal transaction
    const withdrawalTransaction = await Transaction.create(
      [{
        userId,
        type: "withdrawal",
        amount: Number(amount),
        status: "pending",
        phone: user.phone,
      }],
      { session }
    );

    const transaction = withdrawalTransaction[0];

    // --- SANDBOX MODE ---
    if (process.env.MPESA_ENV === "sandbox") {
      user.walletBalance -= amount;
      await user.save({ session });

      transaction.status = "successful";
      await transaction.save({ session });

      await session.commitTransaction();
      session.endSession();

      // ✅ After commit → notification + SMS
      await Notification.create({
        userId: user._id,
        userModel: "User",
        title: "Withdrawal Successful",
        message: `KES ${amount} has been withdrawn from your wallet.`,
        type: "withdraw",
      });

      await sendSMS(user.phone, `✅ KES ${amount} has been withdrawn from your wallet.`);

      return res.status(200).json({
        message: "Withdrawal successful (sandbox)",
        transaction,
      });
    }

    // --- LIVE ENVIRONMENT ---
    const b2cResponse = await initiateB2C(user.phone, amount);

    transaction.checkoutRequestID = b2cResponse.OriginatorConversationID || null;
    await transaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      message: "Withdrawal initiated. Awaiting MPESA confirmation.",
      transaction,
      b2cResponse,
    });

  } catch (error) {
    try {
      // Only abort if transaction is still active
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
    } catch (_) {}
    finally {
      session.endSession();
    }
    console.error("🔥 Withdrawal Error:", error);
    res.status(500).json({ message: "Error processing withdrawal", error: error.message });
  }
};

