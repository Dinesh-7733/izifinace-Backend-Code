exports.suggestLoanAmount = (savingsBalance) => {
    // Validate input
    if (typeof savingsBalance !== "number" || savingsBalance < 0) {
      throw new Error("Invalid savings balance. Must be a non-negative number.");
    }
  
    // Calculate suggested loan amount (2x savings balance)
    return savingsBalance * 2;
  };