/**
 * Jeano's Core Orchestrator (Config-Driven Version)
 * Synthesizes SME data using dynamic principles from the Google Sheet.
 */

function generateHealthTroubleshootBriefing() {
  console.log("🌞 Jeano is waking up (Health-Only Mode)...");

  // 1. GATHER DATA: Health Context
  // This will pull from your Daily Logs or Firestore
  const config = getJeanoConfig(); 
  const healthData = getHealthContext("DAILY", 1, 1);
  
  // 2. CONSTRUCT THE HEALTH-ONLY PROMPT
  // Market context blocks and 'etlData' references have been removed
  const systemPrompt = `
    ${config.Tone_Directives}

    IDENTITY:
    Address the user ONLY as "Vijay" or "V".

    [CONTEXT: HEALTH]
    DIRECTIVES: ${config.Health_Directives}
    YESTERDAY'S STATS: ${healthData}
    TARGETS: BMR ${config.Daily_BMR}, Protein ${config.Protein_Target}g.
    
    [STRICT HIERARCHY OF TRUTH]
    1. INTERNAL DATA (Sheet): This is 100% accurate. You MUST use this.
    2. EXTERNAL RESEARCH (Web): Only used for calorie/macro estimation if the sheet entry is "Unknown".
    
    TASK:
    Produce a Health-Focused Briefing.

    PART 1: DATA AUDIT (Table Only)
    - Provide a "Health Snapshot" table: Metric | Actual | Target | Status.

    PART 2: THE SYNTHESIS (Narrative)
    - Tone: Sharp, direct, and witty. No fluff.
    - Analyze protein adequacy and energy balance.
    - Follow the hierarchy of truth mandatorily.
    - Check Gout/Hyperuricemia risks in meal logs (Check for high-purine foods if Uric Acid is a concern).
    - If data is skewed (like impossible calorie counts), mention it as a data error.

    CONSTRAINTS:
    - Max 150 words. No "butler" fluff.
    - If data is not available or null, ignore and proceed. Just mention data not available briefly.
    - Structure: Narrative flow. No rigid headers.
    - A separate "⚠️ CRITICAL" header ONLY if there is a severe health deficit.
    `;
  
  try {
    // Passes the prompt to Gemini via your AIGateway
    const response = callJeanoAI(systemPrompt);
    archiveBriefing("HEALTH_TROUBLESHOOT", response); 
    return response;
  } catch (e) {
    console.error("Jeano had a brain-freeze during health synthesis:", e);
  }
}

function generateMorningBriefing() {
  console.log("🌞 Jeano is waking up...");

  // 1. GATHER DATA: Health Context
  const config = getJeanoConfig(); 
  const healthData = getHealthContext("DAILY", 1, 1);
  
  // 2. GATHER DATA: Market Context (ETL + Web Intelligence)
  let marketIntelligence = "";
  let etlData = null; // Declare it HERE first so it's available globally in the function

  try {
    etlData = dailyMarketETL(); // Step 1: Your Sheet Sieve
    marketIntelligence = getMarketIntelligence(etlData); // Step 2: Web Intelligence
    console.info("✅ Market context successfully integrated.");
  } catch (e) {
    console.warn("⚠️ Market Agent failed. Proceeding with Health-only brief. Error: " + e.message);
    marketIntelligence = "MARKET_DATA_UNAVAILABLE";
  }

  // 3. CONSTRUCT THE SYNERGETIC PROMPT
  const systemPrompt = `
    ${config.Tone_Directives}

    IDENTITY:
    Address the user ONLY as "Vijay" or "V". Do not use "Vijay" or "Vijay, V".

    [CONTEXT: HEALTH]
    DIRECTIVES: ${config.Health_Directives}
    YESTERDAY'S STATS: ${healthData}
    TARGETS: BMR ${config.Daily_BMR}, Protein ${config.Protein_Target}g.
    
    [STRICT HIERARCHY OF TRUTH]
    1. INTERNAL DATA (Sheet): This is 100% accurate. You MUST use this.
    2. EXTERNAL RESEARCH (Web): This is secondary. If it says N/A, ignore it and use INTERNAL DATA.
    
    [CONTEXT: INTERNAL DATA]
    1. The following trade signals were triggered by the ETL today. If a signal is present, you must include it in the brief: 
        Signals Triggered Today: ${JSON.stringify(etlData.signals)}
    2. The following macro data was extracted from the Sheet:    
        Macro Indices from Sheet: ${JSON.stringify(etlData.macro)}
    
    [CONTEXT: EXTERNAL RESEARCH]
    ${marketIntelligence}

    TASK:
    Produce a TWO-PART brief.

    PART 1: DATA AUDIT (Tables Only)
    - Provide a "Market Pulse" table: Index/Metric | Value | Change.
    - Provide a "Health Snapshot" table: Metric | Actual | Target | Status.

    PART 2: THE SYNTHESIS (Narrative)
    - Tone: Sharp, direct, and witty. No fluff.
    - Synthesize health status and market opening into a sharp, witty morning briefing.
    - Start with a punchy "Sentiment & Status" line.
    - Follow the heirachy of truth mandatorily
    - If the External Research is "N/A", focus the narrative ENTIRELY on the Internal Signals and the available Macro levels.
    - Never say "market intelligence is a black box" if Internal Signals are present.
    - Opening: Use the (Point B - Point A) Gap logic based on indices for the market outlook.
    - Body: Pivot from Health Adequacy (Protein/Energy) to Market Actionables.
    - CRITICAL: Only mention news/orders for the stocks flagged in the intelligence.
    - Check Gout/Hyperuricemia risks in meal logs but keep it subtle but dont mention it explicitly unless necessary.

    CONSTRAINTS:
    - Max 200 words. Tone: Sharp, direct, no "butler" fluff.
    - If data is not available or null, ignore and proceed. Just mention data not available and dont spend too much words on it.
    - Structure: Narrative flow. No rigid headers.
    - If the Gap is significant (100pts on GIFTNIFTY, 300pts on NASDAQ), use strong sentiment (Gap Up/Down).
    - A separate "⚠️ CRITICAL" header ONLY if there is a severe health deficit or major market order.
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