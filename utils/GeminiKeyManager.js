/**
 * Manages multiple Gemini API keys for load balancing and failover.
 * Reads GEMINI_API_KEY, GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc. from .env.
 */
class GeminiKeyManager {
  constructor() {
    this.keys = [];
    this.currentIndex = 0;
    this.loadKeys();
  }

  loadKeys() {
    const keys = new Set();
    
    // Support comma-separated keys in the main env var
    if (process.env.GEMINI_API_KEY) {
      const parts = process.env.GEMINI_API_KEY.split(',').map(k => k.trim()).filter(k => k.length > 10);
      parts.forEach(k => keys.add(k));
    }

    // Support numbered keys
    for (let i = 1; i <= 10; i++) {
      const k = process.env[`GEMINI_API_KEY_${i}`];
      if (k && k.trim().length > 10) {
        keys.add(k.trim());
      }
    }

    this.keys = Array.from(keys);
  }

  hasKey() {
    return this.keys.length > 0;
  }

  getNextKey() {
    if (this.keys.length === 0) return null;
    const key = this.keys[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    return key;
  }

  getAllKeys() {
    return this.keys;
  }
}

module.exports = new GeminiKeyManager();
