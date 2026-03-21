function forceAuthTest() {
  // Replace THIS_STRING with your actual ID: 1134467455...
  const hardcodedId = "1naax3kMLcEA50vqr1Ony_uYt5ZGyZ0SDkUPte730n70"; 
  
  try {
    // This forces the V8 engine to recognize the specific target
    const ss = SpreadsheetApp.openById(hardcodedId);
    console.log("SUCCESS: Connected to " + ss.getName());
    
    // Now try fetching it from Properties to see where it breaks
    const propId = PropertiesService.getScriptProperties().getProperty('MARKET_SHEET_ID');
    console.log("Property ID value is: [" + propId + "]");
    
    const ssProp = SpreadsheetApp.openById(propId.trim()); // Added .trim() for safety
    console.log("SUCCESS: Property-based connection worked too.");
    
  } catch (e) {
    console.error("DETAILED ERROR: " + e.message);
    if (e.message.includes("not found")) {
      console.error("CHECK: Is the ID correct? Does the script owner have 'Viewer' access?");
    }
  }
}

function authTrigger() {
  // SpreadsheetApp.openById("1828927135");

  const file = DriveApp.getFileById("1828927135");
  const marketSheet = SpreadsheetApp.open(file);
}