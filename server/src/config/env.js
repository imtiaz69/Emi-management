const { z } = require("zod");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGO_URI: z.string().optional(),
  USE_MEMORY_DB: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default("15m"),
  REFRESH_TOKEN_SECRET: z.string().optional(),
  REFRESH_TOKEN_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(30),
  CLIENT_URL: z.string().refine(
    (value) => value.split(",").map((item) => item.trim()).filter(Boolean).every((item) => z.string().url().safeParse(item).success),
    "Must contain one or more valid comma-separated URLs"
  ).optional(),
  APP_TIMEZONE: z.string().default("Asia/Dhaka"),
  EMAIL_PROVIDER: z.enum(["mock", "gmail", "gmail_api", "resend", "relay"]).default("mock"),
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().email().optional(),
  SMTP_APP_PASSWORD: z.string().optional(),
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_REFRESH_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  DEMO_EMAIL_RECIPIENT: z.string().email().optional(),
  EMAIL_RELAY_URL: z.string().url().optional(),
  EMAIL_RELAY_SECRET: z.string().min(32).optional(),
  EXPOSE_EMAIL_OTP: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_CURRENCY: z.string().default("bdt"),
  STRIPE_BDT_PER_USD: z.coerce.number().positive().default(120),
  ALLOW_STRIPE_CURRENCY_CONVERSION: z.string().optional(),
  ALLOW_STRIPE_RETURN_CONFIRM: z.string().optional(),
  AUTO_SEED: z.string().optional(),
  UPLOAD_DIR: z.string().default("uploads"),
  PUBLIC_CLIENT_URL: z.string().url().optional(),
  IDENTITY_AI_URL: z.string().url().optional(),
  IDENTITY_PUBLIC_API_URL: z.string().url().optional(),
  IDENTITY_AI_SERVICE_KEY: z.string().min(32).optional(),
  IDENTITY_DATA_ENCRYPTION_KEY: z.string().optional(),
  IDENTITY_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  IDENTITY_ARTIFACT_RETENTION_HOURS: z.coerce.number().positive().default(24),
  IDENTITY_AI_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  IDENTITY_NAME_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.9),
  IDENTITY_NAME_BORDERLINE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.78),
  IDENTITY_CORROBORATED_NAME_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),
  IDENTITY_FACE_MATCH_THRESHOLD: z.coerce.number().min(-1).max(1).default(0.363),
  IDENTITY_NID_FACE_MATCH_THRESHOLD: z.coerce.number().min(-1).max(1).default(0.6),
  IDENTITY_FACE_BORDERLINE_THRESHOLD: z.coerce.number().min(-1).max(1).default(0.3),
  IDENTITY_LIVENESS_ENABLED: z.string().optional()
});

function validateEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }

  const env = parsed.data;
  const missing = [];
  if (env.NODE_ENV === "production") {
    if (!env.MONGO_URI) missing.push("MONGO_URI");
    if (!env.JWT_SECRET || env.JWT_SECRET === "dev-secret" || env.JWT_SECRET.length < 32) missing.push("JWT_SECRET with at least 32 characters");
    if (!env.REFRESH_TOKEN_SECRET || env.REFRESH_TOKEN_SECRET.length < 32) missing.push("REFRESH_TOKEN_SECRET with at least 32 characters");
    if (!env.CLIENT_URL) missing.push("CLIENT_URL");
    if (!env.STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
    if (!env.STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");
  }
  if (env.EMAIL_PROVIDER === "gmail") {
    if (!env.SMTP_USER) missing.push("SMTP_USER");
    if (!env.SMTP_APP_PASSWORD) missing.push("SMTP_APP_PASSWORD");
  }
  if (env.EMAIL_PROVIDER === "gmail_api") {
    if (!env.SMTP_USER) missing.push("SMTP_USER");
    if (!env.GMAIL_CLIENT_ID) missing.push("GMAIL_CLIENT_ID");
    if (!env.GMAIL_CLIENT_SECRET) missing.push("GMAIL_CLIENT_SECRET");
    if (!env.GMAIL_REFRESH_TOKEN) missing.push("GMAIL_REFRESH_TOKEN");
  }
  if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
  if (env.EMAIL_PROVIDER === "relay") {
    if (!env.EMAIL_RELAY_URL) missing.push("EMAIL_RELAY_URL");
    if (!env.EMAIL_RELAY_SECRET) missing.push("EMAIL_RELAY_SECRET with at least 32 characters");
  }
  if (env.IDENTITY_AI_URL) {
    if (!env.IDENTITY_AI_SERVICE_KEY) missing.push("IDENTITY_AI_SERVICE_KEY with at least 32 characters");
    if (!env.IDENTITY_PUBLIC_API_URL) missing.push("IDENTITY_PUBLIC_API_URL");
    const encryptionKey = env.IDENTITY_DATA_ENCRYPTION_KEY ? Buffer.from(env.IDENTITY_DATA_ENCRYPTION_KEY, "base64") : null;
    if (!encryptionKey || encryptionKey.length !== 32) missing.push("IDENTITY_DATA_ENCRYPTION_KEY as a base64-encoded 32-byte key");
  }
  if (missing.length) {
    throw new Error(`Missing production environment values: ${missing.join(", ")}`);
  }

  if (!env.JWT_SECRET && env.NODE_ENV !== "test") {
    console.warn("JWT_SECRET is not set. Development fallback is being used.");
  }
  return env;
}

module.exports = { validateEnv };
