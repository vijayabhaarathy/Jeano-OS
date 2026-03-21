/**
 * JEANO: Market Intelligence Engine
 * This version uses the Two-Phase pattern to stop hallucinations.
 */

function getMarketIntelligence(etlData) {
  console.info("🔍 Phase 1: Researching Live Markets...");
  
  const stockContext = etlData.news_search_list.join(", ");
  const today = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");

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
    URGENT: I need real-time data for ${today}. 
    Search the web for:
    1. "GIFT Nifty Live Price Today" - find the exact number reported around 8:15 AM IST.
    2. "Nifty 50 Previous Close" - find the official close at 3:30 PM.
    3. "Nikkei 225 Live" and "Hang Seng Live" - get current % change.
    4. "FII DII Activity India ${today}" - find "FII Net Cash" and "FII Long Short Ratio".
    5. News in last 24 hours for: ${stockContext}.

    INSTRUCTION: Do not summarize. Copy-paste the relevant data snippets verbatim into your response so my parser can find them. If you cannot find data at a specific time, provide the LATEST available price and the time it was recorded.
  `;

  const rawResearch = callJeanoAI(researchPrompt, { search: true, temperature: 0.3 });
  console.log("rawResearch length: " + rawResearch.length);

  // --- PHASE 2: THE COMPILER (JSON Response with Search OFF) ---
  const compilerPrompt = `
    You are a STRICT DATA EXTRACTOR, not an analyst.

    TASK:
    Extract values ONLY if they are EXPLICITLY PRESENT in the RAW RESEARCH text.
    Do NOT infer, estimate, normalize, or complete missing information.

    HARD RULES:
    1. You may ONLY copy literal values found verbatim or clearly stated in RAW RESEARCH.
    2. If a value is NOT explicitly present, output "N/A".
    3. Do NOT use prior knowledge, training data, or typical market values.
    4. Do NOT guess, infer, or calculate.
    5. Output MUST match the schema exactly.
    6. Respond ONLY with valid JSON. No explanations.

    RAW RESEARCH:
    ${rawResearch}

    SCHEMA (all fields required):
    {
      "gift_nifty": { "value": "string", "change": "string" },
      "nikkei": { "value": "string", "change": "string" },
      "fii_cash": { "value": "string", "status": "string" },
      "fii_ls_ratio": { "value": "string", "bias": "string" }
    }
  `;

  const compilerRaw = callJeanoAI(compilerPrompt, { search: false, temperature: 0 });
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
  const r = research.toLowerCase();

  for (const section of Object.values(stats)) {
    for (const v of Object.values(section)) {
      if (v !== "N/A" && !r.includes(v.toLowerCase())) {
        throw new Error("Hallucinated value detected: " + v);
      }
    }
  }
}


// /**
//  * JEANO: Market Intelligence Engine
//  * Consolidates Sheet Macros with Live Web Search
//  */
// function getMarketIntelligence(etlData) {
//   console.info("🔍 Initializing Market Intelligence Scan...");

//   const stockContext = etlData.news_search_list.join(", ");
//   const today = new Date();

//   // 2. Build the Multi-Source Search & Synthesis Prompt
//   const prompt = `
//     You are Jeano's Stock Market SME. Provide a Morning Brief for ${today}.
    
//     [INTERNAL MACRO BASELINE]: ${JSON.stringify(etlData.macro)}
    
//     [EXTERNAL SEARCH REQUIREMENTS]
//     1. GIFT Nifty Temporal Delta: 
//        - Point A: Price at 3:30 PM IST (Previous Session Close).
//        - Point B: LIVE Price as of 8:15 AM IST Today.
//        - Calculation: Delta (B - A) in points and %.
//     2. Global/Asian Pulse: 
//        - Status & Trend for Shanghai Composite, Nikkei 225, and Hang Seng.
//        - Recap of US Market (Dow/Nasdaq) closing sentiment from Friday/last night.
//     3. Institutional Flow: Latest FII Net Cash activity and Index Future Long:Short ratio.
//     4. Macro Audit: Provide 24h live updates for BRENT OIL, BITCOIN, and USDINR only if they differ by >1% from the Internal Baseline.
//     5. 24h Ticker News: Scan for "New Orders" or "Headlines" for: ${stockContext}.

//     [STRICT OUTPUT STRUCTURE]
//     SECTION 1: THE DATA TABLE
//     - Render a Markdown table including: GIFT Nifty Delta, Global Indices (% Change), FII Data, and audited Macro Commodities.

//     SECTION 2: THE NARRATIVE
//     - Sentiment: Start with a clear "Opening Outlook" based on Global + GIFT Nifty data.
//     - Global Drivers: Explain the "Why" behind the US/Asia trends (e.g., policy shifts, earnings).
//     - Ticker Intelligence: Summarize news for your holdings.

//     Note: Be mathematically precise. If the GIFT Nifty gap is > 100 points, do not call it "flat."
//   `;

//   return callJeanoAI(prompt);
// }

// /**
//  * JEANO: Market Intelligence Engine (V2 - Two-Part Brief)
//  */
// function getMarketIntelligence(etlData) {
//   console.info("🔍 Initializing Market Intelligence Scan...");
//   const stockContext = etlData.news_search_list.join(", ");
//   var today = new Date();
  
//   const systemPrompt = `
//     You are Jeano's Market SME. 
//     DATE: ${today}
    
//     [LOGIC GATES]
//     - Point A: GIFT Nifty Price at 3:30 PM IST on previous market session/day.
//     - Point B: GIFT Nifty LIVE Price at 7:30 AM IST Today.
//     - Today's Gap = (Point B - Point A) points.

//     [TASK]
//     Produce a TWO-PART brief.

//     PART 1: THE DATA TABLE
//     - Render a Markdown table with these columns: Index | Value | Change/Status.
//     - Rows: GIFT Nifty (Live vs Prev 3:30pm), Gap (Pts & %), Nikkei 225, Hang Seng, KOSPI, FII Cash Net, FII Long:Short.

//     PART 2: THE NARRATIVE
//     - Sentiment: Start with a clear bullish/bearish call based on the Gap.
//     - Asian Context: Explain the Nikkei/KOSPI moves (e.g., Takaichi win stimulus).
//     - Stock News: Search for "New Orders" or "Headlines" for these stocks: ${stockContext}.

//     INTEGRATION RULES:
//     - Compare the market trends of US, Asia and give a overall trend with a level of certainity.
//     - If my Sheet Macro data (like OIL or BTC) is outdated, provide the 24h live update.
//   `;

//   return callJeanoAI(systemPrompt);
// }