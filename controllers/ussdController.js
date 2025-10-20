const africastalking = require("africastalking")({
    apiKey: process.env.AT_API_KEY,
    username: process.env.AT_USERNAME,
  });
  const User = require("../models/User");
  const Borrower = require("../models/customer");
  

  const { sendSMS } = require("../utils/sms");

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

  // Handle USSD requests
  exports.handleUSSD = async (req, res) => {
    const { sessionId, serviceCode, phoneNumber, text } = req.body;
  
    let response = "";
  
    try {
      // Check if the user is registered
      const user = await User.findOne({ phone: phoneNumber });
  
      if (!user) {
        // User is not registered
        response = "CON Welcome to IziBank! Please visit an agent to register.";
      } else if (text === "") {
        // Main menu
        if (user.role === "borrower") {
          response = `CON Welcome, ${user.name}! Choose an option:
  1. Check Balance
  2. Repay Loan
  3. Save Money
  4. Withdraw Savings`;
        } else if (user.role === "lender") {
          response = `CON Welcome, ${user.name}! Choose an option:
  1. Lend Money
  2. Check Balance
  3. Deposit Funds
  4. Withdraw Funds`;
        }
      } else {
        // Handle user input
        const input = text.split("*");
        const option = input[0];
  
        if (user.role === "borrower") {
          switch (option) {
            case "1": // Check Balance
              const borrower = await Borrower.findOne({ userId: user._id });
              response = `END Your balance is Ksh ${borrower.savingsBalance}`;
              break;
            case "2": // Repay Loan
              response = "CON Enter the amount to repay:";
              break;
            case "3": // Save Money
              response = "CON Enter the amount to save:";
              break;
            case "4": // Withdraw Savings
              response = "CON Enter the amount to withdraw:";
              break;
            default:
              response = "END Invalid option. Please try again.";
          }
        } else if (user.role === "lender") {
          switch (option) {
            case "1": // Lend Money
              response = "CON Enter the borrower's phone number:";
              break;
            case "2": // Check Balance
              response = `END Your balance is Ksh ${user.walletBalance}`;
              break;
            case "3": // Deposit Funds
              response = "CON Enter the amount to deposit:";
              break;
            case "4": // Withdraw Funds
              response = "CON Enter the amount to withdraw:";
              break;
            default:
              response = "END Invalid option. Please try again.";
          }
        }
      }
    } catch (error) {
      console.error("Error handling USSD request:", error);
      response = "END An error occurred. Please try again later.";
    }
  
    res.set("Content-Type", "text/plain");
    res.send(response);
  };