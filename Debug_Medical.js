function finalDiagnosticTest() {
  const firestore = getFirestore();
  const targetDate = "2025-12-25";
  console.log(`🧪 Starting Sandbox Test for ${targetDate}...`);

  // --- TEST A: THE RANGE QUERY ---
  // This mimics how Firestore handles timestamps
  const start = new Date(targetDate + "T00:00:00+05:30"); // Midnight IST
  const end = new Date(targetDate + "T23:59:59+05:30");   // End of day IST
  
  console.log("Checking Test A (Range Query)...");
  const mealsA = firestore.query("DailyMealEntries", {
    where: [
      { field: "session_date", operator: ">=", value: start },
      { field: "session_date", operator: "<=", value: end }
    ]
  });
  console.log(`Result A: Found ${mealsA ? mealsA.length : 0} meals.`);

  // --- TEST B: THE MANUAL SCAN ---
  // This grabs the raw data and lets JavaScript do the math
  console.log("Checking Test B (Manual JS Filter)...");
  const allDocs = firestore.getDocuments("DailyMealEntries");
  const mealsB = allDocs.filter(m => {
    const f = m.fields || m;
    const ts = f.session_date?.timestampValue || f.session_date;
    if (!ts) return false;
    const istDate = Utilities.formatDate(new Date(ts), "GMT+5:30", "yyyy-MM-dd");
    return istDate === targetDate;
  });
  console.log(`Result B: Found ${mealsB.length} meals.`);
}