// utils/sendEmail.js
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const sendEmail = async (options) => {
  try {
    const msg = {
      to: options.email,
      from: {
        email: process.env.EMAIL_FROM,
        name: process.env.EMAIL_FROM_NAME || 'Your Name'
      },
      subject: options.subject,
      text: options.message,
    };
    
    await sgMail.send(msg);
  } catch (error) {
    console.error('SendGrid Error:', error.response.body.errors);
    throw new Error('Email could not be sent');
  }
};

module.exports = sendEmail;


