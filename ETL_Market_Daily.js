/**
 * MARKET AGENT: Daily Selective ETL with Verbose Logging
 */
function dailyMarketETL() {
  const startTime = new Date();
  console.info("🚀 [START] dailyMarketETL initialized at " + startTime);

  try {
    const props = PropertiesService.getScriptProperties();
    const marketSheetId = props.getProperty('MARKET_SHEET_ID');
    
    // --- BLOCK 1: Spreadsheet Connection ---
    console.log("🔗 Connecting to Spreadsheet ID: " + marketSheetId);
    const ss = SpreadsheetApp.openById(marketSheetId);
    console.info("✅ SUCCESS: Connected to '" + ss.getName() + "'");

    // --- BLOCK 2: Macro Data Extraction ---
    console.log("📊 Accessing 'Macros' tab...");
    const macroSheet = ss.getSheetByName("Macros");
    if (!macroSheet) throw new Error("Macros tab missing");
    
    const macroData = macroSheet.getRange(2, 1, 6, 3).getValues();
    const globalContext = formatMacros(macroData);
    console.info("✅ SUCCESS: Extracted Macro context for " + Object.keys(globalContext).length + " indices");

    // --- BLOCK 3: HARVEST BUCKET RULES (Macros Sheet) ---
    const macroHeaders = macroSheet.getRange(1, 5, 1, 6).getValues()[0]; // E1:J1
    const macroData_PF = macroSheet.getRange(2, 5, 3, 6).getValues(); // E2:J4

    const bucketRules = {};
    macroData_PF.forEach(row => {
      const bucketName = row[0].toString().toLowerCase(); // Column E: Bucket
      bucketRules[bucketName] = {
        min: parseFloat(row[3]) || 0, // Column H: Min Weightage
        max: parseFloat(row[4]) || 0  // Column I: Max Weightage
      };
    });
    console.info("✅ SUCCESS: Portfolio Category Rules Loaded:", bucketRules);

    // --- BLOCK 3: Portfolio Processing ---
    console.log("📁 Accessing 'Investments Summary' tab...");
    const portSheet = ss.getSheetByName("Investments Summary");
    const lastRow = portSheet.getLastRow();
    console.log("📝 Total rows found: " + lastRow);

    const fullRange = portSheet.getRange(3, 1, 1, portSheet.getLastColumn()).getValues(); 
    const headers = fullRange[0]; 

    // 26Feb: Log all headers to find exact string matches
    // console.log("🔍 Full Headers Found: " + headers.join(" | "));

    const col = {
      stock: headers.indexOf("Stock"), 
      pfCategory: headers.indexOf("Portfolio Category"),
      pfAction: headers.indexOf("Portfolio Action"),
      changePct: headers.indexOf("Change Percent"),
      mCapCat: headers.indexOf("MCap Category (Listing)"),
      currentWeight: headers.indexOf("% of Total Holding") 
    };

    // Defensive check - if any are -1, the script will stop here with a clear error
    Object.keys(col).forEach(key => {
      if (col[key] === -1) {
        throw new Error(`❌ Header Mapping Failed: '${key}' not found. Check exact spelling.`);
      }
    });
    
    const rows = portSheet.getRange(4, 1, lastRow - 2, headers.length).getValues();
    const actionableSignals = [];
    const allActiveStocks = [];
    let volatileCount = 0;
    let processedCount = 0;

    console.log("⚙️ Starting Row-by-Row Compound Filter...");

    const mCapBuckets = { largeCaps: [], midCaps: [], smallCaps: [] };    
    rows.forEach((row, index) => {
      const stockName = row[col.stock];

      if (!stockName || row[col.pfCategory] === "04 Exited") return;

      const currentWeight = parseFloat(row[col.currentWeight]) || 0;
      const bucket = (row[col.pfCategory] || "").toString().toLowerCase();
      const rules = bucketRules[bucket] || { min: 0, max: 1 }; // Fallback

      processedCount++;
      const pfAction = row[col.pfAction];
      const changePct = parseFloat(row[col.changePct]) || 0; // Forced cast to float for Math.abs comparison
      const mCapCat = row[col.mCapCat];
      
      // LOGIC 1: Volatility Check
      const threshold = getVolatilityDNA(mCapCat);
      const isVolatile = Math.abs(changePct) >= threshold;

      // LOGIC 2: Allocation Check (Actionable if OUTSIDE Min/Max range AND Manual Action exists)
      const hasManualAction = row[col.pfAction] && row[col.pfAction].toString().toLowerCase() !== "hold";
      const isOutOfBounds = (currentWeight < rules.min) || (currentWeight > rules.max);
      const isActionable = hasManualAction && isOutOfBounds;

      // if (isVolatile) volatileCount++;        
      const stockObj = { stock: stockName, holding: currentWeight,  change: changePct, action: pfAction, mcap: mCapCat };

      if (isActionable || isVolatile) {
        actionableSignals.push({
          stockObj,
          triggerReason: isActionable ? `Rebalance (${(currentWeight*100).toFixed(1)}% vs ${rules.min*100}-${rules.max*100}%)` : "Volatility"
        });
      }   

      // Check for MarketCaps
      const cat = (mCapCat || "").toLowerCase();
      if (cat.includes("large")) mCapBuckets.largeCaps.push(stockName);
      else if (cat.includes("mid")) mCapBuckets.midCaps.push(stockName);
      else if (cat.includes("small") || cat.includes("micro")) mCapBuckets.smallCaps.push(stockName);

      allActiveStocks.push(stockName);
      saveToSnapshots(stockName, stockObj);

      // ==========================================
      // 🔍 TRANSPARENT DEBUG LOGGING 
      // ==========================================
      console.log(`[${stockName}]
        ↳ VOLATILITY: Move = ${(changePct * 100).toFixed(2)}% | Limit = ${mCapCat} | ${(threshold * 100).toFixed(1)}% | isVolatile = ${isVolatile}
        ↳ ACTION    : Action = '${pfAction}' | hasManualAction = ${hasManualAction} 
        ↳ BOUNDS    : Weight = ${(currentWeight * 100).toFixed(2)}% | Range = ${(rules.min * 100).toFixed(1)}% - ${(rules.max * 100).toFixed(1)}% | isOutOfBounds = ${isOutOfBounds}
        ↳ RESULT    : isActionable = ${isActionable} | triggersBrief = ${isActionable || isVolatile}`);
      // ==========================================

    });

  // --- LOGGING: Verify Buckets ---
  console.info("📂 MCap Buckets Summary:");
  console.log(`   🔵 Large: ${mCapBuckets.largeCaps}`);
  console.log(`   🟡 Mid:   ${mCapBuckets.midCaps}`);
  console.log(`   🟢 Small: ${mCapBuckets.smallCaps}`);

  // --- LOGGING: Stock Lists ---
  console.log(`All Stocks: ${allActiveStocks}`);
  console.log(`Actionable Stocks: ${JSON.stringify(actionableSignals, null, 2)}`);
  console.info(`✅ SUCCESS: Processed ${processedCount} active stocks.`);

  // --- BLOCK 4: Search List Preparation ---
  console.log("🔍 Determining Gemini News strategy...");
  const searchList = actionableSignals.length < 3 ? allActiveStocks : actionableSignals.map(s => s.stock);
  const strategy = actionableSignals.length < 3 ? "WIDE NET" : "TARGETED";
  console.info(`📢 STRATEGY: Using ${strategy} for ${searchList.length} stocks.`);

  const endTime = new Date();
  const duration = (endTime - startTime) / 1000;
  console.info(`🏁 [FINISH] ETL completed in ${duration}s. Found ${actionableSignals.length} signals.`);

  return {
    macro: globalContext,
    signals: actionableSignals,
    news_search_list: searchList,
    mCapBuckets: mCapBuckets
  };

  } catch (e) {
    console.error("❌ CRITICAL FAILURE in dailyMarketETL: " + e.message);
    console.error("Stack Trace: " + e.stack);
    throw e; // Re-throw to ensure the Orchestrator knows it failed
  }
}

/**
 * Helper: Formats Macro Tab data into a clean Object
 */
function formatMacros(data) {
  const macros = {};
  data.forEach(row => {
    if (row[0] && row[1] !== "#N/A") {
      macros[row[0].toString().toLowerCase()] = {
        close: row[1],
        change: row[2]
      };
    }
  });
  return macros;
}

/**
 * Helper: Saves daily record to MarketSnapshots
 */
function saveToSnapshots(stockId, data) {
  const SNAPSHOT_COLLECTION = "MarketSnapshots"; // Defined locally for safety
  const props = PropertiesService.getScriptProperties();
  const firestore = FirestoreApp.getFirestore(
    props.getProperty('CLIENT_EMAIL'),
    props.getProperty('PRIVATE_KEY').replace(/\\n/g, '\n'),
    props.getProperty('PROJECT_ID')
  );
  
  // const dateStr = Utilities.formatDate(new Date(), "GMT+5:30", "yyyy-MM-dd");
  const dateStr = Utilities.formatDate(new Date(), JEANO_TIMEZONE, "yyyy-MM-dd");
  const docId = `${slugify(stockId)}_${dateStr}`;
  const path = `${SNAPSHOT_COLLECTION}/${docId}`;

  try {
    // setDocument will create if new, or overwrite if exists.
    firestore.updateDocument(path, data);
    console.log(`💾 [FIRESTORE] Upsert successful for ${stockId}(${dateStr})`);
  } catch (e) {
    console.error(`❌ [FIRESTORE] Failed to save ${stockId}: ` + e.message);
  }
}