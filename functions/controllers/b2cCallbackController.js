const Transaction = require("../models/Transaction");
const User = require("../models/User");
const Borrower = require("../models/customer");
const Loan = require("../models/Loan");
const Notification = require("../models/Notification");
const mongoose = require("mongoose");
const { sendSMS } = require("../utils/sms");
const AgentCommission = require("../models/AgentCommission");
const AgentModel = require("../models/AgentModel");
const Profile = require("../models/Profile");
const WithdrawRequest = require("../models/WithdrawRequest");

// B2C Callback Handler
exports.b2cCallback = async (req, res) => {
  console.log("\n📥 B2C CALLBACK RECEIVED");
  console.log("==============================\n");

let session;

  const postCommitTasks = [];

  try {
    const callback = req.body;
    console.log("📩 Raw Callback Body:", JSON.stringify(callback, null, 2));

    // ✅ IMPROVED CALLBACK PARSING - Handle ALL M-Pesa B2C formats
    let Result, ResultCode, ResultDesc, OriginatorConversationID, ConversationID, MpesaTransactionID;

    // FORMAT 1: Standard M-Pesa B2C Callback Format
    if (callback?.Result) {
      console.log("🔧 Detected Format 1: Standard B2C Callback");
      Result = callback.Result;
      ResultCode = Result.ResultCode;
      ResultDesc = Result.ResultDesc;
      OriginatorConversationID = Result.OriginatorConversationID;
      ConversationID = Result.ConversationID;
      
      // Extract TransactionID from ResultParameters if available
      if (Result.ResultParameters && Result.ResultParameters.ResultParameter) {
        const resultParams = Result.ResultParameters.ResultParameter;
        if (Array.isArray(resultParams)) {
          const transactionParam = resultParams.find(param => 
            param.Key === "TransactionID" || param.Key === "TransactionReceipt"
          );
          if (transactionParam) {
            MpesaTransactionID = transactionParam.Value;
          }
        }
      }
      
      // Fallback to direct TransactionID
      if (!MpesaTransactionID) {
        MpesaTransactionID = Result.TransactionID;
      }
    }
    // FORMAT 2: Direct properties (Manual testing format)
    else if (callback?.ResultCode !== undefined || callback?.resultCode !== undefined) {
      console.log("🔧 Detected Format 2: Direct Properties");
      Result = callback;
      ResultCode = callback.ResultCode || callback.resultCode;
      ResultDesc = callback.ResultDesc || callback.resultDesc;
      OriginatorConversationID = callback.OriginatorConversationID || callback.originatorConversationID;
      ConversationID = callback.ConversationID || callback.conversationID;
      MpesaTransactionID = callback.TransactionID || callback.transactionID || callback.MpesaTransactionID;
    }
    // FORMAT 3: STK-like format (uncommon for B2C but possible)
    else if (callback?.Body?.stkCallback) {
      console.log("🔧 Detected Format 3: STK-like Format");
      Result = callback.Body.stkCallback;
      ResultCode = Result.ResultCode;
      ResultDesc = Result.ResultDesc;
      OriginatorConversationID = callback.Body.OriginatorConversationID || callback.Body.originatorConversationID;
      ConversationID = callback.Body.ConversationID || callback.Body.conversationID;
      MpesaTransactionID = Result.TransactionID;
    }
    // FORMAT 4: Nested Result object with different structure
    else {
      console.log("🔧 Detected Format 4: Unknown - Attempting deep search");
      // Deep search for common fields
      Result = callback;
      ResultCode = findNestedValue(callback, ['ResultCode', 'resultCode', 'Result.ResultCode']);
      ResultDesc = findNestedValue(callback, ['ResultDesc', 'resultDesc', 'Result.ResultDesc']);
      OriginatorConversationID = findNestedValue(callback, ['OriginatorConversationID', 'originatorConversationID', 'Result.OriginatorConversationID']);
      ConversationID = findNestedValue(callback, ['ConversationID', 'conversationID', 'Result.ConversationID']);
      MpesaTransactionID = findNestedValue(callback, ['TransactionID', 'transactionID', 'MpesaTransactionID', 'Result.TransactionID']);
    }

    console.log(`🔍 Parsed B2C Callback:
      ➤ ResultCode: ${ResultCode} (${ResultDesc})
      ➤ ConversationID: ${ConversationID}
      ➤ OriginatorConversationID: ${OriginatorConversationID}
      ➤ MpesaTransactionID: ${MpesaTransactionID}
    `);

    // ✅ TRANSACTION MATCHING - Multiple strategies
  
let transaction = await Transaction.findOne({
  $or: [
    { checkoutRequestID: OriginatorConversationID },
    { conversationID: ConversationID }
  ]
});

if (!transaction) {
  return res.status(200).json({ message: "No transaction found" });
}

if (transaction.status === "successful") {
  return res.status(200).json({ message: "Already processed" });
}

if (transaction.status === "failed") {
  return res.status(200).json({ message: "Already failed" });
}


    /* =====================================================
       3️⃣ START SESSION ONLY NOW
    ===================================================== */

   session = await mongoose.startSession();
session.startTransaction();


// STRATEGY 2: Match by OriginatorConversationID
if (!transaction && OriginatorConversationID) {
  transaction = await Transaction.findOne({
    $or: [
      { checkoutRequestID: OriginatorConversationID },
      { conversationID: OriginatorConversationID }
    ],
    status: "pending"
  }).session(session);

  if (transaction) {
    console.log(
      `✅ Found transaction by OriginatorConversationID: ${OriginatorConversationID}`
    );
  }
}

// STRATEGY 3: Match by MpesaTransactionID (Receipt)
if (!transaction && MpesaTransactionID) {
  transaction = await Transaction.findOne({
    mpesaTransactionID: MpesaTransactionID,
    status: "pending"
  }).session(session);

  if (transaction) {
    console.log(
      `✅ Found transaction by MpesaTransactionID: ${MpesaTransactionID}`
    );
  }
}


    if (!transaction) {
      console.log("❌ NO MATCHING PENDING TRANSACTION FOUND AFTER ALL ATTEMPTS");
      console.log("🔍 What we were looking for:");
      console.log("   - ConversationID:", ConversationID);
      console.log("   - OriginatorConversationID:", OriginatorConversationID);
      console.log("   - MpesaTransactionID:", MpesaTransactionID);
      
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ message: "No pending transaction found" });
    }

    console.log(`✅ Transaction Match Found: 
      ID: ${transaction._id}
      Type: ${transaction.type}
      Amount: ${transaction.amount}
      User: ${transaction.userId}
      Phone: ${transaction.phone}
      checkoutRequestID: ${transaction.checkoutRequestID}
      Created: ${transaction.createdAt}
    `);

    // ✅ PREVENT DOUBLE PROCESSING
    if (transaction.status !== "pending") {
      console.log(`⚠️ Transaction already ${transaction.status} - ignoring callback`);
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ message: "Transaction already processed" });
    }

    // ✅ FAILED PAYMENT FLOW
    if (ResultCode !== 0) {
      console.log("❌ M-Pesa reported FAILURE - Reversing transaction...");
      
      transaction.status = "failed";
      transaction.mpesaPayload = Result;
      transaction.failureReason = ResultDesc;
      
      await transaction.save({ session });

      // Handle reversal based on transaction type
      if (transaction.type === "loan issued") {
        console.log("🔄 Reversing loan disbursement...");
        const loan = await Loan.findById(transaction.loanId).session(session);
        if (loan) {
          // Reset loan status
          loan.status = "failed";
          loan.loanRequestStatus = "rejected";
          await loan.save({ session });

          // Reset agent commission
          if (loan.requestedByAgentId) {
            await AgentCommission.updateOne(
              { 
                agentId: loan.requestedByAgentId,
                loanId: loan._id,
                commissionType: "approval"
              },
              { 
                status: "cancelled",
                cancelledAt: new Date(),
                cancellationReason: `Loan disbursement failed: ${ResultDesc}`
              },
              { session }
            );
            console.log(`❌ Agent commission cancelled for loan ${loan._id}`);
          }
        }
      }
      else if (transaction.type === "withdrawal") {
        console.log("🔄 Withdrawal failed - no balance to reverse");
        const user = await User.findById(transaction.userId).session(session);
        if (user) {
          console.log(`⚠️ Withdrawal failed for user ${user._id} - balance was never deducted`);
        }
      }
      else if (transaction.type === "customer withdrawal") {
        console.log("🔄 Customer savings withdrawal failed - no balance to reverse");
        const customer = await Borrower.findById(transaction.userId).session(session);
        if (customer) {
          console.log(`⚠️ Customer withdrawal failed for ${customer._id} - savings balance was never deducted`);
        }
      }
 // 🔥 ADD AGENT WITHDRAWAL FAILURE HANDLING HERE
  else if (transaction.type === "agent withdrawal") {
    console.log("🔄 Agent withdrawal failed - no balance to reverse");
    const agent = await AgentModel.findById(transaction.userId).session(session);
    if (agent) {
      console.log(`⚠️ Agent withdrawal failed for ${agent._id} - balance was never deducted`);
      
      // Update withdrawal request status to failed
      const withdrawalRequest = await WithdrawRequest.findOne({ 
        transactionId: transaction._id 
      }).session(session);
      
      if (withdrawalRequest) {
        withdrawalRequest.status = "failed";
        withdrawalRequest.failureReason = ResultDesc;
        await withdrawalRequest.save({ session });
        
        // Send failure notification to agent
        postCommitTasks.push(async () => {
          await Notification.create({
            userId: agent._id,
            userModel: "Agent",
            title: "Withdrawal Failed",
            message: `Your withdrawal of KES ${transaction.amount} failed. Reason: ${ResultDesc}`,
            type: "withdrawal_failed",
          });

          await sendSMS(
            agent.phone,
            `Dear ${agent.fullName}, your withdrawal of KES ${transaction.amount} has failed. \nReason: ${ResultDesc}. \nREF: ${transaction._id}\nPlease try again or contact support.\n- izifinance Support`
          );
        });
      }
    }
  }

      await session.commitTransaction();
      session.endSession();

      // Send failure notifications
      postCommitTasks.push(async () => {
        try {
          if (transaction.type === "loan issued") {
            const loan = await Loan.findById(transaction.loanId)
              .populate('borrowerId')
              .populate('lenderId');
            
            if (loan && loan.borrowerId) {
              // Get borrower name from Customer model
              const borrower = await Borrower.findById(loan.borrowerId._id || loan.borrowerId);
              const borrowerName = borrower?.fullName || "Customer";
              
              await sendSMS(
                loan.borrowerId.phone,
                `Dear ${borrowerName}, your loan disbursement of KES ${transaction.amount} has failed. \nReason: ${ResultDesc}. \nREF: ${transaction._id}\nFor assistance, contact izifinance Support.`
              );
            }
          }
          else if (transaction.type === "withdrawal") {
            // For User withdrawals - get name from Profile
            const user = await User.findById(transaction.userId);
            if (user) {
              const profile = await Profile.findOne({ userId: user._id });
              const userName = profile?.fullName || "Customer";
              
              await sendSMS(
                user.phone,
                `Dear ${userName}, your withdrawal of KES ${transaction.amount} has failed. \nReason: ${ResultDesc}. \nREF: ${transaction._id}\nPlease try again.\n- izifinance Support`
              );
            }
          }
          else if (transaction.type === "customer withdrawal") {
            // For Customer withdrawals - get name from Customer model
            const customer = await Borrower.findById(transaction.userId);
            if (customer) {
              await sendSMS(
                customer.phone,
                `Dear ${customer.fullName}, your savings withdrawal of KES ${transaction.amount} has failed. \nReason: ${ResultDesc}. \nREF: ${transaction._id}\nPlease retry or contact support.\n- izifinance Support`
              );
            }
          }
        } catch (smsError) {
          console.error("Failed to send failure SMS:", smsError);
        }
      });

      // Execute post-commit tasks
      try {
        await Promise.all(postCommitTasks.map(fn => fn().catch(e => console.error("Post-commit task error:", e))));
      } catch (asyncError) {
        console.error("Some post-commit tasks failed:", asyncError);
      }

      return res.status(200).json({ message: "Transaction failed and reversed" });
    }

    // ✅ SUCCESS CASE HANDLING
    console.log("🎉 SUCCESS — Updating database...");

    transaction.status = "successful";
    transaction.transactionId = MpesaTransactionID || ConversationID || OriginatorConversationID;
    transaction.mpesaPayload = Result;
    transaction.processedAt = new Date();

    // Update checkoutRequestID if it wasn't set properly
    if (!transaction.checkoutRequestID && (ConversationID || OriginatorConversationID)) {
      transaction.checkoutRequestID = ConversationID || OriginatorConversationID;
    }

    // ✅ LOAN DISBURSEMENT HANDLING - DEDUCT LENDER BALANCE ONLY ON SUCCESS
    if (transaction.type === "loan issued") {
      console.log("💰 Processing loan disbursement...");
      
      const loan = await Loan.findById(transaction.loanId)
        .populate('borrowerId')
        .populate('requestedByAgentId')
        .populate('lenderId')
        .session(session);

      if (loan) {
        console.log(`📝 Updating loan ${loan._id} to active status`);
        
        // ✅ DEDUCT LENDER BALANCE ONLY WHEN M-PESA CONFIRMS SUCCESS
        const lender = await User.findById(loan.lenderId).session(session);
        if (lender) {
          const balanceBefore = lender.walletBalance;
          lender.walletBalance -= Number(transaction.amount);
          transaction.balanceBefore = balanceBefore;
          transaction.balanceAfter = lender.walletBalance;
          await lender.save({ session });
          console.log(`💸 Deducted ${transaction.amount} from lender ${lender._id}. New balance: ${lender.walletBalance}`);
        }
        
        // Update loan status to active
        loan.status = "active";
        loan.loanRequestStatus = "approved";
        loan.balance = loan.totalRepayment;
        loan.disbursedAt = new Date();
        
        await loan.save({ session });

        // Update borrower's loan balance
        const borrower = await Borrower.findById(loan.borrowerId).session(session);
        if (borrower) {
          borrower.loanBalance = (borrower.loanBalance || 0) + Number(loan.amount);
          await borrower.save({ session });
          console.log(`👤 Updated borrower ${borrower._id} loan balance to ${borrower.loanBalance}`);
        }

        // Update transaction
        await transaction.save({ session });

        // ✅ AGENT COMMISSION FOR LOAN DISBURSEMENT
        let commissionAmount = 0;
        
        if (loan.requestedByAgentId) {
          commissionAmount = loan.amount * 0.0495; // 4.95% commission
          
          const commissionUpdate = await AgentCommission.updateOne(
            { 
              agentId: loan.requestedByAgentId,
              loanId: loan._id,
              commissionType: "approval"
            },
            { 
              status: "earned",
              amount: commissionAmount,
              earnedAt: new Date(),
              transactionId: transaction._id
            },
            { session }
          );
          
          if (commissionUpdate.modifiedCount > 0) {
            console.log(`💰 Agent approval commission earned: KES ${commissionAmount} for loan ${loan._id}`);
            
            // Update agent's wallet
            const agent = await AgentModel.findById(loan.requestedByAgentId).session(session);
            if (agent) {
              agent.walletBalance += commissionAmount;
              agent.commissionEarned += commissionAmount;
              await agent.save({ session });
              console.log(`💰 Commission added to agent wallet: KES ${commissionAmount}. New balance: KES ${agent.walletBalance}`);
            }
          }
        }

        postCommitTasks.push(async () => {
          // Get borrower name from Customer model
          const borrower = await Borrower.findById(loan.borrowerId._id || loan.borrowerId);
          const borrowerName = borrower?.fullName || "Customer";
          
          // Get lender name from Profile
          const lenderProfile = await Profile.findOne({ userId: loan.lenderId._id || loan.lenderId });
          const lenderName = lenderProfile?.fullName || "Lender";

          // Notify borrower
          await Notification.create({
            userId: loan.borrowerId._id || loan.borrowerId,
            userModel: "Customer",
            title: "Loan Disbursed Successfully",
            message: `Your loan of KES ${loan.amount} has been sent to your M-Pesa account.`,
            type: "loan",
          });

          await sendSMS(
            loan.borrowerId.phone,
            `Dear ${borrowerName}, your loan of KES ${loan.amount} has been successfully disbursed to your M-Pesa account. \nTotal repayment: KES ${loan.totalRepayment} due on ${loan.dueDate.toLocaleDateString()}. \nREF: ${transaction._id}\nThank you for choosing izifinance.`
          );

          // Notify lender
          await Notification.create({
            userId: loan.lenderId._id || loan.lenderId,
            userModel: "User",
            title: "Loan Disbursed",
            message: `Loan of KES ${loan.amount} has been successfully sent to borrower ${borrowerName}.`,
            type: "loan",
          });

          await sendSMS(
            loan.lenderId.phone,
            `Dear ${lenderName}, a loan of KES ${loan.amount} has been disbursed to borrower ${borrowerName}. \nTotal repayment: KES ${loan.totalRepayment} due on ${loan.dueDate.toLocaleDateString()}. \nREF: ${transaction._id}\n- izifinance`
          );

          // Notify agent about commission
          if (loan.requestedByAgentId) {
            const agent = await AgentModel.findById(loan.requestedByAgentId);
            const agentName = agent?.fullName || "Agent";
            
            await Notification.create({
              userId: loan.requestedByAgentId._id || loan.requestedByAgentId,
              userModel: "Agent",
              title: "Commission Earned",
              message: `You earned KES ${commissionAmount} commission for loan disbursement to ${borrowerName}.`,
              type: "commission",
            });

            await sendSMS(
              loan.requestedByAgentId.phone,
              `Dear ${agentName}, you have earned KES ${commissionAmount} commission for loan disbursement to ${borrowerName}. \nREF: ${transaction._id}\n- izifinance`
            );
          }
        });
      }
    }
    // ✅ USER WITHDRAWAL HANDLING - DEDUCT BALANCE ONLY ON SUCCESS
    else if (transaction.type === "withdrawal") {
      console.log("💰 Processing user withdrawal...");
      
      // ✅ DEDUCT BALANCE ONLY WHEN M-PESA CONFIRMS SUCCESS
      const user = await User.findById(transaction.userId).session(session);
      if (user) {
        const balanceBefore = user.walletBalance;
        user.walletBalance -= Number(transaction.amount);
        transaction.balanceBefore = balanceBefore;
        transaction.balanceAfter = user.walletBalance;
        await user.save({ session });
        console.log(`💸 Deducted ${transaction.amount} from user ${user._id}. New balance: ${user.walletBalance}`);
      }
      
      await transaction.save({ session });
      
      postCommitTasks.push(async () => {
        if (user) {
          // Get user name from Profile
          const profile = await Profile.findOne({ userId: user._id });
          const userName = profile?.fullName || "Customer";
          
          await Notification.create({
            userId: user._id,
            userModel: "User",
            title: "Withdrawal Successful",
            message: `KES ${transaction.amount} has been withdrawn from your wallet.`,
            type: "withdraw",
          });

          await sendSMS(
            user.phone,
            `Dear ${userName}, your withdrawal of KES ${transaction.amount} has been processed successfully. \nNew wallet balance: KES ${user.walletBalance}. \nREF: ${transaction._id}\nFunds are on the way to your M-Pesa.\n- izifinance`
          );
        }
      });
    }
    // ✅ CUSTOMER SAVINGS WITHDRAWAL HANDLING - DEDUCT BALANCE ONLY ON SUCCESS
    else if (transaction.type === "customer withdrawal") {
      console.log("💰 Processing customer savings withdrawal...");
      
      // For customer withdrawals, deduct from savings balance ONLY ON SUCCESS
      const customer = await Borrower.findById(transaction.userId).session(session);
      if (customer) {
        const balanceBefore = customer.savingsBalance;
        customer.savingsBalance -= Number(transaction.amount);
        transaction.balanceBefore = balanceBefore;
        transaction.balanceAfter = customer.savingsBalance;
        await customer.save({ session });
        console.log(`👤 Updated customer ${customer._id} savings balance to ${customer.savingsBalance}`);
      }
      
      await transaction.save({ session });
      
      postCommitTasks.push(async () => {
        if (customer) {
          await Notification.create({
            userId: customer._id,
            userModel: "Customer",
            title: "Savings Withdrawal Successful",
            message: `You have withdrawn KES ${transaction.amount} from your savings.`,
            type: "withdraw",
          });

          await sendSMS(
            customer.phone,
            `Dear ${customer.fullName}, your savings withdrawal of KES ${transaction.amount} has been processed successfully. \nNew savings balance: KES ${customer.savingsBalance}. \nREF: ${transaction._id}\nFunds have been sent to your M-Pesa.\n- izifinance`
          );
        }
      });
    }
// 🔥 ADD AGENT WITHDRAWAL HANDLING RIGHT HERE
else if (transaction.type === "agent withdrawal") {
  // PASTE YOUR AGENT WITHDRAWAL CODE HERE
  console.log("💰 Processing agent withdrawal...");
  
  // ✅ DEDUCT AGENT BALANCE ONLY WHEN M-PESA CONFIRMS SUCCESS
  const agent = await AgentModel.findById(transaction.userId).session(session);
  if (agent) {
    const balanceBefore = agent.walletBalance;
    agent.walletBalance -= Number(transaction.amount);
    transaction.balanceBefore = balanceBefore;
    transaction.balanceAfter = agent.walletBalance;
    await agent.save({ session });
    console.log(`💸 Deducted ${transaction.amount} from agent ${agent._id}. New balance: ${agent.walletBalance}`);
  }
  
  // Update withdrawal request status
  const withdrawalRequest = await WithdrawRequest.findOne({ 
    transactionId: transaction._id 
  }).populate('lenderId').session(session);
  
  if (withdrawalRequest) {
    withdrawalRequest.status = "completed";
    withdrawalRequest.processedAt = new Date();
    await withdrawalRequest.save({ session });
    console.log(`✅ Updated withdrawal request ${withdrawalRequest._id} to completed`);
  }
  
  await transaction.save({ session });
  
  postCommitTasks.push(async () => {
    if (agent) {
      // Get lender details for notification
      const lender = withdrawalRequest?.lenderId;
      const lenderProfile = lender ? await Profile.findOne({ userId: lender._id }) : null;
      const lenderName = lenderProfile?.fullName || "Lender";
      
      // 🔔 NOTIFY AGENT
      await Notification.create({
        userId: agent._id,
        userModel: "Agent",
        title: "Withdrawal Successful",
        message: `Your withdrawal of KES ${transaction.amount} has been processed successfully.`,
        type: "withdraw",
      });

 await sendSMS(
  agent.phone,
  `Dear ${agent.name}, your withdrawal of KES ${transaction.amount} has been processed successfully.
New wallet balance: KES ${agent.walletBalance}.
REF: ${transaction._id}
Funds are on the way to your M-Pesa.
- izifinance`
);


      // 🔔 NOTIFY LENDER (if exists)
      if (lender) {
        await Notification.create({
          userId: lender._id,
          userModel: "User",
          title: "Agent Withdrawal Processed",
          message: `Agent ${agent.name} has successfully withdrawn KES ${transaction.amount}.`,
          type: "agent_withdrawal",
        });

        await sendSMS(
          lender.phone,
          `Dear ${lenderName}, agent ${agent.name} has successfully withdrawn KES ${transaction.amount}. \nTransaction reference: ${transaction._id}\n- izifinance`
        );
      }
    }
  });
}

    // ✅ COMMIT TRANSACTION
    await session.commitTransaction();
    session.endSession();

    console.log("🚀 Executing post-commit tasks...");

    // ✅ EXECUTE ASYNC TASKS
    try {
      await Promise.all(postCommitTasks.map(fn => fn().catch(e => console.error("Post-commit task error:", e))));
      console.log("✅ All post-commit tasks completed");
    } catch (asyncError) {
      console.error("Some post-commit tasks failed:", asyncError);
    }

    return res.status(200).json({ 
      message: "B2C callback processed successfully",
      transactionId: transaction._id 
    });

} catch (err) {
  console.error("🔥 B2C CALLBACK ERROR:", err);

  if (session) {
    try {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
    } catch (abortError) {
      console.error("Error aborting transaction:", abortError);
    } finally {
      session.endSession();
    }
  }

  return res.status(500).json({
    error: "Internal server error processing callback",
    details: err.message,
  });
}
}

// Helper function to find nested values in callback
function findNestedValue(obj, keys) {
  for (const key of keys) {
    if (key.includes('.')) {
      const keyParts = key.split('.');
      let value = obj;
      for (const part of keyParts) {
        value = value?.[part];
        if (value === undefined) break;
      }
      if (value !== undefined) return value;
    } else {
      if (obj?.[key] !== undefined) return obj[key];
    }
  }
  return null;
}

// Helper function to extract amount from callback
function extractAmountFromCallback(callback) {
  try {
    // Check ResultParameters first
    if (callback?.Result?.ResultParameters?.ResultParameter) {
      const params = callback.Result.ResultParameters.ResultParameter;
      if (Array.isArray(params)) {
        const amountParam = params.find(param => 
          param.Key === "TransactionAmount" || param.Key === "Amount"
        );
        if (amountParam) {
          return Number(amountParam.Value);
        }
      }
    }
    
    // Check direct properties
    if (callback?.TransactionAmount) return Number(callback.TransactionAmount);
    if (callback?.amount) return Number(callback.amount);
    if (callback?.Amount) return Number(callback.Amount);
    
    return null;
  } catch (error) {
    console.error("Error extracting amount from callback:", error);
    return null;
  }
}



// Withdrawal function for Customer Savings









