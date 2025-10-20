const Stats = require('../models/Stats');
const Loan = require("../models/Loan")
// ✅ Fetch real-time stats from Loan collection
exports.getStats = async (req, res) => {
  try {
    // 🟢 Step 1: Count loan details (global stats)
    const totalLoansIssued = await Loan.countDocuments();
    const activeLoans = await Loan.countDocuments({ status: "active" });
    const overdueLoans = await Loan.countDocuments({ status: "overdue" });
    const paidLoans = await Loan.countDocuments({ status: "fully paid" });

    // 🟢 Step 2: Sum repayments
    const repayments = await Loan.aggregate([
      { $match: { status: "fully paid" } },
      { $group: { _id: null, total: { $sum: "$totalRepayment" } } }
    ]);
    const totalRepayments = repayments.length > 0 ? repayments[0].total : 0;

    // 🟢 Step 3: Loan trends (by month)
    const loanTrends = await Loan.aggregate([
      {
        $group: {
          _id: { $month: "$createdAt" },
          value: { $sum: 1 }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    const months = [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December"
    ];

    const formattedTrends = loanTrends.map(item => ({
      month: months[item._id - 1],
      value: item.value
    }));

    // 🟢 Step 4: Lender profits calculation
    const lenderProfits = await Loan.aggregate([
      {
        $group: {
          _id: "$lenderId",
          totalInterest: { $sum: "$interest" }
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "lender"
        }
      },
      { $unwind: "$lender" },
      {
        $project: {
          lenderId: "$_id",
          lenderName: "$lender.name",
          totalInterest: 1,
          _id: 0
        }
      }
    ]);

    // 🟢 Step 5: Save or update stats in DB
    let stats = await Stats.findOne();
    if (!stats) {
      stats = new Stats({
        totalLoansIssued,
        totalRepayments,
        activeLoans,
        overdueLoans,
        paidLoans,
        loanTrends: formattedTrends,
        lenderProfits
      });
    } else {
      stats.totalLoansIssued = totalLoansIssued;
      stats.totalRepayments = totalRepayments;
      stats.activeLoans = activeLoans;
      stats.overdueLoans = overdueLoans;
      stats.paidLoans = paidLoans;
      stats.loanTrends = formattedTrends;
      stats.lenderProfits = lenderProfits;
    }

    await stats.save();

    // 🟢 Step 6: Return stats (with logged-in lender profit highlighted if needed)
    let lenderProfit = null;
    if (req.user) {
      lenderProfit = lenderProfits.find(
        lp => lp.lenderId.toString() === req.user._id.toString()
      ) || { lenderId: req.user._id, lenderName: req.user.name, totalInterest: 0 };
    }

    res.json({
      ...stats.toObject(),
      lenderProfit
    });

  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ message: "Server error", error });
  }
};

