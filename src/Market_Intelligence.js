/**
 * JEANO: Market Intelligence Engine
 * This version uses the Two-Phase pattern to stop hallucinations.
 */

function getMarketIntelligence(etlData) {
  console.info("🔍 Phase 1: Researching Live Markets...");
  
  const now = new Date();
  const today = Utilities.formatDate(now, JEANO_TIMEZONE, "yyyy-MM-dd");
  const yesterday = Utilities.formatDate(new Date(now.getTime() - (24 * 60 * 60 * 1000)), JEANO_TIMEZONE, "yyyy-MM-dd");

  // --- NEW BLOCK: Compute internal metrics for Firestore ---
  let counts = { buy: 0, sell: 0, hold: 0 };
  let topMover = { stock: "None", change: 0 };
  
  (etlData.signals || []).forEach(sig => {
    // 1. Tally Signals
    const act = (sig.action || "").toLowerCase();
    if (act.includes("buy") || act.includes("average")) counts.buy++;
    else if (act.includes("book") || act.includes("sell") || act.includes("cut")) counts.sell++;
    else counts.hold++;

    // 2. Find Top Mover
    if (Math.abs(sig.change) > Math.abs(topMover.change)) {
      topMover = sig;
    }
  });

  // 3. Determine Baseline Sentiment from Macro (Nifty50)
  const niftyMacro = etlData.macro && etlData.macro["nifty50"];
  const baselineSentiment = (niftyMacro && parseFloat(niftyMacro.change) < 0) ? "Bearish" : "Bullish";
  const niftyClose = niftyMacro ? niftyMacro.close : "N/A";

  // --- PHASE 1: THE RESEARCH (Text Response with Search ON) ---
  const researchPrompt = `
    URGENT: Market Data Request for Morning Briefing.
    
    1. LIVE MORNING SETUP (Current Session ${today}):
       - Search for "GIFT Nifty Live Price" and "GIFT Nifty opening points gap up or down (against Nifty close ${yesterday})".
       - Search for "Nikkei 225 Live" and "Hang Seng Live Index" for today's % change.

    2. INSTITUTIONAL DATA (Previous Session ${yesterday}):
       - Search for "FII DII activity India ${yesterday}". 
       - Find the "FII Net Cash" (Buy/Sell value in Crores).
       - Find the "FII Long-Short Ratio" or "FII derivative positioning" from the ${yesterday} close.

    INSTRUCTION: 
    - Report the values clearly in your own words. 
    - IMPORTANT: Convert all times to IST (India Standard Time).
    - For Nikkei and Hang Seng, if the market is open, provide the current live % change.
    - For FII data, ensure you are looking at the final figures from the most recently completed trading session (${yesterday}).
    - Do NOT copy-paste verbatim. If a specific data point (like Long-Short ratio) is not found, state "Data not yet updated" instead of guessing.
  `;

  const rawResearch = callJeanoAI(researchPrompt, "TEXT", true);
  console.log("rawResearch length: " + rawResearch.length);

  // --- PHASE 2: THE COMPILER (JSON Response with Search OFF) ---
  const compilerPrompt = `
    You are a DATA EXTRACTION ENGINE. Your goal is to map RAW RESEARCH into a structured JSON format.

    TASK:
    Extract values ONLY if they are explicitly stated in the RAW RESEARCH. 
    If the research mentions "Data not yet updated" or "Not found", you MUST use "N/A".

    STRICT SCHEMA RULES:
    1. "gift_nifty": Look for the price and the points/percentage change. Capture the "date & time" if mentioned (e.g., 31 Mar 08:10 AM).
    2. "nikkei" & "hang_seng": Capture the current percentage change for the morning session.
    3. "fii_cash": This refers to the Net Buy/Sell value in Crores from the PREVIOUS session.
    4. "fii_ls_ratio": This is the FII Long-Short ratio or derivative positioning percentage.

    RAW RESEARCH:
    ${rawResearch}

    JSON SCHEMA (Respond ONLY with this structure):
    {
      "gift_nifty": { "value": "string", "change": "string", "time": "string" },
      "nikkei": { "change": "string" },
      "hang_seng": { "change": "string" },
      "fii_cash": { "value": "string", "direction": "string" },
      "fii_ls_ratio": { "value": "string", "sentiment": "string" }
    }
  `;

  const compilerRaw = callJeanoAI(compilerPrompt, "JSON", false);
  const cleanJson = sanitizeJson(compilerRaw);

  let marketDataJson;
  try {
    marketDataJson = JSON.parse(cleanJson);
  } catch (e) {
    console.error("Sanitized JSON length:", cleanJson.length);
    throw new Error("Compiler output not valid JSON after sanitization.\n" + cleanJson);
  }

  console.log("marketData: " + JSON.stringify(marketDataJson));
  enforceExtraction(marketDataJson, rawResearch);
 
  const dateStr = Utilities.formatDate(new Date(), JEANO_TIMEZONE, "yyyy-MM-dd");
  const briefDateStr = Utilities.formatDate(new Date(), JEANO_TIMEZONE, "dd MMM yyyy"); // Formats as "17 Mar 2026"

  // --- NEW BLOCK: Construct the precise Firestore object ---
  const firestoreMarketObject = {
    source_date: dateStr,
    sentiment: baselineSentiment,
    signals: counts,
    top_mover: topMover.stock !== "None" ? `${topMover.stock} (${(topMover.change * 100).toFixed(2)}%)` : "None",
    indices: {
      "Nifty50": niftyClose.toString(),
      "GIFTNifty": marketDataJson.gift_nifty.value || "N/A"
    }
  };

  // --- INLINE FIRESTORE UPSERT ---
  const payload = {
    user_id: "Vijay",
    brief_date: briefDateStr,
    market: firestoreMarketObject
  };

  try {
    const firestore = getFirestore();
    const documentPath = `Daily_Summaries/${dateStr}`;

    // 1. READ: Fetch the existing document (created by Health Agent)
    let existingDoc = null;
    try {
      existingDoc = firestore.getDocument(documentPath) || {};
    } catch (fetchError) {
      console.warn(`⚠️ Could not fetch existing doc, creating new one: ${fetchError.message}`);
    }

    // 2. MODIFY: Extract the actual data from the raw response
    // Most Apps Script Firestore libraries store the clean data in .obj or .fields
    let dataToSave = (existingDoc && existingDoc.obj) ? existingDoc.obj : {};

    // 2. MODIFY: Attach the root fields and the new market object
    dataToSave.user_id = "Vijay";
    dataToSave.brief_date = briefDateStr;
    dataToSave.market = firestoreMarketObject; 
    // Notice we do NOT touch existingDoc.health, so it stays perfectly intact.

    // 3. WRITE: Send the fully combined object back to Firestore
    firestore.updateDocument(documentPath, dataToSave);
    console.info(`💾 [MARKET DATA] Daily summary successfully merged into: ${documentPath}`);

  } catch (e) {
    console.error(`❌ [MARKET DATA] Failed to update Daily Summary: ` + e.message);
  }

  // --- FINAL RETURN ---
  // We return a comprehensive object for the Orchestrator
  return JSON.stringify({
    stats: marketDataJson,          // For the markdown table
    research: rawResearch,          // For the narrative synthesis
  });  
}

// --- 🌊 MARKET NEWS: THE NESTED WEB SEARCH ---
function getMarketNews(input) {
  console.info("🌊 Starting Waterfall-search for market news...");

  // --- THE FIX: Smart Detection ---
  // If 'input' has a property called 'mCapBuckets', use it. 
  // Otherwise, assume 'input' IS the buckets.
  const buckets = (input && input.mCapBuckets) ? input.mCapBuckets : input;

  // --- SAFETY CHECK: If we still don't have largeCaps, something is wrong with the ETL return ---
  if (!buckets || !buckets.largeCaps) {
    console.error("❌ Critical: getMarketNews received invalid data.", input);
    return "NEWS_UNAVAILABLE (Data structure mismatch)";
  }

  let totalNewsCount = 0;
  let finalNewsReport = "";

  // 1. Macro (Free Pass)
  const macroRes = searchNewsBucket("Macro", ["SEBI", "RBI", "NSE", "BSE"]);
  finalNewsReport += `**Macro & Regulatory:**\n${macroRes.text}\n\n`;

  // 2. Large Caps (using the 'buckets' variable we defined above)
  if (buckets.largeCaps.length > 0) {
    const res = searchNewsBucket("Large Caps", buckets.largeCaps);
    if (res.count > 0) {
      finalNewsReport += `**Large Caps:**\n${res.text}\n\n`;
      totalNewsCount += res.count;
    }
  }

  // 3. Mid Caps (Quota check)
  if (totalNewsCount < 5 && buckets.midCaps.length > 0) {
    const res = searchNewsBucket("Mid Caps", buckets.midCaps);
    if (res.count > 0) {
      finalNewsReport += `**Mid Caps:**\n${res.text}\n\n`;
      totalNewsCount += res.count;
    }
  }

  // 4. Small Caps (Quota check)
  if (totalNewsCount < 5 && buckets.smallCaps.length > 0) {
    const res = searchNewsBucket("Small Caps", buckets.smallCaps);
    if (res.count > 0) {
      finalNewsReport += `**Small Caps:**\n${res.text}\n\n`;
      totalNewsCount += res.count;
    }
  }

  return finalNewsReport || "No significant news found for portfolio stocks.";
}


// --- 🔎 THE AI SEARCH ENGINE ---
function searchNewsBucket(bucketName, targetStocks) {
  if (!targetStocks || targetStocks.length === 0) return { text: "", count: 0 };

  const stockSearchString = targetStocks.join(", ");
  const now = new Date();
  const today = Utilities.formatDate(now, JEANO_TIMEZONE, "yyyy-MM-dd");
  const yesterday = Utilities.formatDate(new Date(now.getTime() - (24 * 60 * 60 * 1000)), JEANO_TIMEZONE, "yyyy-MM-dd");

  const newsPrompt = `
    URGENT: I need specific corporate news covering ${yesterday} and early morning ${today}.
    Search the web for: "Stock market news ${stockSearchString} India" and "Corporate announcements ${stockSearchString} last 24 hours".

    TASK:
    Review the news you found for this exact list of tickers/entities: [${stockSearchString}].
    Extract any specific catalysts (e.g., earnings, block deals, analyst downgrades, regulatory changes).

    CRITICAL RULES:
    1. Rewrite the events strictly in your own words. Do NOT quote verbatim.
    2. ONLY output news for the requested entities.
    3. Keep summaries concise (1-2 sentences per entity).
    4. If NONE of the entities have news, output exactly: "NO_NEWS".
  `;

  // Explicitly passing "TEXT" and true to enable the safe search
  const newsResearch = callJeanoAI(newsPrompt, "TEXT", true);
  
  if (newsResearch.trim() === "NO_NEWS" || newsResearch.includes("NO_NEWS")) {
    return { text: "No significant corporate actions found.", count: 0 };
  }

  // Heuristic: count the number of lines that actually contain text (proxy for number of news items)
  const lines = newsResearch.split('\n').filter(line => line.trim().length > 10);
  const itemCount = lines.length;

  return { text: newsResearch, count: itemCount };
}

function getPortfolioNews(targetStocks) {
  if (!targetStocks || targetStocks.length === 0) {
    return "No actionable stocks flagged for news targeting today.";
  }

  console.info(`📰 Phase 3: Targeted News Strike for ${targetStocks.length} tickers...`);

  const stockSearchString = targetStocks.join(", ");
  const now = new Date();
  const today = Utilities.formatDate(now, JEANO_TIMEZONE, "yyyy-MM-dd");
  const yesterday = Utilities.formatDate(new Date(now.getTime() - (24 * 60 * 60 * 1000)), JEANO_TIMEZONE, "yyyy-MM-dd");

  const newsPrompt = `
    URGENT: I need specific corporate news covering ${yesterday} and early morning ${today}.
    Search the web for: "Stock market news ${stockSearchString} India" and "Corporate announcements ${stockSearchString} last 24 hours".

    TASK:
    Review the news you found for this exact list of tickers: [${stockSearchString}].
    Extract any specific catalysts (e.g., earnings, block deals, analyst downgrades, management changes, order wins).

    CRITICAL RULES:
    1. Rewrite the events strictly in your own words. Do NOT quote articles verbatim.
    2. ONLY output news for the requested tickers.
    3. Keep summaries concise (1-2 sentences per stock).
    4. If NONE of the tickers have news, output exactly: "No significant corporate actions found for targeted stocks today."
  `;

  // Explicitly passing "TEXT" and true to enable the safe search
  const newsResearch = callJeanoAI(newsPrompt, "TEXT", true);
  return newsResearch;
}

function sanitizeJson(text) {
  return text
    // remove markdown fences
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    // remove BOM + zero-width chars
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    // normalize non-breaking spaces
    .replace(/\u00A0/g, " ")
    .trim();
}

function enforceExtraction(stats, research) {
  const r = research.toLowerCase().replace(/,/g, ""); // Strip commas from research once

  for (const [sectionKey, section] of Object.entries(stats)) {
    for (const [key, v] of Object.entries(section)) {
      // 1. Skip N/A and Sentiment/Bias fields (which are pure text)
      if (v === "N/A" || key === "time" || key === "sentiment" || key === "direction") continue;

      // 2. Extract only the digits and decimals
      const numMatch = v.toString().match(/[\d.]+/);
      
      if (numMatch) {
        const num = numMatch[0];
        // 3. Check if the raw numbers exist in the research
        if (!r.includes(num)) {
          throw new Error(`Hallucination Check Failed: ${sectionKey}.${key} (${num}) not found in research.`);
        }
      }
    }
  }
}

