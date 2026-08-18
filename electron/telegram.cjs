/**
 * v0.36.1 — Telegram bot sender.
 * Отправка сообщений через Bot API (sendMessage). Поддерживает HTTP и SOCKS5
 * прокси через опциональный `proxy-agent`; если проксёй пакета нет — работает
 * напрямую (для стран без блокировки Telegram этого достаточно).
 *
 * Хранится в main-process — renderer вызывает через IPC (netmap:telegramSend).
 * Renderer НЕ должен иметь доступа к сети напрямую (contextIsolation on).
 */

const https = require('https');
const http  = require('http');
const { URL } = require('url');

// Пытаемся подгрузить агенты. Оба optional — если пакеты не установлены,
// прокси-поддержка деградирует до "прямое подключение".
let HttpsProxyAgent = null;
let SocksProxyAgent = null;
try { ({ HttpsProxyAgent } = require('https-proxy-agent')); } catch { /* optional */ }
try { ({ SocksProxyAgent } = require('socks-proxy-agent')); } catch { /* optional */ }

function makeAgent(proxyUrl) {
  if (!proxyUrl) return null;
  try {
    const u = new URL(proxyUrl);
    if (u.protocol === 'socks5:' || u.protocol === 'socks:' || u.protocol === 'socks4:') {
      if (!SocksProxyAgent) throw new Error('socks-proxy-agent не установлен — SOCKS прокси недоступны');
      return new SocksProxyAgent(proxyUrl);
    }
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      if (!HttpsProxyAgent) throw new Error('https-proxy-agent не установлен — HTTP прокси недоступны');
      return new HttpsProxyAgent(proxyUrl);
    }
    throw new Error(`Неизвестный протокол прокси: ${u.protocol}`);
  } catch (e) {
    throw new Error(`Bad proxy URL "${proxyUrl}": ${e.message}`);
  }
}

/**
 * Отправить сообщение в Telegram.
 * @param {object} cfg
 * @param {string} cfg.botToken   — токен от @BotFather
 * @param {string} cfg.chatId     — id чата (число или "-100..."), либо @channel_name
 * @param {string} cfg.message    — текст (parseMode HTML/Markdown если указан)
 * @param {string} [cfg.parseMode='HTML']
 * @param {string} [cfg.proxyUrl] — http:// / socks5://
 * @returns {Promise<{ok: boolean, error?: string, telegramResponse?: any}>}
 */
async function send(cfg) {
  if (!cfg?.botToken)  return { ok: false, error: 'botToken не задан' };
  if (!cfg?.chatId)    return { ok: false, error: 'chatId не задан' };
  if (!cfg?.message)   return { ok: false, error: 'message пустой' };

  const payload = JSON.stringify({
    chat_id: cfg.chatId,
    text: cfg.message,
    parse_mode: cfg.parseMode || 'HTML',
    disable_web_page_preview: true,
  });
  const url = `https://api.telegram.org/bot${encodeURIComponent(cfg.botToken)}/sendMessage`;
  const u = new URL(url);
  const isHttps = u.protocol === 'https:';
  const lib = isHttps ? https : http;

  let agent;
  try { agent = makeAgent(cfg.proxyUrl); }
  catch (e) { return { ok: false, error: e.message }; }

  return new Promise((resolve) => {
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 12000,
      ...(agent ? { agent } : {}),
    };
    const req = lib.request(opts, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw || '{}');
          if (parsed.ok) resolve({ ok: true, telegramResponse: parsed });
          else resolve({ ok: false, error: parsed.description || `HTTP ${res.statusCode}`, telegramResponse: parsed });
        } catch (e) {
          resolve({ ok: false, error: `Ответ не JSON: ${raw.slice(0, 200)}` });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message || String(e) }));
    req.write(payload);
    req.end();
  });
}

module.exports = { send };
