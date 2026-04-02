/**
 * Jeano's Core Orchestrator (Config-Driven Version)
 * Synthesizes SME data using dynamic principles from the Google Sheet.
 */

function generateMorningBriefing() {
  console.log("🌞 Jeano is waking up...");

  // 1. GATHER DATA: Health Context
  const config = getJeanoConfig(); 
  const healthData = getHealthContext("DAILY", 1, 1);
  
  // 2. GATHER DATA: Market Context (ETL + Web Intelligence)
  let marketIntelligence = "";
  let portfolioNews = ""; // To capture the deep-dive news
  let etlData = null; // Declare it HERE first so it's available globally in the function

  try {
    etlData = dailyMarketETL(); // Step 1: Your Sheet Sieve
    marketIntelligence = getMarketIntelligence(etlData); // Step 2: Web Intelligence
    portfolioNews = getMarketNews(etlData.mCapBuckets); // Step 3: Integrate the nested Market News search
    console.info("✅ Market context and News Waterfall successfully integrated."); 
  } catch (e) {
    console.warn("⚠️ Market Agent failed. Proceeding with Health-only brief. Error: " + e.message);
    marketIntelligence = marketIntelligence || "MARKET_DATA_UNAVAILABLE";
    portfolioNews = "NEWS_UNAVAILABLE";
  }

  const now = new Date();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const timeContext = {
    current_day: dayNames[now.getDay()],
    previous_day: dayNames[(now.getDay() + 6) % 7], // Handles Sunday -> Saturday wrap
    current_time: Utilities.formatDate(now, "IST", "hh:mm a")
  };

  // 3. CONSTRUCT THE SYNERGETIC PROMPT
  const systemPrompt = `
    ${config.Tone_Directives}

    IDENTITY:
    - Address the user ONLY once at the very beginning of the brief. 
    - Use "Vijay" or "V" as the opening anchor. Do not repeat the name or initials thereafter.

    TEMPORAL CONTEXT:
    - Today is ${timeContext.current_day}, and the current time is ${timeContext.current_time} IST.
    - Previous Day: ${timeContext.previous_day}.
    
    TENSE RULES:
    - Use PAST TENSE for all data from ${timeContext.previous_day} (Health logs, Yesterday's Market Close).
    - Use PRESENT/FUTURE TENSE for all data regarding Today, ${timeContext.current_day} (GIFT Nifty, Open Indications, and Today's Actionables).
    
    [CONTEXT: HEALTH & ACTIVITY]
    DIRECTIVES: ${config.Health_Directives}
    RAW DATA: ${healthData}
    TARGETS: BMR ${config.Daily_BMR}, Protein ${config.Protein_Target}g.
    WORKOUT LOGS: ${healthData.workout_details || "No workout recorded"}
    WORKOUT CALORIES: ${healthData.workout_kcal || 0} kcal
    
    [CONTEXT: MARKET DATA]
    1. ETL SIGNALS: ${JSON.stringify(etlData.signals)}
    2. MACRO INDICES: ${JSON.stringify(etlData.macro)}
    3. EXTERNAL INTELLIGENCE: ${marketIntelligence}
    4. CONSOLIDATED NEWS REPORT: ${portfolioNews}

    [STRICT HIERARCHY OF TRUTH]
    1. INTERNAL DATA (Sheet/ETL): 100% accurate. Use this as the primary source.
    2. MATH LOCK: Use the pre-calculated Net Balance and Protein Gap from RAW DATA exactly. Do NOT recalculate or "estimate" new totals.
    3. NEWS WATERFALL: Use for regulatory context (RBI/SEBI) and ticker-specific news.
    4. SEARCH LIMITS: If news says "Search Limit Reached," do NOT hallucinate reasons. Stick to price action (↑/↓).
    5. EXTERNAL RESEARCH (Web): Only for macro estimation if sheet is "Unknown" or news for flagged stocks.
    
    [LOGIC GATE: DATA PRESENCE]
    - IF HEALTH DATA IS MISSING: Do not assume fasting. State "Health data gap" in <15 words and pivot immediately to Market Pulse.
    - IF PARTIAL DATA: Treat empty fields as "SKIPPED" (0 kcal).

    TASK:
    Produce a three-part narrative morning brief. NO TABLES. NO BOLDING (**). NO HORIZONTAL RULES (---). NO LIST BULLETS.
    
    PART 1: THE OPENING (Morning Greet)
    - A robust "Sentiment & Status" line combining the mood of the market (Gap logic) and health consistency.
    - Determine the mood and emotion for the statement based on the data for the day.

    PART 2: HEALTH & ACTIVITY AUDIT
    - Synthesize Yesterday's behavior. Mention Calories In vs. Net Burn (incorporating workout impact).
    - Audit Protein against the ${config.Protein_Target}g target. 
    - Subtle check for Gout/Hyperuricemia risks in meal logs; mention only if critical.

    PART 3: MARKET SUMMARY & ACTIONABLES
    - Structure this section into FOUR distinct paragraphs, separated by double line breaks:
    1. LEAD PARAGRAPH: State the Index Outlook (Nifty, Gift Nifty & Nasdaq movement) and immediate opening sentiment.
    2. ACTIONABLES PARAGRAPH: Explicitly call out stocks requiring immediate attention (Sells, Cuts, or Immediate Reviews). Group them by ticker name first.
    3. TACTICAL & VOLATILITY PARAGRAPH: Group remaining rebalances (Averages) followed by Volatility Alerts (Holds). For Volatility Alerts, mention the percentage drops but clarify they are "Holds with no action required." Every stock in the signal data must be acknowledged individually.
    4. MARKET NEWS PARAGRAPH: Key news or action items from news about the market or stocks in your portfolio. 

    CONSTRAINTS:
    - Max 300 words. Tone: Sharp, direct, witty. No "butler" fluff.
    - Strictly avoid Markdown formatting like Bold, Italics, or Horizontal Rules. Use plain text and line breaks for separation.
    - Use a separate "⚠️ CRITICAL" header ONLY for severe health deficits or major market orders. 
    - Use "⚠️ DATA GAP" for missing logs.
    `;
  
  try {
    const response = callJeanoAI(systemPrompt);
    archiveBriefing("DAILY_BRIEF", response); // Simplified helper below
    return response;
  } catch (e) {
    console.error("Jeano had a brain-freeze during synthesis:", e);
  }
}

/**
 * Helper to archive briefings to Central Command
 */
function archiveBriefing(type, content) {
  const props = PropertiesService.getScriptProperties();
  const centralId = props.getProperty('CENTRAL_LOG_ID');
  if (!centralId) return;

  const ss = SpreadsheetApp.openById(centralId);
  let sheet = ss.getSheetByName("Daily_Briefings");
  if (!sheet) sheet = ss.insertSheet("Daily_Briefings");
  
  sheet.appendRow([new Date(), type, content]);
  console.log(`✅ ${type} archived to Central Command.`);
}

/**
 * Helper to fetch config from the Sheet
 */
function getJeanoConfig() {
  const props = PropertiesService.getScriptProperties();
  const centralId = props.getProperty('CENTRAL_LOG_ID'); // Central Log ID refers to Central Command!
  
  if (!centralId) {
    console.error("❌ CENTRAL_LOG_ID not found in Script Properties!!");
    return {};
  }

  try {
    const ss = SpreadsheetApp.openById(centralId);
    const sheet = ss.getSheetByName("Jeano_Config");
    
    if (!sheet) {
      console.error("❌ 'Jeano_Config' tab not found in the Central Command sheet!");
      return {};
    }
    
    const data = sheet.getDataRange().getValues();
    const config = {};
    data.forEach(row => {
      if (row[0]) config[row[0].toString().trim()] = row[1];
    });
    
    console.log("🧠 Config loaded successfully from Central Command.");
    return config;
  } catch (e) {
    console.error("❌ Error accessing Central Command sheet:", e);
    return {};
  }
}

/**
 * MODULE: WEEKLY REVIEW ORCHESTRATOR
 * Synthesizes 7 days of behavior against the current clinical truth.
 */
function generateWeeklyReview() {
  console.log("📅 Starting Weekly Review...");
  
  const config = getJeanoConfig();
  
  // 1. GATHER DATA: Pulling 7 days of activity and the absolute latest clinical markers
  const clinicalTruth = getLatestClinicalMarkers();
  const weeklyBehavior = getHealthContext("WEEKLY", 7, 1); 

  // 2. PROMPT CONSTRUCTION: Blending Behavior + Clinical Truth + Tone
  const systemPrompt = `
    ${config.Tone_Directives}
    ${config.Health_Directives}

    CLINICAL BASELINE:
    ${clinicalTruth}

    7-DAY BEHAVIORAL LOGS:
    ${weeklyBehavior}

    TASK:
    - Review the last 7 days. Focus on the trend of Net Energy Balance and Protein consistency.
    - CLINICAL AUDIT: Compare behavior to 🚨 HIGH & ⚠️ LOW markers .
    - DECAY RULE: Mention [HISTORICAL] data only as background (ignore if more than 1.5yrs old); focus advice on [CURRENT] markers.
    - Check the "Gout Guardian" status (Uric Acid vs Purine/Hydration habits).
    - If Weight is present in Behavior, compare to the 85kg [CURRENT] baseline.

    STRUCTURE:
    - Narrative note (no rigid headers).
    - Under 200 words.
    - End with "The One Metric" to fix for next week.
  `;

  // 3. EXECUTION & ARCHIVING
  const review = callJeanoAI(systemPrompt);
  const centralId = PropertiesService.getScriptProperties().getProperty('CENTRAL_LOG_ID');
  const sheet = SpreadsheetApp.openById(centralId).getSheetByName("Daily_Briefings");
  
  sheet.appendRow([new Date(), "WEEKLY_HEALTH_AUDIT", review]);
  console.log("✅ Weekly Review Complete and archived.");
  return review;
}



function sendEmailBriefing(content) {
  const myEmail = Session.getActiveUser().getEmail(); // Or hardcode your email
  const subject = `Jeano's Morning Briefing - ${Utilities.formatDate(new Date(), "GMT+5:30", "dd MMM")}`;
  
  MailApp.sendEmail({
    to: myEmail,
    subject: subject,
    body: content
  });
  console.log("📧 Email Briefing dispatched.");
  }