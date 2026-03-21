/**
 * AUTOMATED TRIGGERS (Called by the System Clock)
 */
function fitness_dailySync() {
  processDailyLogs(false); // Daily run 
}

function fitness_weeklySync() {
  console.log("🚀 Manual Trigger: Forcing Full Sync (Row 2 to Last)...");
  processDailyLogs(true); // Weekly run or Manual trigger
}

/**
 * Creates a custom menu in Google Sheets for manual ETL triggers.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🚀 JEANO')
    .addItem('Open Central Command', 'showSidebar')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Jeano Central Command')
    .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(html);
}


/**
 * Design Input 3: The "Heartbeat"
 * Records the last successful sync time for a specific agent module.
 */
function updateAgentHeartbeat(agentName) {
  const firestore = getFirestore();
  firestore.updateDocument(`SystemMonitor/${agentName}`, {
    "last_successful_sync": new Date(),
    "status": "Online",
    "version": "3.1"
  });
}