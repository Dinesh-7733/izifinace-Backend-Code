exports.isBorrower = (req, res, next) => {
    if (req.user.role === "borrower") next();
    else res.status(403).json({ message: "Access denied" });
  };