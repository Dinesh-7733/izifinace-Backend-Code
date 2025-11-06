const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Loan = require("../models/Loan");
const Borrower = require ("../models/customer");
const Notification = require("../models/Notification");
const mongoose = require("mongoose");
const { reverseTransaction } = require("../utils/mpesa");
const { sendSMS } = require("../utils/sms");
// Single callback for all STK Push transactions


// ✅ STK Callback Controller
exports.stkCallback = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const callbackData = req.body;
    console.log("📥 STK Callback Received:", JSON.stringify(callbackData, null, 2));

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } =
      callbackData?.Body?.stkCallback || {};

    if (!CheckoutRequestID) throw new Error("CheckoutRequestID missing in callback");

    // ✅ Extract Amount & MpesaReceiptNumber
    let Amount = 0;
    let MpesaReceiptNumber = "";
    if (CallbackMetadata?.Item) {
      CallbackMetadata.Item.forEach(item => {
        if (item.Name === "Amount") Amount = item.Value;
        if (item.Name === "MpesaReceiptNumber") MpesaReceiptNumber = item.Value;
      });
    }

    // ✅ 1. Find the transaction
    const transaction = await Transaction.findOne({ checkoutRequestID: CheckoutRequestID }).session(session);
    if (!transaction) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Transaction not found" });
    }

    // ✅ Prevent duplicate callback
    if (transaction.status === "successful") {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ message: "Duplicate callback ignored" });
    }

    // ✅ 2. Find user dynamically (Customer or User)
    const UserModel = transaction.userModel === "User" ? User : Borrower;
    console.log("UserModel resolved as:", UserModel.modelName);

    let user = await UserModel.findById(transaction.userId).session(session);

    // ❌ If repayment & user not found → Reverse
    if (transaction.type === "repayment" && !user) {
      await reverseTransaction(CheckoutRequestID, Amount, transaction.phone);
      transaction.status = "reversed";
      await transaction.save({ session });
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ message: "Reversal triggered due to invalid borrower" });
    }

    // ✅ Set status & transactionId
    transaction.status = ResultCode === 0 ? "successful" : "failed";
    transaction.transactionId = MpesaReceiptNumber || transaction.transactionId;

    // ✅ Post-commit tasks (SMS / Notification)
    const postCommitTasks = [];

    /* ------------------ 💰 Case 1: Wallet Deposit (User Savings) ------------------ */
    if (transaction.type === "savings" && user) {
      transaction.balanceBefore = user.walletBalance;

      if (transaction.status === "successful") {
        user.walletBalance += Number(Amount);
        transaction.balanceAfter = user.walletBalance;
        await user.save({ session });

        postCommitTasks.push(async () => {
          await sendSMS(user.phone,
            `✅ Dear ${user.fullName || "User"}, your deposit of KES ${Amount} was successful. Wallet balance: KES ${user.walletBalance}.`
          );
          await Notification.create({
            userId: user._id,
            userModel: transaction.userModel,
            title: "Deposit Successful",
            message: `Deposit of KES ${Amount} received. Wallet balance: KES ${user.walletBalance}.`,
            type: "deposit",
          });
        });
      } else {
        transaction.balanceAfter = transaction.balanceBefore;
      }
    }

    /* ------------------ 💵 Case 2: Customer Deposit (Savings Balance) --------------- */
    else if (transaction.type === "customer deposit" && user) {
      transaction.balanceBefore = user.savingsBalance;

      if (transaction.status === "successful") {
        user.savingsBalance += Number(Amount);
        transaction.balanceAfter = user.savingsBalance;
        await user.save({ session });

        postCommitTasks.push(async () => {
          await sendSMS(
            user.phone,
            `✅ Dear ${user.fullName}, deposit of KES ${Amount} successful. Savings balance: KES ${user.savingsBalance}.`
          );
          await Notification.create({
            userId: user._id,
            userModel: "Customer",
            title: "Deposit Successful",
            message: `KES ${Amount} added to savings. New balance: KES ${user.savingsBalance}.`,
            type: "deposit",
          });
        });
      } else {
        transaction.balanceAfter = transaction.balanceBefore;
      }
    }

    /* ------------------ 📉 Case 3: Loan Repayment ------------------ */
    else if (transaction.type === "repayment") {
      const loan = await Loan.findById(transaction.loanId).session(session);

      if (loan && user && transaction.status === "successful") {
        transaction.balanceBefore = loan.balance;

        loan.repaidAmount += Number(Amount);
        loan.balance -= Number(Amount);
        if (loan.balance <= 0) {
          loan.balance = 0;
          loan.status = "fully paid";
        }

        loan.repayments.push({
          amount: Number(Amount),
          transactionId: transaction.transactionId,
          date: new Date(),
        });

        await loan.save({ session });

        user.loanBalance = loan.balance;
        transaction.balanceAfter = loan.balance;
        await user.save({ session });

        postCommitTasks.push(async () => {
          await sendSMS(
            user.phone,
            `✅ Dear ${user.fullName}, repayment of KES ${Amount} received. Remaining loan balance: KES ${loan.balance}.`
          );
          await Notification.create({
            userId: loan.lenderId,
            userModel: "User",
            title: "Loan Repayment Received",
            message: `Borrower ${user.fullName} repaid KES ${Amount}. Balance: ${loan.balance}.`,
            type: "repayment",
          });
        });
      }
    }

    // ✅ 3. Save transaction
    await transaction.save({ session });

    // ✅ 4. Commit transaction
    await session.commitTransaction();
    session.endSession();

    // ✅ 5. Execute SMS & notifications AFTER DB commit
    await Promise.all(postCommitTasks.map(fn => fn()));

    return res.status(200).json({ message: "STK Callback processed", transaction });

  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    console.error("❌ STK callback error:", error);
    return res.status(500).json({ message: "Error processing callback", error: error.message });
  }
};

exports.reversalResultHandler = async(req, res) =>{
  console.log("Reversal result received:", req.body);
  // Update transaction.status if needed
  res.status(200).send("Received");
}

exports.reversalTimeoutHandler = async(req, res)=> {
  console.log("Reversal timeout received:", req.body);
  res.status(200).send("Timeout received");
}



