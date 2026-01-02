const mongoose = require("mongoose");


// E.164 phone format: +{country}{national} up to 15 digits total
const E164 = /^\+[1-9]\d{1,14}$/;



const userSchema = new mongoose.Schema({
  name: { 
    type: String, 
    // required: true, 
    trim: true 
  },
  phone: { 
    type: String, 
    required: true, 
    unique: true, 
    trim: true,
    validate: {
      validator: v => E164.test(v),
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  // Add Firebase-specific fields
  firebaseUID: {
    type: String,
    unique: true,
    sparse: true // Allows null values while maintaining uniqueness
  },
  fcmToken: { // For push notifications
    type: String,
    default: null
  },
  role: {
    type: String,
    default: "lender"
  },
  walletBalance: { 
    type: Number, 
    default: 0, 
    min: 0 
  },
  isPhoneVerified: { 
    type: Boolean, 
    default: false 
  },
  // Password fields (if you're maintaining local auth alongside Firebase)
  password: {
    type: String,
    select: false // Never return password in queries
  },
  tempPassword: { // For password resets
    type: String,
    select: false
  },
  passwordChangedAt: Date, // For tracking password changes
  // Timestamps
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  },
  isDeleted: {
  type: Boolean,
  default: false
},
deletedAt: {
  type: Date,
  default: null
}

}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Update timestamp on save
userSchema.pre("save", function(next) {
  this.updatedAt = Date.now();
  
  // Hash password if it was modified
  if (this.isModified('password')) {
    this.passwordChangedAt = Date.now();
  }
  next();
});

// Add index for frequently queried fields
userSchema.index({ phone: 1, firebaseUID: 1, role: 1 });

// Virtual for formatted phone number (e.g., +254712345678)
userSchema.virtual('internationalPhone').get(function() {
  return `+254${this.phone.substring(1)}`;
});

// Method to verify user's password (if using local auth)
userSchema.methods.correctPassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to check if user changed password after token was issued
userSchema.methods.changedPasswordAfter = function(JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

module.exports = mongoose.model("User", userSchema);