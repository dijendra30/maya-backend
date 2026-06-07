const express = require('express');
const router  = express.Router();
const GeminiProvider = require('../providers/GeminiProvider');

const NOTIFICATION_SYSTEM_PROMPT = `You are a notification triage assistant. Evaluate the following Android notification and decide if it is important enough to alert the user via voice.

IMPORTANT notifications (isImportant: true):
- Missed calls or incoming calls
- Urgent or important emails
- Bank transactions, OTPs, or financial alerts
- Messages from family, close contacts, or messaging apps (WhatsApp, SMS, etc.)
- Low battery warnings
- Security alerts (login attempts, password changes, suspicious activity)
- Calendar reminders or alarms
- Emergency or system-critical warnings

NOT important notifications (isImportant: false):
- Promotions, deals, or marketing offers
- App update notifications
- Game alerts or achievements
- Social media likes, follows, or generic activity
- News headlines (unless breaking/emergency)
- Routine system notifications (storage cleanup, optimization tips)

Respond with ONLY a valid JSON object, no markdown, no explanation:
{ "isImportant": true/false, "urgencyLevel": "critical"|"important"|"normal"|"ignore", "spokenSummary": "..." }

Where:
- "critical" = needs immediate attention (missed calls, security alerts, OTPs)
- "important" = should be told soon (family messages, bank transactions)
- "normal" = can wait but worth mentioning (calendar reminders)
- "ignore" = do not disturb the user (promotions, game alerts)
- "spokenSummary" = a short, natural sentence Maya can speak aloud to inform the user. Leave empty string if urgencyLevel is "ignore".`;

/**
 * POST /evaluate-notification
 * Body:   { "app": "...", "title": "...", "text": "...", "userId": "..." }
 * Return: { "isImportant": bool, "urgencyLevel": "...", "spokenSummary": "..." }
 *
 * Evaluates an Android notification for importance using Gemini.
 */
router.post('/evaluate-notification', async (req, res) => {
  const { app, title, text, userId } = req.body || {};
  if (!title && !text) {
    return res.status(400).json({ error: 'title or text is required' });
  }

  const fallback = { isImportant: false, urgencyLevel: 'ignore', spokenSummary: '' };

  const userMessage = `App: ${app || 'Unknown'}\nTitle: ${title || ''}\nText: ${text || ''}`;

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

    const axios = require('axios');
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await axios.post(
      url,
      {
        system_instruction: {
          parts: [{ text: NOTIFICATION_SYSTEM_PROMPT }]
        },
        contents: [
          {
            role:  'user',
            parts: [{ text: userMessage }]
          }
        ],
        generationConfig: {
          maxOutputTokens: 256,
          temperature:     0.3,
        }
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );

    const raw = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return res.json(fallback);

    // Strip possible markdown fences around JSON
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    const parsed  = JSON.parse(cleaned);

    return res.json({
      isImportant:   !!parsed.isImportant,
      urgencyLevel:  parsed.urgencyLevel || 'ignore',
      spokenSummary: parsed.spokenSummary || '',
    });
  } catch (err) {
    console.error(`[Notification] Evaluation failed: ${err.message}`);
    return res.json(fallback);
  }
});

module.exports = router;
