import pino from 'pino';

export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  base: undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'newPassword',
      'currentPassword',
      'token',
      'code',
      'challengeToken',
      'otpauthUri',
      'recoveryCodes',
      'req.body.password',
      'req.body.newPassword',
      'req.body.currentPassword',
      'req.body.token',
      'req.body.code',
      'req.body.challengeToken',
      'req.body.otpauthUri',
      'req.body.recoveryCodes',
    ],
    censor: '[Redacted]',
  },
});
