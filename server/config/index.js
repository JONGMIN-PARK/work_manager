var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

var config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,

  db: {
    connectionString: process.env.DATABASE_URL
  },

  jwt: (function () {
    var secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    var refreshSecret = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me';
    if (process.env.NODE_ENV === 'production') {
      if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
      if (!process.env.JWT_REFRESH_SECRET) throw new Error('JWT_REFRESH_SECRET must be set in production');
    }
    return {
      secret: secret,
      refreshSecret: refreshSecret,
      accessExpiresIn: '30m',
      refreshExpiresIn: '7d',
      refreshExpiresInMs: 7 * 24 * 60 * 60 * 1000
    };
  })(),

  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,

  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:8080'
  },

  maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 52428800,

  loginLock: {
    maxAttempts: 5,
    lockMinutes: 15
  },

  maxDevices: 5,

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback'
  },

  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || ''
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || '',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
    botUsername: process.env.TELEGRAM_BOT_USERNAME || ''
  },

  ai: {
    provider: process.env.AI_PROVIDER || 'gemini',
    geminiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'
  }
};

module.exports = config;
