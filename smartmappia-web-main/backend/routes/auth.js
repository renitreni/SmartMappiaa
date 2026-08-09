const express = require('express');
const router = express.Router();
const { requireToken, requireAuth } = require('../middleware/auth');
const { validateBody } = require('../lib/validate');
const { signupLimiter } = require('../middleware/rateLimiters');
const {
  signup,
  syncProfile,
  updateProfile,
  createAvatarUploadUrlHandler,
  deleteAccount,
} = require('../controllers/authController');

// POST /api/auth/signup -> create an account pre-confirmed (no email step).
// Tighter, longer-window limiter on top of the /api/auth per-minute cap.
router.post('/signup', signupLimiter, signup);

// POST /api/auth/sync -> upsert the caller's profile (role + details).
router.post('/sync', requireToken, syncProfile);

// PATCH /api/auth/profile -> the Profile page saves name/phones/address/avatar.
router.patch(
  '/profile',
  requireAuth,
  validateBody({
    full_name: { type: 'string', maxLength: 120, nullable: true },
    mobile_number: { type: 'string', maxLength: 40, nullable: true },
    whatsapp_number: { type: 'string', maxLength: 40, nullable: true },
    address: { type: 'string', maxLength: 500, nullable: true },
    avatar_url: { type: 'string', maxLength: 500, nullable: true },
  }),
  updateProfile
);

// POST /api/auth/avatar/signed-url -> signed upload for the public avatars bucket.
router.post(
  '/avatar/signed-url',
  requireAuth,
  validateBody({
    file_name: { type: 'string', maxLength: 255 },
    mime_type: { type: 'string', required: true, maxLength: 100 },
  }),
  createAvatarUploadUrlHandler
);

// DELETE /api/auth/account -> permanent account deletion, required by both
// app stores. Needs migration 0036 applied first.
router.delete('/account', requireAuth, deleteAccount);

module.exports = router;
