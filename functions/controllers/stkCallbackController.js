const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Loan = require("../models/Loan");
const Customer = require("../models/customer");  
const Notification = require("../models/Notification");
const mongoose = require("mongoose");
const { reverseTransaction } = require("../utils/mpesa");
const { sendSMS } = require("../utils/sms");
const AgentCommission = require('../models/AgentCommission');
const Profile = require("../models/Profile");
const AgentModel = require("../models/AgentModel");

// Single callback for all STK Push transactions


// ✅ STK Callback Controller


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

    // ✅ Check for M-Pesa failure FIRST
    if (ResultCode !== 0) {
      console.log("❌ M-Pesa reported FAILURE - Handling failed transaction...");

      transaction.status = "failed";
      transaction.mpesaPayload = callbackData;
      transaction.failureReason = ResultDesc;
      
      await transaction.save({ session });

      // ✅ FAILURE NOTIFICATIONS (outside transaction)
      const failureTasks = [];

      /* ------------------ ❌ Case 1: Savings Deposit Failure ------------------ */
      if (transaction.type === "savings") {
        const user = await User.findById(transaction.userId).session(session);
        const profile = await Profile.findOne({ userId: transaction.userId }).session(session);
        const fullName = profile?.fullName || "Customer";

        if (user) {
          failureTasks.push(async () => {
            await sendSMS(
              user.phone,
              `Dear ${fullName}, your deposit of KES ${transaction.amount} was not processed. \nReason: ${ResultDesc}. \nREF: ${transaction._id}\nFor assistance, contact izifinance Support.`
            );
            await Notification.create({
              userId: user._id,
              userModel: transaction.userModel,
              title: "Deposit Failed",
              message: `Deposit of KES ${transaction.amount} failed. Reason: ${ResultDesc}`,
              type: "deposit_failed",
            });
          });
        }
      }

      /* ------------------ ❌ Case 2: Customer Deposit Failure ------------------ */
      else if (transaction.type === "customer deposit") {
        const customer = await Customer.findById(transaction.userId).session(session);
        const customerName = customer?.fullName || "Customer";

        if (customer) {
          failureTasks.push(async () => {
            await sendSMS(
              customer.phone,
              `Dear ${customerName}, your savings deposit of KES ${transaction.amount} was not processed. \nReason: ${ResultDesc}. \nREF: ${transaction._id}\nFor assistance, contact izifinance Support.`
            );
            await Notification.create({
              userId: customer._id,
              userModel: "Customer",
              title: "Savings Deposit Failed",
              message: `Deposit of KES ${transaction.amount} failed. Reason: ${ResultDesc}`,
              type: "deposit_failed",
            });
          });
        }
      }

      /* ------------------ ❌ Case 3: Loan Repayment Failure ------------------ */
      else if (transaction.type === "repayment") {
        const borrower = await Customer.findById(transaction.userId).session(session);
        const borrowerName = borrower?.fullName || "Borrower";

        if (borrower) {
          failureTasks.push(async () => {
            await sendSMS(
              borrower.phone,
              `Dear ${borrowerName}, your loan repayment of KES ${transaction.amount} was not processed. \nReason: ${ResultDesc}. \nREF: ${transaction._id}\nPlease try again.\n- izifinance Support`
            );
            
            // Notify lender about failed repayment
            const loan = await Loan.findById(transaction.loanId);
            if (loan && loan.lenderId) {
              const lenderProfile = await Profile.findOne({ userId: loan.lenderId });
              const lenderName = lenderProfile?.fullName || "Lender";
              
              await Notification.create({
                userId: loan.lenderId,
                userModel: "User",
                title: "Loan Repayment Failed",
                message: `${borrowerName}'s repayment of KES ${transaction.amount} failed. Reason: ${ResultDesc}`,
                type: "repayment_failed",
              });

              await sendSMS(
                loan.lenderId.phone,
                `Dear ${lenderName}, the loan repayment of KES ${transaction.amount} from ${borrowerName} has failed. \nReason: ${ResultDesc}. \nREF: ${transaction._id}\n- izifinance`
              );
            }
          });
        }
      }

      await session.commitTransaction();
      session.endSession();

      // ✅ Execute failure notifications AFTER DB commit
      await Promise.all(failureTasks.map(fn => fn()));

      return res.status(200).json({ message: "Transaction failed handled" });
    }   

    // ✅ CONTINUE WITH SUCCESSFUL TRANSACTIONS
    // ✅ 2. Find user dynamically (Customer or User)
    let UserModel;

    if (transaction.userModel === "User") {
      UserModel = User;
    } 
    else if (transaction.userModel === "Customer") {
      UserModel = Customer;
    } 
    else {
      throw new Error("Invalid userModel in transaction"); 
    }

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

    // ------- Load Profile (to get full name) -------
    const profile = await Profile.findOne({ userId: transaction.userId }).session(session);
    const fullName = profile?.fullName || "Customer";

    // ✅ Set status & transactionId FOR SUCCESSFUL TRANSACTIONS
    transaction.status = "successful";
    transaction.transactionId = MpesaReceiptNumber || transaction.transactionId;

    // ✅ Post-commit tasks (SMS / Notification)
    const postCommitTasks = [];

    /* ------------------ 💰 Case 1: Wallet Deposit (User Savings) ------------------ */
    if (transaction.type === "savings" && user) {
      transaction.balanceBefore = user.walletBalance;

      user.walletBalance += Number(Amount);
      transaction.balanceAfter = user.walletBalance;
      await user.save({ session });

      postCommitTasks.push(async () => {
        await sendSMS(
          user.phone,
          `Dear ${fullName}, your wallet deposit of KES ${Amount} has been processed successfully. \nNew wallet balance: KES ${user.walletBalance}. \nREF: ${transaction._id}\nThank you for choosing izifinance.`
        );
        await Notification.create({
          userId: user._id,
          userModel: transaction.userModel,
          title: "Deposit Successful",
          message: `Deposit of KES ${Amount} received. Wallet balance: KES ${user.walletBalance}.`,
          type: "deposit",
        });
      });
    }

    /* ------------------ 💵 Case 2: Customer Deposit (Savings Balance) --------------- */
    else if (transaction.type === "customer deposit") {
      // Fetch borrower from Customer model (because userModel = "Customer")
      const customer = await Customer.findById(transaction.userId).session(session);
      const customerName = customer?.fullName || "Customer";

      transaction.balanceBefore = customer.savingsBalance;

      customer.savingsBalance += Number(Amount);
      transaction.balanceAfter = customer.savingsBalance;
      await customer.save({ session });

      const accountRef = transaction.accountReference || customerName;

      postCommitTasks.push(async () => {
        // ⭐ Updated SMS using customerName from Customer model
        await sendSMS(
          customer.phone,
          `Dear ${customerName}, your savings deposit of KES ${Amount} has been processed successfully. \nNew savings balance: KES ${customer.savingsBalance}. \nREF: ${transaction._id}\nThank you for saving with izifinance.`
        );

        await Notification.create({
          userId: customer._id,
          userModel: "Customer",
          title: "Savings Deposit Successful",
          message: `KES ${Amount} saved into (${accountRef}). New savings balance: KES ${customer.savingsBalance}.`,
          type: "deposit",
        });
      });
    }

    /* ------------------ 📉 Case 3: Loan Repayment ------------------ */
    else if (transaction.type === "repayment") {
      // ⭐ Correct borrower lookup — get exact customer record
      const borrower = await Customer.findById(transaction.userId).session(session);
      const borrowerName = borrower?.fullName || "Borrower";

      const loan = await Loan.findById(transaction.loanId).session(session);

      if (loan && borrower) {
        transaction.balanceBefore = loan.balance;

        loan.repaidAmount += Number(Amount);
        loan.balance -= Number(Amount);

        let isFullyRepaid = false;
        if (loan.balance <= 0) {
          loan.balance = 0;
          loan.status = "fully paid";
          isFullyRepaid = true;
          
          // ✅ AGENT COMMISSION FOR FULL REPAYMENT
          if (loan.requestedByAgentId) {
            await handleAgentFullRepaymentCommission(loan, transaction, session);
          }
        }

        loan.repayments.push({
          amount: Number(Amount),
          transactionId: transaction.transactionId,
          date: new Date(),
        });

        await loan.save({ session });


        // ⭐ Add repayment amount to lender wallet
const lender = await User.findById(loan.lenderId).session(session);

if (lender) {
  const lenderBalanceBefore = lender.walletBalance;
  lender.walletBalance += Number(Amount);
  await lender.save({ session });

  transaction.lenderBalanceBefore = lenderBalanceBefore;
  transaction.lenderBalanceAfter = lender.walletBalance;
  
  console.log(`💰 Added KES ${Amount} to lender (${lender._id}) wallet. New balance: ${lender.walletBalance}`);
}

        borrower.loanBalance = loan.balance;
        transaction.balanceAfter = loan.balance;
        await borrower.save({ session });

        // ⭐ Get lender details for notification
        const lenderProfile = await Profile.findOne({ userId: loan.lenderId });
        const lenderName = lenderProfile?.fullName || "Lender";

        postCommitTasks.push(async () => {
          // 📲 SMS to Borrower — WITH NAME FIXED
          await sendSMS(
            borrower.phone,
            `Dear ${borrowerName}, your loan repayment of KES ${Amount} has been processed successfully. \nRemaining loan balance: KES ${loan.balance}. \nREF: ${transaction._id}\nThank you for your timely payment.\n- izifinance`
          );

          // 🔔 Notification to Lender
          await Notification.create({
            userId: loan.lenderId,
            userModel: "User",
            title: "Loan Repayment Received",
            message: `${borrowerName} repaid KES ${Amount}. Remaining balance: KES ${loan.balance}.`,
            type: "repayment",
          });

          // 📲 SMS to Lender
          await sendSMS(
            loan.lenderId.phone,
            `Dear ${lenderName}, loan repayment of KES ${Amount} has been received from ${borrowerName}. \nRemaining balance: KES ${loan.balance}. \nREF: ${transaction._id}\n- izifinance`
          );

          // 🎯 Notify Agent if fully paid
          if (isFullyRepaid && loan.requestedByAgentId) {
            const agent = await AgentModel.findById(loan.requestedByAgentId);
            const agentName = agent?.fullName || "Agent";
            
            await Notification.create({
              userId: loan.requestedByAgentId,
              userModel: "Agent",
              title: "Loan Fully Repaid",
              message: `Loan for ${borrowerName} is now fully repaid. Commission recorded.`,
              type: "commission",
            });

            await sendSMS(
              loan.requestedByAgentId.phone,
              `Dear ${agentName}, the loan for ${borrowerName} has been fully repaid. \nYour commission has been recorded and will be processed accordingly. \nREF: ${transaction._id}\n- izifinance`
            );
          }
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





// ✅ Agent Commission Handler for Full Repayment
const handleAgentFullRepaymentCommission = async (loan, transaction, session) => {
  try {
    const FIXED_REPAYMENT_COMMISSION = 100;
    
    // Check if commission already exists to prevent duplicates
    const existingCommission = await AgentCommission.findOne({
      agentId: loan.requestedByAgentId,
      loanId: loan._id,
      commissionType: "full_repayment"
    }).session(session);

    if (existingCommission) {
      console.log(`🔄 Full repayment commission already exists for agent ${loan.requestedByAgentId} and loan ${loan._id}`);
      return;
    }

    // Create new commission record
    const commission = new AgentCommission({
      agentId: loan.requestedByAgentId,
      loanId: loan._id,
      commissionType: "full_repayment",
      amount: FIXED_REPAYMENT_COMMISSION,
      status: "earned",
      transactionId: transaction._id,
      earnedAt: new Date()
    });

    await commission.save({ session });
    
    console.log(`💰 Full repayment commission of KES ${FIXED_REPAYMENT_COMMISSION} recorded for agent ${loan.requestedByAgentId}`);

    // ✅ Optional: Add commission to agent's wallet balance here if needed
    const agent = await AgentModel.findById(loan.requestedByAgentId).session(session);
    if (agent) {
      agent.walletBalance += FIXED_REPAYMENT_COMMISSION;
      await agent.save({ session });
      console.log(`💰 Commission added to agent wallet: KES ${FIXED_REPAYMENT_COMMISSION}`);
    }

  } catch (error) {
    console.error("❌ Error handling agent full repayment commission:", error);
    throw error; // Re-throw to be handled by main callback
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



