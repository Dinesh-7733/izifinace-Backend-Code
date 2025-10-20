const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Loan = require("../models/Loan");
const Borrower = require ("../models/customer");
const Notification = require("../models/Notification");
const mongoose = require("mongoose");
const { reverseTransaction } = require("../utils/mpesa");
// Single callback for all STK Push transactions


exports.stkCallback = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const callbackData = req.body;
    console.log("STK Callback Received:", JSON.stringify(callbackData, null, 2));

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } =
      callbackData.Body.stkCallback;

    // Extract Amount & MpesaReceiptNumber
    let Amount = 0;
    let MpesaReceiptNumber = "";
    if (CallbackMetadata && CallbackMetadata.Item) {
      CallbackMetadata.Item.forEach((item) => {
        if (item.Name === "Amount") Amount = item.Value;
        if (item.Name === "MpesaReceiptNumber") MpesaReceiptNumber = item.Value;
      });
    }

    // 1️⃣ Find the transaction
    const transaction = await Transaction.findOne({ checkoutRequestID: CheckoutRequestID }).session(session);
    if (!transaction) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Transaction not found" });
    }

    // ⚠️ Duplicate callback protection
    if (transaction.status === "successful") {
      console.log("⚠️ Duplicate callback ignored for transaction:", transaction._id);
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ message: "Duplicate callback ignored" });
    }

    // Check for invalid borrower (wrong ID / typo)
    let borrower = null;
    if (transaction.type === "repayment") {
      borrower = await Borrower.findById(transaction.userId).session(session);
      if (!borrower) {
        console.log("Invalid borrower detected, triggering reversal...");
        await reverseTransaction(CheckoutRequestID, Amount, transaction.sender);
        transaction.status = "reversed";
        await transaction.save({ session });
        await session.commitTransaction();
        session.endSession();
        return res.status(200).json({ message: "Reversal triggered due to invalid borrower" });
      }
    }

    // Update transaction status & receipt
    transaction.status = ResultCode === 0 ? "successful" : "failed";
    transaction.transactionId = MpesaReceiptNumber || transaction.transactionId;

    // Post-commit async tasks
    const postCommitTasks = [];

    // 2️⃣ Handle transaction types
    if (transaction.type === "savings") {
      const user = await User.findById(transaction.userId).session(session);

      if (user && transaction.status === "successful") {
        user.walletBalance += Number(Amount);
        await user.save({ session });

        transaction.balanceAfter = user.walletBalance;

        postCommitTasks.push(async () => {
          await sendSMS(
            user.phone,
            `✅ Dear ${user.fullName || "User"}, your deposit of KES ${Amount} was successful. 
Your new wallet balance is KES ${user.walletBalance}.`
          );
          await Notification.create({
            userId: user._id,
            userModel: "User",
            title: "Deposit Successful",
            message: `Deposit of KES ${Amount} received. Wallet balance: KES ${user.walletBalance}.`,
            type: "deposit",
          });
        });
      } else {
        transaction.balanceAfter = user ? user.walletBalance : 0;
      }
    } else if (transaction.type === "repayment") {
      const loan = await Loan.findById(transaction.loanId).session(session);

      if (loan && borrower && transaction.status === "successful") {
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

        borrower.loanBalance = loan.balance;
        await borrower.save({ session });

        transaction.balanceAfter = loan.balance;

        postCommitTasks.push(async () => {
          await sendSMS(
            borrower.phone,
            `✅ Dear ${borrower.fullName}, repayment of KES ${Amount} received. Remaining loan balance: KES ${loan.balance}.`
          );
          await Notification.create({
            userId: loan.lenderId,
            userModel: "User",
            title: "Loan Repayment Received",
            message: `Borrower ${borrower.fullName} repaid KES ${Amount}. Remaining balance: KES ${loan.balance}.`,
            type: "repayment",
          });
        });
      } else {
        transaction.balanceAfter = loan ? loan.balance : 0;
      }
    }

    // 3️⃣ Save transaction updates
    await transaction.save({ session });

    // ✅ Commit transaction
    await session.commitTransaction();
    session.endSession();

    // 4️⃣ Execute post-commit tasks
    for (const task of postCommitTasks) {
      try {
        await task();
      } catch (err) {
        console.error("⚠️ Post-commit task failed:", err);
      }
    }

    res.status(200).json({ message: "STK callback processed", transaction });
  } catch (error) {
    try {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
    } catch (_) {}
    finally {
      session.endSession();
    }
    console.error("❌ STK callback error:", error);
    res.status(500).json({ message: "Error processing STK callback", error: error.message });
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



