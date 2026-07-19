import nodemailer from "nodemailer";

let transporter;

function getTransporter() {
  if (!transporter) {
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_APP_PASSWORD?.replace(/\s/g, "");
    if (!user || !pass) throw new Error("Email relay SMTP credentials are missing");
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE ?? "true").toLowerCase() === "true",
      auth: { user, pass }
    });
  }
  return transporter;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const expectedSecret = process.env.EMAIL_RELAY_SECRET;
  const suppliedSecret = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { to, subject, html, text } = req.body || {};
  if (
    typeof to !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) ||
    typeof subject !== "string" ||
    !subject.startsWith("FinanceLend:") ||
    typeof text !== "string" ||
    typeof html !== "string" ||
    html.length > 50000 ||
    text.length > 5000
  ) {
    return res.status(400).json({ message: "Invalid email payload" });
  }

  try {
    const info = await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || `FinanceLend <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
      text
    });
    return res.status(200).json({ accepted: true, id: info.messageId });
  } catch (error) {
    console.error("FinanceLend email relay failed:", error.message);
    return res.status(502).json({ message: "Email delivery failed" });
  }
}
