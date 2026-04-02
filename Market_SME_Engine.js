/**
 * MARKET AGENT: Portfolio Master Sync
 * Establishes the Baseline "Digital Twin" in Firestore
 */

const MASTER_COLLECTION = "Portfolio_Master";

/**
 * MARKET AGENT: Master Baseline Sync
 * Refreshes the 53-column "State" for all stocks in Firestore.
 */
function syncPortfolioMaster() {
  const startTime = new Date();
  console.info("🚀 [START] syncPortfolioMaster initialized at " + startTime);

  try {
    const props = PropertiesService.getScriptProperties();
    const marketSheetId = props.getProperty('MARKET_SHEET_ID');
    
    // --- BLOCK 1: Connection & Extraction ---
    console.log("🔗 Connecting to Spreadsheet ID: " + marketSheetId);
    const ss = SpreadsheetApp.openById(marketSheetId);
    const sheet = ss.getSheetByName("Investments Summary"); 
    if (!sheet) throw new Error("Tab 'Investments Summary' not found.");

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    // B3:End (Starting row 3, col 2)
    const fullRange = sheet.getRange(3, 2, lastRow - 2, lastCol - 1).getValues();
    const [rawHeaders, ...rows] = fullRange;
    
    const keys = rawHeaders.map(header => slugify(header));
    console.info(`✅ SUCCESS: Extracted ${rows.length} stocks and ${keys.length} headers.`);

    // --- BLOCK 2: Auth & Firestore Setup ---
    console.log("🔐 Preparing Firestore credentials...");
    let privateKey = props.getProperty('PRIVATE_KEY');
    if (privateKey && privateKey.indexOf('\\n') !== -1) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    const firestore = FirestoreApp.getFirestore(
      props.getProperty('CLIENT_EMAIL'),
      privateKey,
      props.getProperty('PROJECT_ID')
    );

    // --- BLOCK 3: Transform & Load ---
    console.log("⚙️ Starting Batch Upsert to Portfolio_Master...");
    let successCount = 0;

    rows.forEach((row, index) => {
      const stockName = row[0];
      if (!stockName) return;

      const stockData = {};
      row.forEach((cell, i) => {
        stockData[keys[i]] = cell;
      });

      const headers = portSheet.getRange(3, 2, 1, portSheet.getLastColumn() - 1).getValues()[0];
      const mCapIndex = headers.indexOf("MCap Category (Listing)"); // Ensure this string matches your header exactly
      const mCapCategory = row[mCapIndex] ? row[mCapIndex].toString().toLowerCase() : "";
      stockData["volatility_threshold"] = getVolatilityDNA(mCapCategory);
      stockData["last_full_sync"] = new Date(); // The processing timestamp
      stockData["sync_session_id"] = startTime.getTime(); // Unique ID for this run

      // ... inside the rows.forEach loop
      const docId = slugify(row[0].toString());
      const path = `Portfolio_Master/${docId}`;

      try {
        // 1. We switch to createDocument but handle the "Already Exists" manually
        // This sends data in the BODY, avoiding the URL length limit.
        firestore.createDocument(path, stockData);
        successCount++;
      } catch (e) {
        if (e.message.includes("already exists")) {
          // 2. If it exists, use updateDocument WITHOUT the mask
          // This performs a clean overwrite without appending field names to the URL
          firestore.updateDocument(path, stockData); 
          successCount++;
        } else {
          console.error(`❌ FAILED ${stockName}: ${e.message}`);
        }
      }
    });

    const endTime = new Date();
    const duration = (endTime - startTime) / 1000;
    console.info(`🏁 [FINISH] Master Sync Complete. Duration: ${duration}s. Records: ${successCount}/${rows.length}`);

  } catch (e) {
    console.error("❌ CRITICAL FAILURE in syncPortfolioMaster: " + e.message);
    throw e;
  }
}

/**
 * Helper: Slugifies headers (e.g., "Net Profit %" -> "net_profit_percent")
 */
function slugify(text) {
  if (!text) return "unnamed_column";
  return text.toString().toLowerCase()
    .replace(/%/g, 'percent')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '_') 
    .replace(/_+/g, '_')        
    .replace(/^_+|_+$/g, '');   
}

/**
 * Helper: Returns DNA Threshold based on Market Cap Category
 */
function getVolatilityDNA(mCapCategory) {
  // Convert to string and handle null/undefined/numbers
  const category = (mCapCategory || "").toString().toLowerCase();
  
  if (category.includes("large")) return 0.020;  // 2.0%
  if (category.includes("mid"))   return 0.040;  // 4.0%
  if (category.includes("small") || category.includes("micro")) {
    return 0.060; // 6.0%
  }
  return 0.05; // Default 5% for unknown
}