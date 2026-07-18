const nodemailer = require("nodemailer");
const { Resend } = require("resend");

let resendClient;
let gmailTransporter;

function getResendClient() {
  if (!resendClient && process.env.RESEND_API_KEY) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

function getGmailTransporter() {
  if (!gmailTransporter) {
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_APP_PASSWORD?.replace(/\s/g, "");
    if (!user || !pass) {
      const error = new Error("Gmail SMTP is enabled, but SMTP_USER or SMTP_APP_PASSWORD is missing");
      error.status = 500;
      throw error;
    }

    gmailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE ?? "true").toLowerCase() === "true",
      auth: { user, pass }
    });
  }
  return gmailTransporter;
}

async function sendVerificationEmail({ to, otp, name }) {
  const provider = String(process.env.EMAIL_PROVIDER || "mock").toLowerCase();
  if (provider === "gmail") return sendWithGmail({ to, otp, name });

  const shouldUseResend = provider === "resend";
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

async function sendWithGmail({ to, otp, name }) {
  try {
    const info = await getGmailTransporter().sendMail({
      from: process.env.EMAIL_FROM || `FinanceLend <${process.env.SMTP_USER}>`,
      to,
      subject: "Verify your FinanceLend account",
      html: buildVerificationHtml({ otp, name }),
      text: `Your FinanceLend verification code is ${otp}. This code will expire in 10 minutes.`
    });
    return { mocked: false, id: info.messageId, provider: "gmail" };
  } catch (error) {
    console.error(`Gmail verification email failed for ${to}: ${error.message}`);
    const deliveryError = new Error("We could not send the verification email. Please check the Gmail SMTP configuration and try again.");
    deliveryError.status = 502;
    deliveryError.cause = error;
    throw deliveryError;
  }
}

async function verifyEmailTransport() {
  const provider = String(process.env.EMAIL_PROVIDER || "mock").toLowerCase();
  if (provider === "gmail") {
    await getGmailTransporter().verify();
    return { provider, ready: true };
  }
  if (provider === "resend") {
    if (!getResendClient()) throw new Error("RESEND_API_KEY is missing");
    return { provider, ready: true };
  }
  return { provider: "mock", ready: true };
}

function buildVerificationHtml({ otp, name }) {
  return `
    <div style="margin:0;padding:32px 16px;background:#f3f6f5;font-family:Arial,sans-serif;color:#17342f">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dbe5e2;border-radius:8px;overflow:hidden">
        <div style="padding:22px 28px;background:#0f5f55;color:#ffffff">
          <div style="font-size:22px;font-weight:700">FinanceLend</div>
          <div style="margin-top:4px;font-size:13px;color:#d4ebe7">Secure account verification</div>
        </div>
        <div style="padding:28px">
          <h1 style="margin:0 0 16px;font-size:22px;color:#17342f">Verify your email address</h1>
          <p style="margin:0 0 18px;line-height:1.6">Hello ${escapeHtml(name || "there")}, use the code below to finish creating your FinanceLend account.</p>
          <div style="padding:18px;text-align:center;background:#eef7f5;border:1px solid #c9e3de;border-radius:6px;font-size:32px;font-weight:700;letter-spacing:6px;color:#0f5f55">${otp}</div>
          <p style="margin:18px 0 0;line-height:1.6">This code expires in 10 minutes. Your account will not be created until the code is verified.</p>
          <p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#657773">If you did not request this account, you can safely ignore this email.</p>
        </div>
      </div>
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

module.exports = { sendVerificationEmail, verifyEmailTransport };
