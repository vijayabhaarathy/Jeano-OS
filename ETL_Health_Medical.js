function processMedicalData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const medicalSheet = ss.getSheetByName("Health Reports");
  const refSheet = ss.getSheetByName("Medical Reference");
  const firestore = getFirestore();

  if (!medicalSheet || !refSheet) {
    throw new Error("Check your tab names ('Health Reports' and 'Medical Reference').");
  }

  // 1. Build Reference Map
  const refValues = refSheet.getDataRange().getValues();
  const refMap = {};
  for (let i = 1; i < refValues.length; i++) {
    const name = refValues[i][0];
    if (name) {
      refMap[name] = { min: refValues[i][2], max: refValues[i][3], unit: refValues[i][4] };
    }
  }

  // 2. Get Data - Since headers are in Row 2, we offset
  const fullData = medicalSheet.getDataRange().getValues();
  const dateHeaders = fullData[1]; // Index 1 is Row 2
  
  let syncCount = 0;

  // 3. Loop Columns D through H (Index 3 to 7)
  for (let col = 3; col <= 7; col++) {
    let reportDate = dateHeaders[col];
    
    // Convert string to Date if necessary
    if (typeof reportDate === 'string' && reportDate !== "") {
      reportDate = new Date(reportDate);
    }

    if (!(reportDate instanceof Date) || isNaN(reportDate.getTime())) {
      continue; 
    }

    // const dateStr = Utilities.formatDate(reportDate, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
    const dateStr = Utilities.formatDate(reportDate, JEANO_TIMEZONE, "yyyy-MM-dd");
    

    // Loop through test rows (Starting from Row 3, which is index 2)
    for (let row = 2; row < fullData.length; row++) {
      const testName = fullData[row][0]; // Test name is still in Column A
      const resultValue = fullData[row][col];

      if (testName && resultValue !== "" && resultValue !== null) {
        const ref = refMap[testName] || {};
        const cleanTestName = testName.replace(/[^a-zA-Z0-9]/g, '');
        const docId = `${dateStr}_${cleanTestName}`;
        const isNormal = (resultValue >= ref.min && resultValue <= ref.max);

        const payload = {
          "report_date": reportDate,
          "test_name": testName,
          "result_value": resultValue,
          "unit": ref.unit || "",
          "ref_min": ref.min || null,
          "ref_max": ref.max || null,
          "is_normal": isNormal,
          "priority_score": isNormal ? 1 : 5, // DYNAMIC PRIORITY: 1 if healthy, 5 if alert
          "etl_timestamp": new Date()
        };

        firestore.updateDocument(`MedicalRecords/${docId}`, payload);
        syncCount++;
      }
    }
  }
  updateAgentHeartbeat("Health_Medical_Agent");
  SpreadsheetApp.getActiveSpreadsheet().toast(`Successfully synced ${syncCount} records!`, "🧞‍♂️ Jeano", 5);
}