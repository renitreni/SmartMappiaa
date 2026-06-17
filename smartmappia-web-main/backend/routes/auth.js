const express = require('express');
const router = express.Router();
const { requireToken } = require('../middleware/auth');
const { signup, syncProfile } = require('../controllers/authController');

// POST /api/auth/signup -> create an account pre-confirmed (no email step).
router.post('/signup', signup);

// POST /api/auth/sync -> upsert the caller's profile (role + details).
router.post('/sync', requireToken, syncProfile);

module.exports = router;
