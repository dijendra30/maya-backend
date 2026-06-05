const express    = require('express');
const router     = express.Router();
const chatController = require('../controllers/chatController');

// POST /chat
// Body:   { "message": "...", "voice": "en-US-AriaNeural" }
// Return: { "reply": "...", "provider": "groq", "audioUrl": "..." }
router.post('/chat', chatController.handleChat);

module.exports = router;
