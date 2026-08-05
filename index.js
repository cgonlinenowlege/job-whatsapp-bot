// =============================================
// JOB WHATSAPP BOT - CG PRIORITY + DAILY LIMIT 5 + IMAGE SUPPORT
// =============================================

const { createClient } = require('@libsql/client');
const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');
const cheerio = require('cheerio');
const qrcode = require('qrcode-terminal');

// =============================================
// 1. TURSO DATABASE SETUP
// =============================================
const db = createClient({
  url: 'libsql://job-alerts-kewalnishad.aws-ap-south-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODU4MjQxMTksImlkIjoiMDE5ZmNiNjktNDgwMS03ZmY5LThmZDMtYzY1NDNiODU0YzMwIiwia2lkIjoidkVMb3hCWU5Bclo2S0JJN3RaaEt1VWxJYUdyM2QybXpuVkxwUy1NUXFJQSIsInJpZCI6IjRkYjdlNjQzLTc2NDQtNDBmZC1hNzAwLWZhZTFiNjE5NzA1OCJ9.vyzqUm-yBEBJGLwsJWWWJAH8Rtu7Y4NWO7j-65fjlgTMHBXpMaQUM-Wa1DxUzPz4fdSZUV6sYPXDt8SX6m0ADQ'
});

(async () => {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT UNIQUE,
        dept TEXT,
        postDate TEXT,
        lastDate TEXT,
        link TEXT,
        image TEXT,
        source TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS daily_limit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT UNIQUE,
        count INTEGER DEFAULT 0
      )
    `);
    console.log('✅ Database tables ready');
  } catch (error) {
    console.error('❌ Database error:', error.message);
  }
})();

// =============================================
// 2. DATABASE FUNCTIONS
// =============================================
async function jobExists(title, lastDate) {
  try {
    const result = await db.execute({
      sql: 'SELECT * FROM jobs WHERE title = ? AND lastDate = ?',
      args: [title, lastDate]
    });
    return result.rows.length > 0;
  } catch (error) {
    console.error('❌ jobExists error:', error.message);
    return true;
  }
}

async function saveJob(job) {
  try {
    await db.execute({
      sql: `INSERT OR IGNORE INTO jobs (title, dept, postDate, lastDate, link, image, source) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [job.title, job.dept, job.postDate, job.lastDate, job.link, job.image || '', job.source]
    });
  } catch (error) {
    console.error('❌ saveJob error:', error.message);
  }
}

// =============================================
// 3. DAILY LIMIT FUNCTIONS
// =============================================
const MAX_JOBS_PER_DAY = 5;

async function getTodayCount() {
  const today = new Date().toISOString().split('T')[0];
  try {
    const result = await db.execute({
      sql: 'SELECT count FROM daily_limit WHERE date = ?',
      args: [today]
    });
    return result.rows.length > 0 ? result.rows[0].count : 0;
  } catch (error) {
    console.error('❌ getTodayCount error:', error.message);
    return 0;
  }
}

async function incrementTodayCount() {
  const today = new Date().toISOString().split('T')[0];
  try {
    await db.execute({
      sql: `INSERT INTO daily_limit (date, count) VALUES (?, 1)
            ON CONFLICT(date) DO UPDATE SET count = count + 1`,
      args: [today]
    });
  } catch (error) {
    console.error('❌ incrementTodayCount error:', error.message);
  }
}

// =============================================
// 4. WHATSAPP CLIENT SETUP
// =============================================
const GROUP_ID = '120363429024479744@g.us';

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

let isReady = false;
let isProcessing = false;
let welcomeSent = false;

client.on('qr', (qr) => {
  console.log('📱 Scan this QR code with WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  isReady = true;
  console.log('✅ WhatsApp Bot is ready!');

  if (!welcomeSent) {
    await sendWelcomeMessage();
    welcomeSent = true;
  }

  if (!isProcessing) {
    isProcessing = true;
    scrapeAndSend();
  }
});

client.on('authenticated', () => {
  console.log('✅ WhatsApp authenticated!');
});

client.on('disconnected', (reason) => {
  console.log('❌ WhatsApp disconnected:', reason);
  isReady = false;
});

client.initialize();

// =============================================
// 5. WELCOME MESSAGE
// =============================================
async function sendWelcomeMessage() {
  if (!isReady) {
    console.log('⏳ Bot not ready');
    return;
  }
  try {
    const message = `
🤖 *AI JOB ALERT SYSTEM - READY* 🚀

🎉 *आपका AI प्रोजेक्ट सफलतापूर्वक तैयार हो गया है!*

📢 *अब से हर दिन आपको मिलेंगी:*
✅ *CG Govt Jobs* (Apply Online)
✅ *Central Govt Jobs* (Apply Online)
✅ *सिर्फ Apply Online वाली Jobs*
✅ *दिन में सिर्फ 5 Jobs* (Spam नहीं)

📞 *मदद:* 7999569059 (WhatsApp)

*आपकी टीम* 😊`;
    await client.sendMessage(GROUP_ID, message);
    console.log('📨 Welcome message sent!');
  } catch (error) {
    console.error('❌ Welcome message error:', error.message);
  }
}

// =============================================
// 6. MAIN SCRAPER
// =============================================
async function scrapeAndSend() {
  if (!isReady) {
    console.log('⏳ Bot not ready');
    return;
  }

  const todayCount = await getTodayCount();
  if (todayCount >= MAX_JOBS_PER_DAY) {
    console.log(`⏳ Daily limit reached (${MAX_JOBS_PER_DAY}).`);
    return;
  }

  console.log('🔄 ' + '='.repeat(40));
  console.log('🔄 Scraping started at:', new Date().toLocaleString());
  console.log(`📊 Today's sent: ${todayCount}/${MAX_JOBS_PER_DAY}`);
  console.log('🔄 ' + '='.repeat(40));

  let totalNewJobs = 0;

  try {
    console.log('📌 [PRIORITY 1] Fetching CG Jobs...');
    const cgCount = await scrapeFreeJobAlert(
      'https://www.freejobalert.com/chhattisgarh-government-jobs/',
      'CG Govt'
    );
    totalNewJobs += cgCount;

    console.log('📌 [PRIORITY 2] Fetching Central Jobs...');
    const centralCount = await scrapeFreeJobAlert(
      'https://www.freejobalert.com/government-jobs/',
      'Central Govt'
    );
    totalNewJobs += centralCount;

  } catch (error) {
    console.error('❌ Main scrape error:', error.message);
  }

  if (totalNewJobs === 0) {
    await sendNoJobMessage();
  }

  console.log('✅ Scraping completed at:', new Date().toLocaleString());
  console.log('='.repeat(50) + '\n');
}

// =============================================
// 7. SCRAPER WITH IMAGE SUPPORT
// =============================================
async function scrapeFreeJobAlert(url, source) {
  let newJobsCount = 0;
  const todayCount = await getTodayCount();

  if (todayCount >= MAX_JOBS_PER_DAY) {
    console.log(`⏳ Daily limit reached. Skipping ${source}`);
    return 0;
  }

  try {
    const { data } = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(data);
    const jobs = [];

    $('table tr').each((i, row) => {
      if (i === 0) return;
      const cols = $(row).find('td');
      if (cols.length >= 3) {
        const title = $(cols[1]).text().trim();
        const lastDate = $(cols[2]).text().trim();
        const link = $(cols[1]).find('a').attr('href') || '';
        const postDate = $(cols[0]).text().trim();

        // Filter: Only Apply Online
        const isApplyJob = link.toLowerCase().includes('apply') ||
                           link.toLowerCase().includes('form') ||
                           title.toLowerCase().includes('apply') ||
                           title.toLowerCase().includes('form') ||
                           title.toLowerCase().includes('vacancy');

        const isNotApply = title.toLowerCase().includes('admit') ||
                           title.toLowerCase().includes('result') ||
                           title.toLowerCase().includes('answer') ||
                           title.toLowerCase().includes('cut off') ||
                           title.toLowerCase().includes('merit') ||
                           title.toLowerCase().includes('intimation') ||
                           title.toLowerCase().includes('provisional') ||
                           title.toLowerCase().includes('download') ||
                           title.toLowerCase().includes('admit card') ||
                           title.toLowerCase().includes('final');

        if (!isApplyJob || isNotApply) return;

        if (title && lastDate && title !== '') {
          // Try to get image
          let image = '';
          const imgTag = $(cols[1]).find('img');
          if (imgTag.length > 0) {
            image = imgTag.attr('src') || '';
          }
          if (!image && link) {
            image = link.replace('/jobs/', '/thumb/') + '.jpg';
          }

          jobs.push({
            title,
            dept: source,
            postDate: postDate || 'Check PDF',
            lastDate,
            link,
            source,
            image
          });
        }
      }
    });

    console.log(`   📌 Found ${jobs.length} APPLY ONLINE jobs on ${source}`);

    for (const job of jobs) {
      const todayCountNow = await getTodayCount();
      if (todayCountNow >= MAX_JOBS_PER_DAY) {
        console.log(`   ⏳ Daily limit reached. Stopping ${source}`);
        break;
      }

      const exists = await jobExists(job.title, job.lastDate);

      if (!exists) {
        const sent = await sendWhatsAppMessage(job);
        if (sent) {
          await saveJob(job);
          await incrementTodayCount();
          newJobsCount++;
          console.log(`   ✅ NEW: ${job.title} (${job.lastDate})`);
        }
      }
    }

    console.log(`   ✅ ${source}: ${newJobsCount} new jobs sent`);

  } catch (error) {
    console.error(`❌ ${source} scrape error:`, error.message);
  }

  return newJobsCount;
}

// =============================================
// 8. WHATSAPP SEND WITH IMAGE + CONTACT
// =============================================
async function sendWhatsAppMessage(job) {
  if (!isReady) {
    console.log('⏳ Bot not ready');
    return false;
  }

  try {
    const isCG = job.source === 'CG Govt';
    const emoji = isCG ? '🟢' : '🔵';
    const title = isCG ? 'CG GOVT JOB ALERT' : 'CENTRAL GOVT JOB ALERT';

    // Text Message
    const textMessage = `
${emoji} *${title}*
🏢 Dept: ${job.source}
📌 Post: ${job.title}
📅 Start: ${job.postDate || 'Check PDF'}
⏰ Last: ${job.lastDate}
🔗 Apply Link: ${job.link || 'Check website'}

─────────────────
📞 *Apply Online ke liye sampark karein:*
💬 WhatsApp: 7999569059
💰 *Fee:* Only ₹50 (General) | ₹30 (Vyapam)
─────────────────
    `;

    // Image send (if available)
    if (job.image && job.image.startsWith('http')) {
      try {
        await client.sendMessage(GROUP_ID, {
          image: { url: job.image },
          caption: `📸 ${job.title}`
        });
        console.log(`   🖼️ Image sent: ${job.title}`);
      } catch (imgError) {
        console.log(`   ⚠️ Image failed: ${imgError.message}`);
      }
    }

    // Text message
    await client.sendMessage(GROUP_ID, textMessage);
    console.log(`   📨 Sent: ${job.title}`);
    return true;

  } catch (error) {
    console.error(`❌ Send error: ${error.message}`);
    return false;
  }
}

// =============================================
// 9. NO JOB MESSAGE
// =============================================
async function sendNoJobMessage() {
  if (!isReady) return;
  try {
    const message = `
🔍 *जॉब अपडेट*
अभी कोई नई *Apply Online* जॉब उपलब्ध नहीं है।
कृपया *प्रतीक्षा* करें, नई जॉब आने पर आपको सूचित कर दिया जाएगा। 🙏
📞 मदद: 7999569059 (WhatsApp)`;
    await client.sendMessage(GROUP_ID, message);
    console.log('📨 No job message sent');
  } catch (error) {
    console.error('❌ No job message error:', error.message);
  }
}

// =============================================
// 10. STARTUP
// =============================================
console.log('🚀 Job WhatsApp Bot started!');
console.log('📱 Waiting for WhatsApp to connect...');
console.log(`📊 Daily limit: ${MAX_JOBS_PER_DAY} jobs per day`);
console.log('⚡ Press Ctrl+C to stop\n');

if (process.env.GITHUB_ACTIONS) {
  console.log('🔄 Running on GitHub Actions (every 3 hours)');
} else {
  console.log('🔄 Running on local machine (testing mode)');
  setInterval(() => {
    if (isReady && !isProcessing) {
      isProcessing = true;
      scrapeAndSend();
      setTimeout(() => { isProcessing = false; }, 60000);
    }
  }, 5 * 60 * 1000);
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});
