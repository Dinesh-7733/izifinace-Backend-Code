// controllers/reminder.controller.js


const Customer = require("../models/customer");
const Loan = require("../models/Loan");
const { sendSMS } = require("../utils/sms");


exports.sendBorrowerLoanReminder = async (req, res) => {
  const { loanId, borrowerId } = req.params;

  try {
    const loan = await Loan.findById(loanId).populate("borrowerId");
    if (!loan) {
      return res.status(404).json({ success: false, message: "Loan not found" });
    }

    if (!loan.borrowerId || loan.borrowerId._id.toString() !== borrowerId) {
      return res.status(400).json({ success: false, message: "Borrower does not match this loan" });
    }

    const borrower = loan.borrowerId;
    const now = new Date();

    // 🔹 Check overdue either by status or dueDate
    if (!(loan.status === "overdue" || (loan.dueDate < now && loan.balance > 0))) {
      return res.status(400).json({ success: false, message: "Loan is not overdue yet" });
    }

    // ✅ If loan is past due, update status (if not already)
    if (loan.dueDate < now && loan.status !== "overdue" && loan.balance > 0) {
      loan.status = "overdue";
    }

    const message = `Dear ${borrower.fullName}, your loan of KES ${loan.totalRepayment} was due on ${loan.dueDate.toLocaleDateString()}. Please make repayment to avoid penalties.`;
    await sendSMS(borrower.phone, message);

    loan.lastReminderSent = new Date();
    await loan.save();

    res.json({ success: true, message: "Overdue SMS sent successfully" });
  } catch (error) {
    console.error("❌ Error sending overdue SMS:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};















































































