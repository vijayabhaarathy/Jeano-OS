function inspectKey() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const key = props['PRIVATE_KEY'];
  
  if (!key) {
    console.error("❌ PRIVATE_KEY is missing entirely from Script Properties.");
    return;
  }

  console.log("--- Key Inspection Report ---");
  console.log("Total Length: " + key.length + " characters");
  console.log("Starts with: [" + key.substring(0, 10) + "]");
  console.log("Ends with: [" + key.substring(key.length - 10) + "]");
  
  // Check for literal quotes
  const hasQuotes = key.startsWith('"') || key.endsWith('"');
  console.log("Has literal quotes at edges? " + (hasQuotes ? "⚠️ YES" : "✅ NO"));

  // Check for literal backslash-n strings
  const hasLiteralSlashN = key.includes("\\n");
  console.log("Contains literal '\\n' text? " + (hasLiteralSlashN ? "⚠️ YES" : "✅ NO"));
  
  console.log("-----------------------------");
}