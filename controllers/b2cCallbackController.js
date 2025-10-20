const Transaction = require("../models/Transaction");
const User = require("../models/User");
const Borrower = require("../models/customer");
const Loan = require("../models/Loan");
const Notification = require("../models/Notification");
const mongoose = require("mongoose");


exports.b2cCallback = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  // Collect async tasks (run after commit)
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
    console.log("👉 TransactionID:", TransactionID);

    // Find transaction by OriginatorConversationID
    const transaction = await Transaction.findOne({
      checkoutRequestID: OriginatorConversationID,
    }).session(session);

    if (!transaction) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Transaction not found" });
    }

    // Handle failed transaction
    if (ResultCode !== 0) {
      await Transaction.deleteOne({ _id: transaction._id }).session(session);

      const loan = await Loan.findOne({
        borrowerId: transaction.borrowerId,
        amount: transaction.amount,
        status: "pending",
      }).session(session);

      if (loan) {
        await Loan.deleteOne({ _id: loan._id }).session(session);
        console.log(`❌ Loan of ${loan.amount} deleted due to transaction failure`);
      }

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({ message: "Transaction failed, created data removed" });
    }

    // Successful transaction
    transaction.status = "successful";
    transaction.transactionId = TransactionID || OriginatorConversationID;
    await transaction.save({ session });

    // Withdrawals
    if (transaction.type === "withdrawal") {
      const user = await User.findById(transaction.userId).session(session);
      if (user) {
        user.walletBalance -= transaction.amount;
        await user.save({ session });

        // Run after commit
        postCommitTasks.push(async () => {
          await Notification.create({
            userId: user._id,
            userModel: "User",
            title: "Withdrawal Successful",
            message: `KES ${transaction.amount} withdrawn from your wallet.`,
            type: "withdraw",
          });
          await sendSMS(user.phone, `✅ KES ${transaction.amount} has been withdrawn from your wallet.`);
        });
      }
    }

    // Loan issuance
    else if (transaction.type === "loan issued") {
      const borrower = await Borrower.findById(transaction.borrowerId).session(session);
      if (borrower) {
        borrower.savingsBalance = (borrower.savingsBalance || 0) + transaction.amount;
        await borrower.save({ session });

        const loan = await Loan.findOne({
          borrowerId: transaction.borrowerId,
          amount: transaction.amount,
          status: "pending",
        }).sort({ createdAt: -1 }).session(session);

        if (loan) {
          loan.status = "active";
          loan.balance = loan.totalRepayment || loan.amount;
          await loan.save({ session });

          postCommitTasks.push(async () => {

              // ✅ Borrower Notification
        await Notification.create({
          userId: borrower._id,
          userModel: "Customer", // 👈 matches your refPath
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

    // 🔹 Run post-commit tasks
    for (const task of postCommitTasks) {
      try {
        await task();
      } catch (err) {
        console.error("⚠️ Post-commit task failed:", err);
      }
    }

    return res.status(200).json({ message: "B2C callback processed successfully" });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("🔥 B2C Callback Error:", error);
    return res.status(500).json({ message: "Server error in B2C callback", error: error.message });
  }
};