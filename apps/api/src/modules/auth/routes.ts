import { Router } from 'express';
import {
  emailRequestSchema,
  loginSchema,
  registerSchema,
  sessionIdSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  mfaSetupSchema,
  mfaConfirmSchema,
  mfaChallengeSchema,
  mfaDisableSchema,
  mfaRegenerateSchema,
} from '@kaaryasthan/shared';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { authRateLimit } from '../../middleware/auth-rate-limit.js';
import { issueCsrf, requireCsrf } from '../../middleware/auth-csrf.js';
import { requireAuth } from '../../middleware/auth-session.js';
import * as controller from './controller.js';

export const authRoutes = Router();
authRoutes.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
});
authRoutes.get('/csrf', authRateLimit, issueCsrf);
authRoutes.post(
  '/register',
  authRateLimit,
  requireCsrf,
  validateBody(registerSchema),
  controller.register,
);
authRoutes.post(
  '/verify-email/resend',
  authRateLimit,
  requireCsrf,
  validateBody(emailRequestSchema),
  controller.resend,
);
authRoutes.post(
  '/verify-email',
  authRateLimit,
  requireCsrf,
  validateBody(verifyEmailSchema),
  controller.verifyEmail,
);
authRoutes.post(
  '/login',
  authRateLimit,
  requireCsrf,
  validateBody(loginSchema),
  controller.login,
);
authRoutes.post('/refresh', authRateLimit, requireCsrf, controller.refresh);
authRoutes.post('/logout', authRateLimit, requireCsrf, controller.logout);
authRoutes.post(
  '/forgot-password',
  authRateLimit,
  requireCsrf,
  validateBody(forgotPasswordSchema),
  controller.forgotPassword,
);
authRoutes.post(
  '/reset-password',
  authRateLimit,
  requireCsrf,
  validateBody(resetPasswordSchema),
  controller.resetPassword,
);
authRoutes.post(
  '/change-password',
  authRateLimit,
  requireCsrf,
  requireAuth,
  validateBody(changePasswordSchema),
  controller.changePassword,
);
authRoutes.post(
  '/2fa/setup',
  authRateLimit,
  requireCsrf,
  requireAuth,
  validateBody(mfaSetupSchema),
  controller.setupMfa,
);
authRoutes.post(
  '/2fa/setup/confirm',
  authRateLimit,
  requireCsrf,
  requireAuth,
  validateBody(mfaConfirmSchema),
  controller.confirmMfa,
);
authRoutes.post(
  '/2fa/challenge',
  authRateLimit,
  requireCsrf,
  validateBody(mfaChallengeSchema),
  controller.challengeMfa,
);
authRoutes.post(
  '/2fa/disable',
  authRateLimit,
  requireCsrf,
  requireAuth,
  validateBody(mfaDisableSchema),
  controller.disableMfa,
);
authRoutes.post(
  '/2fa/recovery-codes/regenerate',
  authRateLimit,
  requireCsrf,
  requireAuth,
  validateBody(mfaRegenerateSchema),
  controller.regenerateMfa,
);
authRoutes.get('/me', authRateLimit, requireAuth, controller.me);
authRoutes.get('/sessions', authRateLimit, requireAuth, controller.sessions);
authRoutes.delete(
  '/sessions/:sessionId',
  authRateLimit,
  requireCsrf,
  requireAuth,
  validateParams(sessionIdSchema),
  controller.revoke,
);
