const { suggestLoanAmount } = require("../utils/loanCalculator");

exports.suggestLoanAmount = async (req, res) => {
  try {
    const { borrowerId } = req.params;

    // Validate borrowerId
    if (!borrowerId) {
      return res.status(400).json({ message: "Borrower ID is required" });
    }

    // Find the borrower
    const borrower = await Borrower.findOne({ userId: borrowerId });
    if (!borrower) {
      return res.status(404).json({ message: "Borrower not found" });
    }

    // Calculate suggested loan amount (2x savings balance)
    const suggestedAmount = borrower.savingsBalance * 2;

    // Return the suggested amount
    res.status(200).json({ suggestedAmount });
  } catch (error) {
    console.error("Error suggesting loan amount:", error);
    res.status(500).json({ message: "Error suggesting loan amount" });
  }
};