const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { initiateSTKPush, initiateB2C } = require("../utils/mpesa");
const Borrower = require("../models/customer")

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




    // --- Create transaction as pending ---
    const depositTransaction = new Transaction({
      userId,
      userModel: "User",
      type: "savings",
      amount: Number(amount),
      status: "pending",
      phone: user.phone
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
  // ✅ SMS (send in both modes)
      await sendSMS(user.phone, `✅ Deposit Successful: KES ${amount} added to your wallet.`);

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
  const phoneNumber = user.phone;
    // --- Live Mode: initiate real STK Push ---
    stkResponse = await initiateSTKPush(phoneNumber, amount);

  // Save checkoutRequestID before sending response
depositTransaction.checkoutRequestID = stkResponse.CheckoutRequestID;
await depositTransaction.save();
 
//  // ✅ Send SMS notification immediately (after initiating)
//     await sendSMS(phoneNumber, `📲 Deposit of KES ${amount} initiated. Awaiting MPESA confirmation.`);   

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
         userModel: "User",
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

const normalizedPhone = user.phone
    // --- LIVE ENVIRONMENT ---
    const b2cResponse = await initiateB2C(normalizedPhone, amount);

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


exports.depositSavings = async (req, res) => {
  try {
    const { amount } = req.body;
    const borrower = req.borrower; // Use borrower from middleware

    if (!borrower || !borrower._id) {
      return res.status(401).json({ message: "Unauthorized or borrower not found" });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

       // ✅ Use the borrower’s real phone number & convert to international format (254...)
    let phoneNumber = borrower.phone;
    if (!phoneNumber) {
      return res.status(400).json({ message: "Phone number not found for this borrower" });
    }

    // --- Create transaction as pending ---
      // 1️⃣ Create pending transaction
    const transaction = new Transaction({
      userId: borrower._id,
      userModel: "Customer",
      type: "customer deposit",
      amount: Number(amount),
      status: "pending",
      phone: phoneNumber,
      balanceBefore: borrower.savingsBalance,
      balanceAfter: borrower.savingsBalance
    });

    await transaction.save();

    // --- Sandbox Mode: directly credit savings ---
    if (process.env.MPESA_ENV === "sandbox") {
      borrower.savingsBalance += Number(amount);
      await borrower.save();

      transaction.status = "successful";
      transaction.transactionId = `TEST-${Date.now()}`;
      await transaction.save();

      // Notification
      await Notification.create({
        userId: borrower._id,
        userModel: "Customer",
        title: "Deposit Successful",
        message: `KES ${amount} deposited into your savings successfully.`,
        type: "deposit"
      });

      
      // ✅ SMS (always send)
      await sendSMS(
        phoneNumber,
        `✅ Deposit Successful: KES ${amount} added to your savings. New balance: KES ${borrower.savingsBalance}.`
      ).catch(console.error)
      
      return res.status(200).json({
        message: "Deposit completed successfully (sandbox)",
        savingsBalance: borrower.savingsBalance,
        transaction
      });
    }

    // --- Live Mode: STK Push ---
    const stkResponse = await initiateSTKPush(phoneNumber, amount);

    transaction.checkoutRequestID = stkResponse.CheckoutRequestID;
    await transaction.save();

    res.status(200).json({
      message: "Deposit initiated, complete the payment on your phone.",
      stkResponse,
      transaction
    });

  } catch (error) {
    console.error("Error in depositSavings:", error);
    res.status(500).json({ message: error.message });
  }
};

exports.withdrawCustomerSavings = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const borrower = req.borrower;
    const { amount } = req.body;

    if (!borrower || !borrower._id) throw new Error("Unauthorized or borrower not found");
    if (!amount || amount <= 0) throw new Error("Valid amount is required");

    const customer = await Borrower.findById(borrower._id).session(session);
    if (!customer) throw new Error("Customer not found");
    if (customer.savingsBalance < Number(amount)) throw new Error("Insufficient savings balance");

    // Create Withdrawal Transaction
// 1️⃣ Create pending transaction
    const [transaction] = await Transaction.create(
      [{
        userId: customer._id,
        userModel: "Customer",
        type: "customer withdrawal",
        amount: Number(amount),
        status: "pending",
        phone: customer.phone,
        balanceBefore: customer.savingsBalance,
        balanceAfter: customer.savingsBalance
      }],
      { session }
    );

    // --- SANDBOX MODE ---
    if (process.env.MPESA_ENV === "sandbox") {
      customer.savingsBalance -= Number(amount);
      transaction.balanceAfter = customer.savingsBalance;
      transaction.status = "successful";

      // ✅ Notifications inside transaction
      await Notification.create(
        [{
          userId: customer._id,
          userModel: "Customer",
          title: "Savings Withdrawal Successful",
          message: `You have withdrawn KES ${amount} from your savings.`,
          type: "withdraw", // MUST match enum
        }],
        { session }
      );

      await customer.save({ session });
      await transaction.save({ session });

      await session.commitTransaction();
      session.endSession();

      // SMS outside transaction (won't affect rollback)
      sendSMS(
        customer.phone,
        `✅ You have withdrawn KES ${amount} from your savings. New balance: KES ${customer.savingsBalance}.`
      ).catch(console.error);

      return res.status(200).json({
        message: "Withdrawal successful (sandbox)",
        transaction
      });
    }
const phoneNumber =  borrower.phone;
    // --- LIVE MODE: B2C ---
    const b2cResponse = await initiateB2C(phoneNumber, amount);
    transaction.checkoutRequestID = b2cResponse.OriginatorConversationID || null;

    // Notifications inside transaction
    await Notification.create(
      [{
        userId: customer._id,
        userModel: "Customer",
        title: "Savings Withdrawal Initiated",
        message: `KES ${amount} withdrawal initiated. Await confirmation from M-Pesa.`,
        type: "withdraw", // MUST match enum
      }],
      { session }
    );

    await transaction.save({ session });
    await session.commitTransaction();
    session.endSession();

    // SMS outside transaction
    sendSMS(
      customer.phone,
      `✅ KES ${amount} withdrawal initiated. Please check M-Pesa for confirmation.`
    ).catch(console.error);

    return res.status(200).json({
      message: "Withdrawal request sent to M-Pesa. Awaiting confirmation.",
      transaction,
      b2cResponse
    });

  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    console.error("❌ Customer Withdrawal Error:", error);
    return res.status(500).json({
      message: "Error processing savings withdrawal",
      error: error.message
    });
  }
};


