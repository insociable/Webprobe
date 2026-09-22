import * as dbSchema from "@agency-saas/db";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { db } from "./database";
import { deliverAuthOtpEmail } from "./auth-email-delivery";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const authSchema = {
  users: dbSchema.users,
  auth_sessions: dbSchema.authSessions,
  auth_accounts: dbSchema.authAccounts,
  auth_verifications: dbSchema.authVerifications,
};

export const auth = betterAuth({
  appName: "Agency Monitor",
  baseURL: requiredEnv("BETTER_AUTH_URL"),
  secret: requiredEnv("BETTER_AUTH_SECRET"),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  user: {
    modelName: "users",
    fields: { name: "displayName" },
  },
  session: {
    modelName: "auth_sessions",
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  account: { modelName: "auth_accounts" },
  verification: {
    modelName: "auth_verifications",
    storeIdentifier: "hashed",
  },
  advanced: {
    database: { generateId: "uuid" },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/email-otp/send-verification-otp": { window: 60, max: 3 },
      "/sign-in/email-otp": { window: 300, max: 6 },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (
        ctx.path !== "/email-otp/send-verification-otp" &&
        ctx.path !== "/sign-in/email-otp"
      ) {
        return;
      }

      const email = ctx.body?.email;
      if (typeof email !== "string") {
        return;
      }

      return {
        context: {
          ...ctx,
          body: {
            ...ctx.body,
            email: email.trim().toLowerCase(),
          },
        },
      };
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const email = user.email.trim().toLowerCase();
          const fallbackName = email.split("@")[0] || "Utilisateur";
          const name = user.name?.trim() || fallbackName;

          return {
            data: {
              ...user,
              email,
              name,
            },
          };
        },
      },
    },
  },
  telemetry: { enabled: false },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      storeOTP: "hashed",
      resendStrategy: "rotate",
      async sendVerificationOTP({ email, otp, type }) {
        await deliverAuthOtpEmail({ email, otp, type });
      },
    }),
  ],
});
