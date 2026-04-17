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

      // // ==========================================
      // // 🔍 TRANSPARENT DEBUG LOGGING 
      // // ==========================================
      // console.log(`[${stockName}]
      //   ↳ VOLATILITY: Move = ${(changePct * 100).toFixed(2)}% | Limit = ${mCapCat} | ${(threshold * 100).toFixed(1)}% | isVolatile = ${isVolatile}
      //   ↳ ACTION    : Action = '${pfAction}' | hasManualAction = ${hasManualAction} 
      //   ↳ BOUNDS    : Weight = ${(currentWeight * 100).toFixed(2)}% | Range = ${(rules.min * 100).toFixed(1)}% - ${(rules.max * 100).toFixed(1)}% | isOutOfBounds = ${isOutOfBounds}
      //   ↳ RESULT    : isActionable = ${isActionable} | triggersBrief = ${isActionable || isVolatile}`);
      // // ==========================================

    });

  // --- LOGGING: Verify Buckets ---
  console.info("📂 MCap Buckets Summary:");
  console.log(`   🔵 Large: ${mCapBuckets.largeCaps}`);
  console.log(`   🟡 Mid:   ${mCapBuckets.midCaps}`);
  console.log(`   🟢 Small: ${mCapBuckets.smallCaps}`);

  // --- LOGGING: Stock Lists ---
  // console.log(`All Stocks: ${allActiveStocks}`);
  // console.log(`Actionable Stocks: ${JSON.stringify(actionableSignals, null, 2)}`);
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
    // console.log(`💾 [FIRESTORE] Upsert successful for ${stockId}(${dateStr})`);
  } catch (e) {
    console.error(`❌ [FIRESTORE] Failed to save ${stockId}: ` + e.message);
  }
}

/**
 * Reads the Weekly Macros sheet and formats it into a Firestore-ready JSON payload.
 * Calculates Alpha vs Nifty on the fly.
 */
function weeklyMarketETL() {
  console.info("▶️ START: Weekly Delta Extraction...");

  const JEANO_TIMEZONE = "GMT+5:30";
  const props = PropertiesService.getScriptProperties();
  
  const marketSheetId = props.getProperty('MARKET_SHEET_ID');    
  if (!marketSheetId) {
    console.error("❌ ERROR: MARKET_SHEET_ID property is missing.");
    throw new Error("MARKET_SHEET_ID property is not set.");
  }

  console.log("📂 Opening Spreadsheet...");
  const ss = SpreadsheetApp.openById(marketSheetId);
  const macroSheet = ss.getSheetByName("Weekly Macros");
  
  if (!macroSheet) {
    console.error("❌ ERROR: 'Weekly Macros' tab not found.");
    throw new Error("Sheet 'Weekly Macros' not found.");
  }

  // 1. Fetch Raw Data
  const data = macroSheet.getDataRange().getValues();
  const headers = data[0];
  console.log(`📊 Fetched ${data.length - 1} rows of data.`);

  // 2. Extract and Format Date
  // Looks at column D (Index 3) for the date and formats it to IST
  const weekEndingRaw = headers[3]; 

  // Create a base Date object from the sheet (or fallback to today if unreadable)
  let baseDate;
  if (weekEndingRaw instanceof Date) {
    baseDate = new Date(weekEndingRaw.getTime());
  } else {
    baseDate = new Date(weekEndingRaw);
    if (isNaN(baseDate.getTime())) baseDate = new Date(); 
  }

  // --- THE FIX: Calculate the Saturday of that week ---
  const dayOfWeek = baseDate.getDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
  const daysUntilSaturday = dayOfWeek === 0 ? 0 : 6 - dayOfWeek;
  baseDate.setDate(baseDate.getDate() + daysUntilSaturday);

  // Format it perfectly for Firestore
  const weekEndingDate = Utilities.formatDate(baseDate, JEANO_TIMEZONE, "yyyy-MM-dd");
    
  console.info(`📅 Week Ending (Saturday) Date calculated: ${weekEndingDate}`);

  let payload = {
    week_ending: weekEndingDate,
    benchmarks: {},
    portfolio: []
  };

  let niftyChangePct = 0;
  let macroCount = 0;
  let portfolioCount = 0;

  // --- PASS 1: Identify the NIFTY_50 Benchmark ---
  // We must scan the sheet once to find the Nifty change before processing portfolio stocks, 
  // otherwise, we can't calculate their Alpha.
  console.log("🔍 Scanning for NIFTY_50 benchmark...");
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[1] === "NIFTY_50") {
      // Convert decimal (e.g., 0.0471) to percentage (4.71)
      niftyChangePct = row[5] * 100; 
      console.info(`🎯 NIFTY_50 Benchmark anchored at: ${niftyChangePct.toFixed(2)}%`);
      break;
    }
  }

  // --- PASS 2: Process Macros and Portfolio Stocks ---
  console.log("⚙️ Processing individual rows...");
  
  // Helper function to format Google Sheets decimals into clean percentages
  const formatPct = (val) => parseFloat((val * 100).toFixed(2));

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const stock = row[1];
    
    if (!stock) continue; // Skip empty rows

    const shares = row[2];
    const currentPrice = row[3];
    const prevPrice = row[4];
    const changeDecimal = row[5];
    const high = row[6];
    const low = row[7];
    const mcapCategory = row[8];

    // ROUTE A: Benchmark/Macro Index 
    // Identified by having a hyphen '-' or blank in the Shares/MCap columns
    if (shares === "-" || shares === "" || mcapCategory === "-" || mcapCategory === "") {
      payload.benchmarks[stock] = {
        close: currentPrice,
        change_pct: formatPct(changeDecimal)
      };
      macroCount++;
    } 
    // ROUTE B: Portfolio Stock
    else {
      const stockChangePct = formatPct(changeDecimal);
      const alpha = parseFloat((stockChangePct - niftyChangePct).toFixed(2));

      payload.portfolio.push({
        stock: stock,
        mcap_category: mcapCategory,
        shares: shares,
        price_current: currentPrice,
        price_previous: prevPrice,
        change_pct: stockChangePct,
        high: high,
        low: low,
        alpha_vs_nifty50: alpha
      });
      portfolioCount++;
    }
  }

  console.info(`✅ Extraction Complete. Payload generated for ${macroCount} Macros and ${portfolioCount} Portfolio Stocks.`);

  // --- 3. FIRESTORE ARCHIVE ---
  console.info(`🔥 Preparing to archive Snapshot to Firestore [WeeklyMarketSnapshots/${weekEndingDate}]...`);

  try {
    // Call your centralized connection function
    const firestore = getFirestore(); 
    const documentPath = `WeeklyMarketSnapshots/${weekEndingDate}`;
    
    console.log(`📝 Writing document to path: [${documentPath}]...`);
    firestore.updateDocument(documentPath, payload);
    
    console.info(`✅ SUCCESS: Weekly Snapshot archived securely in Firestore.`);
  } catch (error) {
    console.error(`❌ FIRESTORE WRITE FAILED:`, error);
    throw new Error(`Failed to save weekly snapshot: ${error.message}`);
  }

  return payload;
}

