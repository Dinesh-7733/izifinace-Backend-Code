const Transaction = require("../models/Transaction");
const User = require("../models/User");
const Borrower = require("../models/customer");
const Loan = require("../models/Loan");
const Notification = require("../models/Notification");
const mongoose = require("mongoose");
const { sendSMS } = require("../utils/sms");


exports.b2cCallback = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const postCommitTasks = [];

  try {
    const callback = req.body;
    console.log("✅ Full B2C Callback:", JSON.stringify(callback, null, 2));

    const { Result } = callback.Body || {};
    if (!Result) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Invalid B2C callback data" });
    }

    const { ResultCode, ResultDesc, OriginatorConversationID, TransactionID } = Result;
    console.log("👉 ResultCode:", ResultCode, "(", ResultDesc, ")");

    const transaction = await Transaction.findOne({
      checkoutRequestID: OriginatorConversationID,
    }).session(session);

    if (!transaction) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Transaction not found" });
    }

    // Idempotency check
    if (transaction.status === "successful") {
      await session.endSession();
      return res.status(200).json({ message: "Transaction already processed" });
    }

    // Handle failed transaction
    if (ResultCode !== 0) {
      transaction.status = "failed";
      transaction.mpesaPayload = Result;
      await transaction.save({ session });

      if (transaction.type === "loan issued") {
        const loan = await Loan.findOne({
          borrowerId: transaction.userId,
          amount: transaction.amount,
          status: "pending",
        }).session(session);
        if (loan) {
          loan.status = "failed";
          await loan.save({ session });
          console.log(`❌ Loan of ${loan.amount} marked as failed`);
        }
      }

      if (transaction.type === "customer withdrawal") {
        const customer = await Borrower.findById(transaction.userId).session(session);
        if (customer) {
          customer.savingsBalance += transaction.amount; // refund
          await customer.save({ session });
          console.log(`❌ Customer withdrawal of ${transaction.amount} rolled back`);
        }
      }

      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ message: "Transaction failed, data updated" });
    }

    // Successful transaction
    transaction.status = "successful";
    transaction.transactionId = TransactionID || OriginatorConversationID;
    transaction.mpesaPayload = Result;

    // --- Customer Withdrawal ---
    if (transaction.type === "customer withdrawal") {
      const customer = await Borrower.findById(transaction.userId).session(session);
      if (customer) {
        customer.savingsBalance -= transaction.amount;
        transaction.balanceAfter = customer.savingsBalance;

        await customer.save({ session });
        await transaction.save({ session });

        postCommitTasks.push(async () => {
          await Notification.create({
            userId: customer._id,
            userModel: "Customer",
            title: "Withdrawal Successful",
            message: `KES ${transaction.amount} withdrawn from your savings successfully.`,
            type: "withdraw",
          });
          await sendSMS(
            customer.phone,
            `✅ KES ${transaction.amount} withdrawn from your savings. New balance: KES ${customer.savingsBalance}.`
          );
        });
      }
    }

    // --- User Wallet Withdrawal ---
    if (transaction.type === "withdrawal") {
      const user = await User.findById(transaction.userId).session(session);
      if (user) {
        user.walletBalance -= transaction.amount;
        await user.save({ session });

        postCommitTasks.push(async () => {
          await Notification.create({
            userId: user._id,
            userModel: "User",
            title: "Withdrawal Successful",
            message: `KES ${transaction.amount} withdrawn from your wallet.`,
            type: "withdraw",
          });
          await sendSMS(user.phone, `✅ KES ${transaction.amount} withdrawn from your wallet.`);
        });
      }
    }

    // --- Loan Issuance ---
    if (transaction.type === "loan issued") {
      const borrower = await Borrower.findById(transaction.userId).session(session);
      if (borrower) {
        const loan = await Loan.findOne({
          borrowerId: borrower._id,
          amount: transaction.amount,
          status: "pending",
        }).sort({ createdAt: -1 }).session(session);

        if (loan) {
          loan.status = "active";
          loan.balance = loan.totalRepayment || loan.amount;
          await loan.save({ session });

          postCommitTasks.push(async () => {
            await Notification.create({
              userId: borrower._id,
              userModel: "Customer",
              title: "Loan Issued",
              message: `✅ Hello ${borrower.fullName}, your loan of KES ${loan.amount} has been issued. Total repayment: KES ${loan.totalRepayment}. Due date: ${loan.dueDate.toDateString()}`,
              type: "loan",
            });
            await sendSMS(
              borrower.phone,
              `✅ Hello ${borrower.fullName}, your loan of KES ${loan.amount} is now active. Total repayment: KES ${loan.totalRepayment}, due date: ${loan.dueDate.toDateString()}`
            );

            const lender = await User.findById(loan.lenderId);
            if (lender) {
              await Notification.create({
                userId: lender._id,
                userModel: "User",
                title: "Loan Disbursed",
                message: `Loan of KES ${loan.amount} disbursed to ${borrower.fullName} (Phone: ${borrower.phone}).`,
                type: "loan_approved",
              });
            }
          });
        }
      }
    }

    await session.commitTransaction();
    session.endSession();

    // Execute post-commit tasks in parallel
    await Promise.all(postCommitTasks.map(task => task().catch(console.error)));

    return res.status(200).json({ message: "B2C callback processed successfully" });

  } catch (error) {
    try {
      if (session.inTransaction()) await session.abortTransaction();
    } catch (_) {}
    finally {
      session.endSession();
    }

    console.error("🔥 B2C Callback Error:", error);
    return res.status(500).json({ message: "Server error in B2C callback", error: error.message });
  }
};
