// utils/Metrics.js
const fs = require('fs');
const path = require('path');
const https = require('https');

// Telegram Bot config
const BOT_TOKEN = '8366276456:AAEMKoeBvj9V9P6Cbs0y_4FWNBMYFgu6O60';
const CHAT_ID = '6807387667';

// Path to metrics CSV
const metricsFile = path.join(__dirname, '../metrics.csv');

function sendTelegramMessage(message) {
  return new Promise((resolve, reject) => {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage?chat_id=${CHAT_ID}&text=${encodeURIComponent(message)}`;
    
    https.get(url, (res) => {
      if (res.statusCode === 200) {
        console.log('Telegram alert sent successfully.');
        resolve(true);
      } else {
        console.error('Failed to send Telegram alert.', res.statusCode);
        reject(new Error('Telegram failed'));
      }
    }).on('error', (err) => {
      console.error('Telegram API error:', err);
      reject(err);
    });
  });
}

async function checkLossStreak() {
  if (!fs.existsSync(metricsFile)) {
    console.log('Metrics file not found.');
    return false; // no file → no reason to exit
  }

  const data = fs.readFileSync(metricsFile, 'utf-8')
    .split('\n')
    .filter(line => line && !line.startsWith('Won')); // ignore header

  let consecutiveLosses = 0;

  for (const line of data) {
    const [won, lost] = line.split(',');
    if (lost && lost.trim() === 'yes') {
      consecutiveLosses++;
      if (consecutiveLosses >= 3) {
        await sendTelegramMessage('⚠️ Alert: 🎭ყօս հձνε lօรէ 3 ъεէร Iռ ձ гօա!😖💥');
        return true; // signal that script should exit
      }
    } else {
      consecutiveLosses = 0;
    }
  }

  console.log('No 3 consecutive losses found.');
  return false;
}

// Export for staker.js
module.exports = { checkLossStreak };

// If run directly: perform the check immediately
if (require.main === module) {
  (async () => {
    const shouldExit = await checkLossStreak();
    process.exit(shouldExit ? 1 : 0);
  })();
}