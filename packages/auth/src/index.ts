import { passkey } from "@better-auth/passkey";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import nodemailer from "nodemailer";
import { database, schema } from "@muster/database";

const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const parsedBaseUrl = new URL(baseUrl);
const configuredTrustedOrigins = process.env.AUTH_TRUSTED_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const trustedOrigins =
  configuredTrustedOrigins && configuredTrustedOrigins.length > 0
    ? [...new Set([parsedBaseUrl.origin, ...configuredTrustedOrigins])]
    : process.env.NODE_ENV === "development"
      ? [parsedBaseUrl.origin, "http://127.0.0.1:3000"]
      : [parsedBaseUrl.origin];
const requireEmailVerification =
  process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === undefined
    ? process.env.NODE_ENV === "production"
    : process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === "true";
const useSecureCookies =
  process.env.AUTH_SECURE_COOKIES === undefined
    ? process.env.NODE_ENV === "production"
    : process.env.AUTH_SECURE_COOKIES === "true";
const sensitiveRateLimitMax = Number(
  process.env.AUTH_SENSITIVE_RATE_LIMIT_MAX ?? 3,
);
const authSecret =
  process.env.BETTER_AUTH_SECRET ??
  (process.env.npm_lifecycle_event === "build"
    ? "muster-build-time-only-secret-never-used-at-runtime"
    : undefined);

const authSchema = {
  user: schema.authUsers,
  session: schema.authSessions,
  account: schema.authAccounts,
  verification: schema.authVerifications,
  twoFactor: schema.authTwoFactors,
  passkey: schema.authPasskeys,
};

const mailTransport = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "localhost",
  port: Number(process.env.SMTP_PORT ?? 1025),
  secure: false,
});

const microsoft =
  process.env.ENTRA_CLIENT_ID && process.env.ENTRA_CLIENT_SECRET
    ? {
        microsoft: {
          clientId: process.env.ENTRA_CLIENT_ID,
          clientSecret: process.env.ENTRA_CLIENT_SECRET,
          tenantId: process.env.ENTRA_TENANT_ID ?? "common",
        },
      }
    : {};

export const auth = betterAuth({
  appName: "Muster",
  baseURL: baseUrl,
  secret: authSecret,
  trustedOrigins,
  database: drizzleAdapter(database(), {
    provider: "pg",
    schema: authSchema,
    transaction: true,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  emailVerification: {
    sendOnSignUp: requireEmailVerification,
    sendVerificationEmail: async ({ user, url }) => {
      await mailTransport.sendMail({
        from: process.env.MUSTER_EMAIL_FROM ?? "Muster <no-reply@muster.local>",
        to: user.email,
        subject: "Verify your Muster account",
        text: `Verify your Muster account: ${url}`,
      });
    },
  },
  session: {
    expiresIn: Number(process.env.SESSION_LIFETIME_SECONDS ?? 60 * 60 * 12),
    updateAge: Number(process.env.SESSION_UPDATE_AGE_SECONDS ?? 60 * 30),
    cookieCache: {
      enabled: true,
      maxAge: 60,
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 100),
    customRules: {
      "/sign-in/email": { window: 10, max: sensitiveRateLimitMax },
      "/sign-up/email": { window: 10, max: sensitiveRateLimitMax },
    },
  },
  advanced: {
    useSecureCookies,
    cookiePrefix: "muster",
    crossSubDomainCookies: { enabled: false },
  },
  socialProviders: microsoft,
  plugins: [
    twoFactor({
      issuer: "Muster",
      totpOptions: { digits: 6, period: 30 },
      backupCodeOptions: { amount: 10, length: 12 },
    }),
    passkey({
      rpID: parsedBaseUrl.hostname,
      rpName: "Muster",
      origin: parsedBaseUrl.origin,
    }),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
