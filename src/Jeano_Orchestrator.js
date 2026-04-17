/**
 * Jeano's Core Orchestrator (Config-Driven Version)
 * Synthesizes SME data using dynamic principles from the Google Sheet.
 */

function generateMorningBriefing() {
  console.log("🌞 Jeano is waking up...");

  // DATE, TIME & DAY Context
  const now = new Date();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const timeContext = {
    current_day: dayNames[now.getDay()],
    previous_day: dayNames[(now.getDay() + 6) % 7], // Handles Sunday -> Saturday wrap
    current_time: Utilities.formatDate(now, JEANO_TIMEZONE, "hh:mm a")
  };
  const isWeekend = (now.getDay() === 0 || now.getDay() === 6); // 0 is Sunday, 6 is Saturday

  // 1. GATHER DATA: Health Context
  const config = getJeanoConfig(); 
  const healthData = getHealthContext("DAILY", 1, 1);

  // Logic Check: If both intake and burn are 0, it's a silent day
  const isHealthSilent = (healthData.totals.kcal === 0 && healthData.totalBurnout === 0);

  if (isHealthSilent) {
    console.log("⚠️ [DATA GAP] Health is silent. Flagging for AI.");
  }

  let healthPromptBlock = "";
  if (isHealthSilent) {
    healthPromptBlock = `[CONTEXT: HEALTH & ACTIVITY]
    STATUS: USER DID NOT LOG DATA YESTERDAY.
    INSTRUCTION: Report a ⚠️ DATA GAP. Skip ALL deficit calculations, protein math, and meal analysis. Do NOT hallucinate numbers or deficits.`;
  } else {
    healthPromptBlock = `[CONTEXT: HEALTH & ACTIVITY]
    DIRECTIVES: ${config.Health_Directives}
    RAW DATA: ${JSON.stringify(healthData)}
    TARGETS: BMR ${config.Daily_BMR}, Protein ${config.Protein_Target}g.
    WORKOUT LOGS: ${healthData.workout_details || "No workout recorded"}
    WORKOUT CALORIES: ${healthData.workout_kcal || 0} kcal`;
  }

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

  // Safely extract the exact GIFT Nifty change from the JSON payload
  let marketSentiment = "Neutral";
  try {
    // Check if it's a string that needs parsing, or already an object
    const miObj = typeof marketIntelligence === 'string' ? JSON.parse(marketIntelligence) : marketIntelligence;
    
    if (miObj && miObj.gift_nifty && miObj.gift_nifty.change) {
      // Remove the '%' sign and convert to a number (e.g., "-0.43%" -> -0.43)
      const giftNiftyVal = parseFloat(miObj.gift_nifty.change.replace('%', ''));
      marketSentiment = getSentimentLabel(giftNiftyVal);
    }
  } catch (e) {
    console.warn("⚠️ Could not parse GIFT Nifty sentiment. Defaulting to Neutral.");
  }

  // Splitting the consolidated news string into Macro vs Stock Specific
  let macroNews = "N/A";
  let stockNews = "N/A";
  if (portfolioNews.includes("**Large Caps:**")) {
    const parts = portfolioNews.split("**Large Caps:**");
    macroNews = parts[0].replace("**Macro & Regulatory:**", "").trim();
    stockNews = "**Large Caps:**\n" + parts[1].trim();
  } else {
    macroNews = portfolioNews; // Fallback if the split text isn't found
  }

  let marketContextBlock = "";
  if (isWeekend) {
    marketContextBlock = `[CONTEXT: MARKET DATA]
    1. MACRO & REGULATORY NEWS: ${macroNews}
    2. PORTFOLIO SPECIFIC NEWS: ${stockNews}
    STATUS: MARKET IS CLOSED FOR THE WEEKEND.`;
  } else {
    marketContextBlock = `[CONTEXT: MARKET DATA]
    1. ETL SIGNALS: ${JSON.stringify(etlData.signals)}
    2. MACRO INDICES: ${JSON.stringify(etlData.macro)}
    3. EXTERNAL INTELLIGENCE: ${marketIntelligence}
    4A. MACRO & REGULATORY NEWS: ${macroNews}
    4B. PORTFOLIO SPECIFIC NEWS: ${stockNews}`;
  }

  let marketTaskBlock = "";
  if (isWeekend) {
    marketTaskBlock = `PART 3: WEEKEND MARKET REVIEW
    - Briefly acknowledge that it's the weekend and the markets are closed.
    - Provide a concise summary of the Macro & Regulatory News and any relevant Portfolio Specific News.
    - Do NOT provide index outlooks, actionable items, or volatility alerts. Keep it conversational.`;
  } else {
    marketTaskBlock = `PART 3: MARKET SUMMARY & ACTIONABLES
    - Structure this section into FOUR distinct paragraphs, separated by double line breaks:
    1. LEAD PARAGRAPH: State the Index Outlook (Nifty, Gift Nifty & Nasdaq) and immediate opening sentiment.
    2. ACTIONABLES PARAGRAPH: Call out stocks requiring immediate attention (Sells, Cuts, or Immediate Reviews). 
    3. TACTICAL & VOLATILITY PARAGRAPH: Group remaining rebalances followed by Volatility Alerts (Holds). 
    4. MARKET NEWS PARAGRAPH: Synthesize key items from 4A (Macro) and 4B (Portfolio Specific). You MUST include stock-specific news if it exists in 4B.`;
  }

  // 3. CONSTRUCT THE SYNERGETIC PROMPT
  const systemPrompt = `
    ${config.Tone_Directives}

    IDENTITY:
    - You are Jeano, delivering the daily morning brief for Vijay.
    - You are Vijay's friend, assistant and guide - address him such; Use "Vijay" or "V" as the opening anchor. 
    - Do not repeat the name or initials thereafter.
    - You will talk in first person - Use "I" instead of "Jeano" or "the assistant."

    TEMPORAL CONTEXT:
    - Today is ${timeContext.current_day}, and the current time is ${timeContext.current_time} IST.
    - Previous Day: ${timeContext.previous_day}.
    
    TENSE RULES:
    - Use PAST TENSE for all data from ${timeContext.previous_day} (Health logs, Yesterday's Market Close).
    - Use PRESENT/FUTURE TENSE for all data regarding Today, ${timeContext.current_day} (GIFT Nifty, Open Indications, and Today's Actionables).
    
    ${healthPromptBlock}

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
    - [MARKET SENTIMENT ANCHOR: ${marketSentiment}]. Let this anchor word dictate how extreme or mild your opening market vocabulary is. Do not exaggerate flat/moderate moves.

    PART 2: HEALTH & ACTIVITY AUDIT
    - Synthesize Yesterday's behavior based STRICTLY on the Health Context block. Mention Calories In vs. Net Burn (incorporating workout impact).
    - Audit Protein against the ${config.Protein_Target}g target. 
    - Subtle check for Gout/Hyperuricemia risks in meal logs; mention only if critical.

    ${marketContextBlock}

    CONSTRAINTS:
    - Max 300 words. Tone: Sharp, direct, witty. No "butler" fluff.
    - Strictly avoid Markdown formatting like Bold, Italics, or Horizontal Rules. Use plain text and line breaks for separation.
    - Use a separate "⚠️ CRITICAL" header ONLY for severe health deficits or major market orders. 
    - Use "⚠️ DATA GAP" for missing logs.
    `;
  
  try {
    const response = callJeanoAI(systemPrompt);
    // Check if the brief exists before we even try to archive it
    console.log(`ORCHESTRATOR: Brief content is type [${typeof response}] and has length [${response ? response.length : 'NULL'}]`);
    archiveBriefing("DAILY_BRIEF", response); // Simplified helper below
    return response;
  } catch (e) {
    console.error("Jeano had a brain-freeze during synthesis:", e);
  }
}

// ================================================================================================================= //

/**
 * Upgraded Archive Function
 * 1. Syncs to Google Sheets (Human Readable)
 * 2. Persists to Firestore (Jeano's Long-term Memory)
 * 3. Logs to the Master Event Log (Audit Trail)
 * 4. Moves the brief through the lifecycle: GENERATED -> STORED -> ARCHIVED
 */
/**
 * Master Archive Function
 * Uses "Upsert" logic to handle multiple runs on the same day.
 */
function archiveBriefing(type, content) {
  const firestore = getFirestore();
  const date = new Date();
  const docId = Utilities.formatDate(date, JEANO_TIMEZONE, "yyyy-MM-dd");
  const collectionName = (type === "WEEKLY_REVIEW") ? "Weekly_Reviews" : "Daily_Briefs";
  const path = `${collectionName}/${docId}`;

  console.log(`ARCHIVE_FUNC: Received type [${type}] and content length [${content ? content.length : 'UNDEFINED'}]`);
  
  // 1. INITIALIZE SCHEMA
  const initialSchema = {
    "timestamp": Utilities.formatDate(date, JEANO_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss"),
    "type": type,
    "content": content,
    "lifecycle": "GENERATED",
    "version": "2.5"
  };

  try {
    // Attempt to create the document with the full schema first
    try {
      firestore.createDocument(path, initialSchema);
      console.log(`🆕 Initialized schema for ${docId}`);
    } catch (e) {
      // If it exists, update it with the full schema to ensure keys are present
      firestore.updateDocument(path, initialSchema);
      console.log(`🔄 Re-initialized schema for ${docId}`);
    }
    console.log(`DEBUG: [${path}] | Content Type: ${typeof content} | Data: ${content.toString().substring(0, 100)}...`);
    
    // 2. ADVANCE STATUS (Stored)
    firestore.updateDocument(path, { "lifecycle": "STORED" }, true);
    const logTime = Utilities.formatDate(new Date(), JEANO_TIMEZONE, "hh:mm:ss");
    console.log(`📦 Brief generated and stored in Firestore at (${logTime})`);

    // 3. ARCHIVAL (Sheets)
    const props = PropertiesService.getScriptProperties();
    const centralId = props.getProperty('CENTRAL_LOG_ID');
    
    if (centralId) {
      const ss = SpreadsheetApp.openById(centralId);
      const sheet = ss.getSheetByName("Archive_Log") || ss.insertSheet("Archive_Log");
      sheet.appendRow([date, type, content]);
      
      // 4. ADVANCE STATUS (Archived)
      firestore.updateDocument(path, { "lifecycle": "ARCHIVED" }, true);
      const logTime = Utilities.formatDate(new Date(), JEANO_TIMEZONE, "hh:mm:ss");
      console.log(`📦 Brief delivered and archived at (${logTime})`);

      logJeanoEvent(`ARCHIVE_${type}`, `Brief manifested and archived at ${logTime}.`, "SUCCESS");
    }

  } catch (err) {
    console.error(`❌ Archival disruption: ${err.message}`);
    // Only update if the doc actually exists
    try { firestore.updateDocument(path, { "lifecycle": "FAILED" }); } catch(f) {}
    logJeanoEvent(`SYSTEM_ERROR`, err.message, "FAILED");
  }
}

// ================================================================================================================= //


/**
 * Master Event Log (MEL) - Fixed Data Passing
 */
function logJeanoEvent(type, message, status = "SUCCESS") {
  const firestore = getFirestore();
  const now = new Date();
  
  const datePart = Utilities.formatDate(now, JEANO_TIMEZONE, "yyyy-MM-dd");
  const timePart = Utilities.formatDate(now, JEANO_TIMEZONE, "HHmm");
  const logId = `${datePart}_${timePart}_${type}`;

  const logData = {
    "timestamp": Utilities.formatDate(now, JEANO_TIMEZONE, "yyyy-MM-dd HH:mm:ss"),
    "event_type": type,
    "message": message,
    "status": status
  };

  // Observability
  console.log(`[LOG_TRANSIT] Attempting write to Jeano_Logs/${logId}`);

  try {
    const response = firestore.createDocument(`Jeano_Logs/${logId}`, logData);
    console.log(`✅ [LOG_SUCCESS] Audit entry created: ${logId}`);
    return response;
  } catch (e) {
    console.error(`[LOG_ERROR] Path-based write failed, trying fallback: ${e.message}`);
    return firestore.createDocument("Jeano_Logs", logId, logData);
  }
}
// ================================================================================================================= //

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


// ================================================================================================================= //


// HELPER: Market Sentiment Anchor
function getSentimentLabel(changePercent) {
  const absChange = Math.abs(parseFloat(changePercent));
  if (isNaN(absChange)) return "Mixed/Unclear";
  if (absChange < 0.5) return "Flat/Tepid";
  if (absChange >= 0.5 && absChange <= 1.0) return "Moderate";
  return "Significant";
}

// ================================================================================================================= //

/**
 * MODULE: WEEKLY REVIEW ORCHESTRATOR
 **/
function generateWeeklyBrief() {
  
  console.log("📅 Starting Weekly Executive Review...");
  
  const config = getJeanoConfig();
  
  // --- DATE ANCHOR LOGIC // ALWAYS GENERATE BRIEF FOR LAST COMPLETED WEEK (Sun-Sat) ---
  const today = new Date();
  const daysToSubtract = today.getDay() + 1; 
  
  const lastSaturday = new Date(today.getTime());
  lastSaturday.setDate(today.getDate() - daysToSubtract);
  
  // 🔄 UPDATED: Using Centralized Timezone
  const targetDateStr = Utilities.formatDate(lastSaturday, JEANO_TIMEZONE, "yyyy-MM-dd");

  console.log(`📅 Starting Weekly Executive Review for week ending ${targetDateStr}`);

  // 1. GATHER DATA: The New Aggregation Layer
  const clinicalTruth = getLatestClinicalMarkers(); 
  
  // Health Data (Untouched)
  const weeklyHealthStats = getWeeklyHealthAggregation(targetDateStr); 
  
  // 📈 THE NEW MARKET DATA PIPELINE
  const weeklyMarketContext = getWeeklyMarketContext(targetDateStr); 
  // Returns formatted string: Benchmarks, Gainers/Losers, Alpha metrics

  // DEBUG LOGS
  console.log("DEBUG: weeklyMarketContext Type:", typeof weeklyMarketContext);
  console.log("DEBUG: outliers found in context:", weeklyMarketContext.outliers);

  // IMPORTANT: unbox the outliers and the narrative correctly
  const outliers = weeklyMarketContext.outliers || []; 
  const marketNarrative = weeklyMarketContext.narrative || "No context found.";

  // Final verification before the "big" call
  console.log(`🚀 Passing ${outliers.length} tickers to Intelligence Engine...`);

  const weeklyIntelligence = getWeeklyIntelligence(targetDateStr, marketNarrative, outliers);
  // Returns formatted string: Portfolio News, Macro News, Lookahead Events

  // 2. PROMPT CONSTRUCTION: The High-Altitude Blueprint
  const systemPrompt = `
    ${config.Tone_Directives}
    
    IDENTITY:
    - You are Jeano, delivering the Sunday Weekly Retrospective for Vijay.
    - You are Vijay's friend, assistant and guide - address him such.
    - You will talk in first person - Use "I" instead of "Jeano" or "the assistant."
    - Altitude: High-level executive summary. Do not complain about missing daily logs. If days are missing, extrapolate from what we have.

    [CONTEXT: WEEKLY HEALTH METRICS]
    - Days Logged: ${weeklyHealthStats.daysLogged}/7
    - Net Weekly Deficit: ${weeklyHealthStats.totalDeficit} kcal (Projects approx ${(weeklyHealthStats.totalDeficit / 7700).toFixed(2)} kg of fat loss).
    - Protein Consistency: Hit target on ${weeklyHealthStats.proteinScore} out of 7 days.
    - Workout Summary: ${weeklyHealthStats.workoutSummary}
    - DIETARY LOG: 
    ${weeklyHealthStats.weeklyMealNarrative}
    
    [CONTEXT: CLINICAL BASELINE]
    ${clinicalTruth}

    [CONTEXT: WEEKLY MARKET SNAPSHOT]
    ${weeklyMarketContext}

    [CONTEXT: MARKET INTELLIGENCE & NEWS]
    ${weeklyIntelligence}

    TASK:
    Produce a 5-part Weekly Retrospective. NO TABLES. NO BOLDING (**). NO LIST BULLETS. Use double line breaks between sections.
    CRITICAL: Only output "INSUFFICIENT DATA FOR ANALYSIS" if the context variables provided are literally empty or null. Do not use this phrase if structured metrics (numbers/tickers) are present.

    THE VIBE HEADER:
    - Start the very first line of the response with a 2-to-3 word title (followed by a period) that summarizes the overall strategic or emotional state of the week, synthesizing both health and market performance.

    PART 1: THE WEEK IN NUMBERS
    - Summarize the net weekly energy deficit, workout consistency, and protein hits. 
    - Assess if the week was Optimized, Mixed, or Irregular based on these numbers.

    PART 2: CLINICAL ALIGNMENT (NUTRITIONIST MODE)
    - Cross-reference the specific foods in the DIETARY LOG with the 🚨 HIGH & ⚠️ LOW clinical markers (e.g., Cholesterol, Uric Acid, LDL). 
    - Specifically call out if anomalous meals (junk food/sweets) negatively impacted the baseline, or if clean eating supported it. 
    - Suggest one hyper-specific meal or workout tweak for next week.

    PART 3: PORTFOLIO PERFORMANCE (QUANT MODE)
    - You MUST report the specific numbers from the [WEEKLY MARKET SNAPSHOT].
    - State the NIFTY_50 and INDIA_VIX % changes.
    - List the Top 3 Alpha Leaders and Top 3 Alpha Laggards by name, their absolute % change, and their Alpha score.
    - Constraint: Stick to the raw data provided. No causality. If the data is present in the context, you are FORBIDDEN from saying "Insufficient Data."

    PART 4: MARKET INTELLIGENCE 
    - Restate the reported Corporate Records and Macro/Regulatory events found in the Intelligence context.
    - Only link an event to a ticker if the Intelligence Records explicitly identify it as a catalyst.
    - If the Intelligence Records state "NO RECORDS FOUND" for a leader/laggard, do not synthesize a narrative. Report the data gap.

    FOOTNOTE:
    - End the brief with a simple, single & sharp observation as foot note.
    - TONE: High-signal, low-drama. A mix of dry wit and brutal honesty. 
    - LOGIC: Look at the biggest data gap or behavioral fail in the brief. 
    - TASK: Call out the "Elephant in the Room" without the philosophical fluff.
    - CONSTRAINT: Maximum 10 words. No headers like "The North Star" or "Part 5."

    CONSTRAINTS:
    - Max 450 words. Tone: Strategic, analytical, direct.
    - Use arrows (↑/↓) for market percentages.
    - If Market Intelligence is unavailable, do not speculate on sentiment. Output "INSUFFICIENT DATA".
  `;

  // 3. EXECUTION & ARCHIVING
  try {
    const review = callJeanoAI(systemPrompt);
    archiveBriefing("WEEKLY_REVIEW", review);
    console.log("✅ Weekly Review Complete and archived.");
    return review;
  } catch (e) {
    console.error("Jeano had a brain-freeze during weekly synthesis:", e);
  }
}

// ================================================================================================================= //

function getWeeklyHealthAggregation(targetDateStr) {
  console.log("📊 Starting Weekly Health & Diet Aggregation...");
  
  const firestore = getFirestore(); 
  const targetDates = getLast7DaysFormatted(targetDateStr); 
  
  // The two static arrays for direct fetching
  const mealSlots = ["Breakfast", "MorningSnack", "Lunch", "EveningSnack", "Dinner"];
  const workoutTypes = ["Treadmill", "WeightTraining", "Elliptical", "WalkingOutside"];
  
  let totalDeficit = 0;
  let proteinHits = 0;
  let validDays = 0;
  let totalWorkoutMin = 0;
  let weeklyMealNarrative = "";

  targetDates.forEach(dateStr => {
    console.log(`🔍 Processing Date: ${dateStr}`);
    
    // 1. Fetch the Math
    let dailyMath = null;
    try {
      dailyMath = firestore.getDocument(`Daily_Summaries/${dateStr}`);
    } catch (e) {
      // Silent catch for missing future/empty days
    }

    const healthData = dailyMath?.fields?.health?.mapValue?.fields;
    const metrics = healthData?.metrics?.mapValue?.fields;
    const actualMealDate = healthData?.source_date?.stringValue || dateStr;

    // 2. Stitching Logic
    if (metrics) {
      const getNum = (val) => Number(val?.integerValue || val?.doubleValue || 0);
      
      const energy = getNum(metrics.net_energy);
      const protein = getNum(metrics.protein);
      const workoutMin = getNum(metrics.workout_min);

      // Circuit Breaker
      if (protein > 0 || workoutMin > 0) {
        validDays++;
        totalDeficit += energy;
        totalWorkoutMin += workoutMin;
        if (protein >= 150) proteinHits++;

        weeklyMealNarrative += `\n[${actualMealDate}] (Deficit: ${energy} | Protein: ${protein}g | Active: ${workoutMin} min)\n`;
        
        // 3. Point-Read Meals
        let mealsFound = 0;
        mealSlots.forEach(slot => {
          try {
            const mealDoc = firestore.getDocument(`DailyMealEntries/${actualMealDate}_${slot}`);
            if (mealDoc && mealDoc.fields) {
              const timeSlot = mealDoc.fields.meal_time_slot?.stringValue;
              const textEntry = mealDoc.fields.raw_entry_text?.stringValue;
              if (textEntry) {
                weeklyMealNarrative += `- Meal (${timeSlot}): ${textEntry}\n`;
                mealsFound++;
              }
            }
          } catch (e) { } // Silent catch
        });

        // 4. Point-Read Workouts
        let workoutsFound = 0;
        workoutTypes.forEach(type => {
          try {
            const workoutDoc = firestore.getDocument(`WorkoutSessions/${actualMealDate}_${type}`);
            if (workoutDoc && workoutDoc.fields) {
              const textEntry = workoutDoc.fields.raw_entry_text?.stringValue;
              if (textEntry) {
                weeklyMealNarrative += `- Workout (${type}): ${textEntry}\n`;
                workoutsFound++;
              }
            }
          } catch (e) { } // Silent catch
        });

        // Telemetry
        console.log(`   └─ ✅ DATA ALIGNED: Processing [${dateStr}] ➔ Source [${actualMealDate}]`);
        console.log(`      ├─ 🧮 Math Extracted : Deficit ${energy} kcal | Protein ${protein}g`);
        console.log(`      ├─ 🍽️ Meals Stitched: ${mealsFound} entries found`);
        console.log(`      └─ 🏋️ Workouts Stitched: ${workoutsFound} entries found`);

        if (mealsFound === 0 && workoutsFound === 0) {
            weeklyMealNarrative += `- No specific meal or workout details logged.\n`;
        }
        
      } else {
        console.log(`   └─ ⚠️ DATA GAP: Empty day detected (Ghost document).`);
        weeklyMealNarrative += `\n[${actualMealDate}] ⚠️ DATA GAP - No logs recorded.\n`;
      }
    } else {
      console.log(`   └─ ⚠️ DATA GAP: Missing document or metrics object.`);
      weeklyMealNarrative += `\n[${dateStr}] ⚠️ DATA GAP - No logs recorded.\n`;
    }
  });

  const finalStats = {
    daysLogged: validDays,
    totalDeficit: totalDeficit,
    proteinScore: proteinHits,
    workoutSummary: `Total: ${totalWorkoutMin} mins active over the week.`,
    weeklyMealNarrative: weeklyMealNarrative.trim()
  };

  console.log(`✅ Health Aggregation Complete. Valid Days: ${validDays}/${targetDates.length} | Net Deficit: ${totalDeficit} | Protein Target Hits: ${proteinHits}`);
  console.log(`Final Stats: \n${JSON.stringify(finalStats, null, 2)}`);
  return finalStats;
}

// ================================================================================================================= //

/**
 * Fetches the weekly market data, unwraps it, and squeeezes it into a token-efficient prompt string.
 */
function getWeeklyMarketContext(targetDateStr) {
  console.log(`📊 Fetching Weekly Market Context for: ${targetDateStr}...`);
  
  const firestore = getFirestore();
  let rawDoc = null;
  
  try {
    rawDoc = firestore.getDocument(`WeeklyMarketSnapshots/${targetDateStr}`);
  } catch (e) {
    console.warn(`   └─ ⚠️ API 404: No market summary found for ${targetDateStr}`);
    return `[WEEKLY MARKET SNAPSHOT] ⚠️ DATA GAP: No weekly market data available for ${targetDateStr}.`;
  }

  // 1. Instantly flatten the entire document
  const data = unwrapFirestore({ mapValue: { fields: rawDoc.fields } });
  
  if (!data || !data.portfolio) {
    return `[WEEKLY MARKET SNAPSHOT] ⚠️ DATA GAP: Data structure invalid for ${targetDateStr}.`;
  }

  // 2. Extract Benchmarks cleanly
  const nifty = data.benchmarks?.NIFTY_50?.change_pct || 0;
  const vix = data.benchmarks?.INDIA_VIX?.change_pct || 0;

  // 3. Sort and Squeeze the Portfolio Arrays
  const portfolio = data.portfolio;
  
  // Sort for absolute Gainers/Losers
  const sortedDesc = [...portfolio].sort((a, b) => b.change_pct - a.change_pct);
  const sortedAsc = [...portfolio].sort((a, b) => a.change_pct - b.change_pct);
  
  const topGainers = sortedDesc.filter(s => s.change_pct > 0).slice(0, 3);
  const topLosers = sortedAsc.filter(s => s.change_pct < 0).slice(0, 3);

  // Sort for Alpha Generators/Laggards
  const alphaDesc = [...portfolio].sort((a, b) => b.alpha_vs_nifty - a.alpha_vs_nifty);
  const alphaAsc = [...portfolio].sort((a, b) => a.alpha_vs_nifty - b.alpha_vs_nifty);
  
  const topAlpha = alphaDesc.filter(s => s.alpha_vs_nifty > 0).slice(0, 3);
  const bottomAlpha = alphaAsc.filter(s => s.alpha_vs_nifty < 0).slice(0, 3);

  // 4. Formatting Helper
  const formatStock = (s, key) => `${s.stock} (${s[key] > 0 ? '+' : ''}${s[key]}%)`;

  // 5. Assemble the Final Prompt String
  let narrative = `**[WEEKLY MARKET SNAPSHOT: ${targetDateStr}]**\n`;
  narrative += `**Benchmarks:** NIFTY_50 (${nifty > 0 ? '+' : ''}${nifty}%), INDIA_VIX (${vix > 0 ? '+' : ''}${vix}%)\n`;

  // 6. IDENTIFY OUTLIERS FOR NEWS TARGETING
  // Combine top gainers and losers tickers for Silo B search
  const outliers = [...new Set([
    ...topGainers.map(s => s.stock),
    ...topLosers.map(s => s.stock)
  ])];

  if (topGainers.length > 0) narrative += `**Top Gainers:** ${topGainers.map(s => formatStock(s, 'change_pct')).join(', ')}\n`;
  if (topLosers.length > 0) narrative += `**Top Losers:** ${topLosers.map(s => formatStock(s, 'change_pct')).join(', ')}\n`;
  if (topAlpha.length > 0) narrative += `**Alpha Leaders:** ${topAlpha.map(s => formatStock(s, 'alpha_vs_nifty')).join(', ')}\n`;
  if (bottomAlpha.length > 0) narrative += `**Alpha Laggards:** ${bottomAlpha.map(s => formatStock(s, 'alpha_vs_nifty')).join(', ')}\n`;

  console.log(`   └─ ✅ Context squeezed. Outliers identified: ${outliers.join(', ')}`);
  
  return {
    narrative: narrative.trim(),
    outliers: outliers 
  };
}

// ================================================================================================================= //

/**
 * WEEKLY ORCHESTRATOR: Synthesizes Silo A, B, and C into the final "Cold" report.
 * @param {String} targetDateStr - The Saturday/Sunday anchor date (YYYY-MM-DD).
 * @param {String} weeklyMarketContext - The stringified Silo A data from Firestore/ETL.
 * @param {Array} outliers - The Top/Bottom 3 tickers for targeted search.
 */
function getWeeklyIntelligence(targetDateStr, weeklyMarketContext, outliers = []) {

  // --- 🛰️ LOGGING VERIFICATION ---
  console.info("🔍 DEBUG: Outliers received in getWeeklyIntelligence:", JSON.stringify(outliers));
  console.info("🔍 DEBUG: weeklyMarketContext length:", weeklyMarketContext.length);
  
  console.info(`🧠 START: Synthesizing Weekly Intelligence for: ${targetDateStr}...`);
  
  // 1. Calculate the Week Range dynamically for the prompt
  const endDate = new Date(targetDateStr + "T00:00:00+05:30");
  const startDate = new Date(endDate.getTime() - (6 * 24 * 60 * 60 * 1000));
  
  const formatDate = (date) => Utilities.formatDate(date, JEANO_TIMEZONE, "MMMM d");
  const weekRange = `${formatDate(startDate)} - ${formatDate(endDate)}, 2026`;
  console.log(`📅 Processing Window: ${weekRange}`);

  // 2. FETCH SILO B: Corporate Records (Isolated Search)
  console.log("🛰️ Fetching Silo B: Corporate Records...");
  const corporateNews = getWeeklySiloData("CORPORATE_RECORDS", outliers, targetDateStr);

  // 3. FETCH SILO C: Macro & Regulatory (Isolated Search)
  console.log("🛰️ Fetching Silo C: Macro/Regulatory...");
  const macroNews = getWeeklySiloData("MACRO_REGULATORY", [], targetDateStr);

  // 4. THE RESEARCH PROMPT (The "Cold" Synthesis)
  const systemPrompt = `
    [IDENTITY]
    You are a Data Reporter. You are provided with three independent data silos covering ${weekRange}.

    [SECTION A: PERFORMANCE DATA]
    ${weeklyMarketContext}

    [SECTION B: CORPORATE RECORDS]
    ${corporateNews}

    [SECTION C: MACRO & REGULATORY RECORDS]
    ${macroNews}

    [TASK]
    Summarize the data into the following parts. 

    [STRICT OPERATING RULES]
    1. INDEPENDENCE: Treat each Section (A, B, C) as isolated. Do NOT link a news event from Section B to a price movement in Section A.
    2. NO CAUSALITY: Do not use verbs like "driven by," "due to," or "influenced." 
    3. NO INFERENCE: Do not add external knowledge or market sentiment. 
    4. DATA GAP: If a section is empty, output "INSUFFICIENT DATA".

    [OUTPUT STRUCTURE]
    PART 3: PORTFOLIO PERFORMANCE
    - Restate leaders and laggards from Section A only.

    PART 4: REPORTED DEVELOPMENTS
    - Restate Corporate Actions from Section B.
    - Restate Macro/Regulatory events from Section C.
    
    PART 5: THE SUNDAY DIRECTIVE
    - Provide a single metric based on the Health context.
`;
  
  try {
    console.log("📤 Sending Silos to Narrative Agent for final synthesis...");
    const researchResults = callJeanoAI(systemPrompt, "TEXT", false); // Logic synthesis doesn't need search again
    
    let finalContext = `**[MARKET INTELLIGENCE & RESEARCH]**\n`;
    finalContext += researchResults;

    console.info(`✅ SUCCESS: Intelligence compiled for week ending ${targetDateStr}.`);
    return finalContext;

  } catch (e) {
    console.error("❌ ERROR: Intelligence synthesis failed:", e.message);
    return "**[MARKET INTELLIGENCE]** ⚠️ Research engine unavailable.";
  }
}

// ================================================================================================================= //

function getLast7DaysFormatted(anchorDateStr) {
  const dates = [];
  
  // Force IST parsing so JavaScript doesn't accidentally shift the day based on server time
  const anchorDate = new Date(anchorDateStr + "T00:00:00+05:30");
  
  for (let i = 6; i >= 0; i--) {
    const pastDate = new Date(anchorDate.getTime() - (i * 24 * 60 * 60 * 1000));
    dates.push(Utilities.formatDate(pastDate, JEANO_TIMEZONE, "yyyy-MM-dd"));
  }
  
  return dates;
}

// ================================================================================================================= //

/**
 * Recursive helper to flatten Firestore's REST API JSON into standard JS objects.
 * This neutralizes mapValue, arrayValue, integerValue, etc.
 */
function unwrapFirestore(node) {
  if (!node) return null;
  if (node.stringValue !== undefined) return node.stringValue;
  if (node.integerValue !== undefined) return Number(node.integerValue);
  if (node.doubleValue !== undefined) return Number(node.doubleValue);
  if (node.booleanValue !== undefined) return node.booleanValue;
  
  // Handle nested Objects (Maps)
  if (node.mapValue && node.mapValue.fields) {
    const result = {};
    for (const key in node.mapValue.fields) {
      result[key] = unwrapFirestore(node.mapValue.fields[key]);
    }
    return result;
  }
  
  // Handle Arrays
  if (node.arrayValue && node.arrayValue.values) {
    return node.arrayValue.values.map(val => unwrapFirestore(val));
  }
  
  // Fallback for empty arrays or nulls
  return null; 
}

// ================================================================================================================= //

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
  

// ================================================================================================================= //

function debugJsonPayload() {
  const firestore = getFirestore();
  const doc = firestore.getDocument("Daily_Summaries/2026-04-09");
  
  // This will print the raw, unfiltered object exactly as Apps Script sees it
  console.log(JSON.stringify(doc, null, 2)); 
}