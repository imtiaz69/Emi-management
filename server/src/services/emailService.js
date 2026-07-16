const { Resend } = require("resend");

let resendClient;

function getResendClient() {
  if (!resendClient && process.env.RESEND_API_KEY) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

async function sendVerificationEmail({ to, otp, name }) {
  const shouldUseResend = process.env.EMAIL_PROVIDER === "resend";
  const resend = getResendClient();

  if (!shouldUseResend || !resend) {
    console.log(`Mock verification OTP for ${to}: ${otp}`);
    return { mocked: true };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || "FinanceLend <onboarding@resend.dev>",
      to,
      subject: "Verify your FinanceLend account",
      html: buildVerificationHtml({ otp, name }),
      text: `Your FinanceLend verification code is ${otp}. This code will expire in 10 minutes.`
    });
    if (error) {
      const message = error.message || "Resend refused the email request";
      if (process.env.NODE_ENV === "production") {
        const deliveryError = new Error(message);
        deliveryError.status = error.statusCode || error.status || 502;
        throw deliveryError;
      }
      console.error(`Resend verification email failed for ${to}: ${message}`);
      console.log(`Fallback verification OTP for ${to}: ${otp}`);
      return { mocked: true, error: message };
    }
    return { mocked: false, id: data?.id };
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
    console.error(`Resend verification email failed for ${to}: ${error.message}`);
    console.log(`Fallback verification OTP for ${to}: ${otp}`);
    return { mocked: true, error: error.message };
  }
}

function buildVerificationHtml({ otp, name }) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#12312d">
      <h2>Hello ${escapeHtml(name || "there")},</h2>
      <p>Use this code to verify your FinanceLend account:</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:6px;margin:20px 0;color:#155e59">${otp}</div>
      <p>This code will expire in 10 minutes.</p>
      <p>If you did not create this account, you can ignore this email.</p>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

module.exports = { sendVerificationEmail };
