const express    = require('express');
const router     = express.Router();
const chatController = require('../controllers/chatController');

/**
 * POST /chat
 * Body:   { "message": "..." }
 * Return: { "reply": "...", "provider": "groq" }
 */
router.post('/chat', chatController.handleChat);

module.exports = router;
