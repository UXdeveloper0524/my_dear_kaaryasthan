import { Router } from 'express';
import {
  emailRequestSchema,
  loginSchema,
  registerSchema,
  sessionIdSchema,
  verifyEmailSchema,
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
