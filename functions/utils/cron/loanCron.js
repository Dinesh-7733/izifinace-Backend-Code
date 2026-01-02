const cron = require("node-cron");
const Loan = require("../../models/Loan");
const { sendSMS } = require("../../utils/sms");

// Helper to format phone numbers for Africa's Talking
function sanitizeNumber(number) {
  number = number.replace(/\s+/g, ''); // remove spaces
  if (number.startsWith("0")) return "+254" + number.slice(1);
  if (number.startsWith("7")) return "+254" + number;
  if (!number.startsWith("+")) return "+" + number; // fallback
  return number;
}

// ⏰ Runs every day at 6 AM and 6 PM (Kenya/Nairobi time)
cron.schedule("0 6,18 * * *", async () => {
  console.log("⏰ Reminder & Overdue cron triggered:", new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }));

  try {
    const activeLoans = await Loan.find({
      status: "active",
      balance: { $gt: 0 },
    }).populate("borrowerId lenderId");

    for (let loan of activeLoans) {
      const now = new Date();

      // 🔹 Step 1: Mark overdue if dueDate has passed
   // 🔹 IMPROVED: Create Nairobi time for accurate comparison
      const nairobiTime = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Nairobi" }));
      const dueDate = new Date(loan.dueDate);

      // 🔹 Step 1: Mark overdue if dueDate has passed (in Nairobi time)
      if (dueDate < nairobiTime && loan.status === "active" && loan.balance > 0) {
        loan.status = "overdue";
        loan.updatedAt = now;
        await loan.save();
        
        console.log(`⚠️ Loan ID: ${loan._id} marked as OVERDUE | Due: ${dueDate} | Now: ${nairobiTime}`);
      }

      // 🔹 Step 2: Send reminder SMS
      const borrowerPhone = sanitizeNumber(
        loan.borrowerId.phone || loan.borrowerId.phoneNumber
      );

      if (!borrowerPhone) {
        console.error("❌ Invalid borrower phone for loan:", loan._id);
        continue;
      }

      const lastReminder = loan.lastReminderSent || loan.updatedAt;
      const hoursSinceLastReminder = (now - lastReminder) / (1000 * 60 * 60);

      // ✅ Only send if 24h passed since last reminder
      if (hoursSinceLastReminder >= 24) {
        let lastRepaymentDate = null;
        if (loan.repayments?.length > 0) {
          lastRepaymentDate = loan.repayments[loan.repayments.length - 1].date;
        }

        const borrowerMessage = `⏰ Reminder: Your loan balance is KES ${loan.balance}. Last repayment: ${
          lastRepaymentDate ? lastRepaymentDate.toDateString() : "No repayment yet"
        }. Please pay before ${loan.dueDate.toDateString()} to avoid penalties. Loan ID: ${loan._id}`;

        console.log("📩 Sending reminder SMS to borrower:", borrowerPhone);

        await sendSMS(borrowerPhone, borrowerMessage);

        // ✅ Update reminder timestamp
        await Loan.updateOne(
          { _id: loan._id },
          { $set: { lastReminderSent: now } }
        );

        console.log(
          `✅ Reminder SMS sent to ${borrowerPhone} for Loan ID: ${loan._id} | Balance: ${loan.balance} | Time: ${now.toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}`
        );
      }
    }
  } catch (error) {
    console.error("❌ Error in reminder/overdue cron:", error.message);
  }
}, {
  timezone: "Africa/Nairobi",   // 🟢 IMPORTANT: Kenya timezone
});
