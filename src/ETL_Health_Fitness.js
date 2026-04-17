/**
 * Processes Meal and Workout data from the "Daily Meals" tab.
 */
function processDailyLogs(isFullSync) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Daily Meals");
  const firestore = getFirestore();
  
  // Get all values in Column A to find the real last row
  const colAValues = sheet.getRange("A:A").getValues();
  let lastRow = 0;
  for (let i = colAValues.length - 1; i >= 0; i--) {
    if (colAValues[i][0] !== "" && colAValues[i][0] !== null) {
      lastRow = i + 1;
      break;
    }
  }
  
  console.log("Detected Last Row:", lastRow);

  if (lastRow < 2) {
    console.log("No data found in 'Daily Meals' tab.");
    return;
  }

  // DEBUG: Add these two lines to see what's happening in the logs!
  // console.log("DEBUG: received isFullSync value:", isFullSync);
  // console.log("DEBUG: type of isFullSync:", typeof isFullSync);

  const startRow = (isFullSync === true) ? 2 : lastRow;
  // console.log("DEBUG: Final startRow choice:", startRow);
  const numRows = lastRow - startRow + 1;

  if (numRows < 1) {
    console.log("No new rows to process.");
    return;
  }
  
  // Capturing columns A through O (Index 0 to 14)
  const dataRange = sheet.getRange(startRow, 1, numRows, 18); 
  const rows = dataRange.getValues();

  // Define column mappings (Index starts at 0)
  const MEAL_COLS = {
    1: "Morning Drink", 2: "Breakfast", 3: "11am Snack", 
    4: "Lunch", 5: "Pre-Workout", 6: "Evening Snack", 7: "Dinner", 
    8: "Others"
  };
  const WORKOUT_COLS = {
    10: "Elliptical", 11: "Weight Training", 12: "Treadmill", 
    13: "Walking Outside", 14: "Others"
  };

  rows.forEach((row, rowIndex) => {
    const rawDate = row[0];
    if (!rawDate) return; // Skip empty date cells
    
    // Format date for Doc ID: YYYY-MM-DD
    // const dateStr = Utilities.formatDate(new Date(rawDate), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
    const dateStr = Utilities.formatDate(new Date(rawDate), JEANO_TIMEZONE, "yyyy-MM-dd");

    // Process MEALS (B-I)
    Object.keys(MEAL_COLS).forEach(colIdx => {
      const content = row[colIdx];
      if (content && content.toString().trim() !== "") {
        const slotName = MEAL_COLS[colIdx];
        const docId = `${dateStr}_${slotName.replace(/\s+/g, '')}`;
        
        firestore.updateDocument(`DailyMealEntries/${docId}`, {
          "session_date": rawDate,
          "meal_time_slot": slotName,
          "raw_entry_text": content.toString(),
          "etl_timestamp": new Date()
        });
        Utilities.sleep(200);
      }
    });

    // Process WORKOUTS (J-N)
    Object.keys(WORKOUT_COLS).forEach(colIdx => {
      const content = row[colIdx];
      if (content && content.toString().trim() !== "") {
        const workoutName = WORKOUT_COLS[colIdx];
        const docId = `${dateStr}_${workoutName.replace(/\s+/g, '')}`;
        
        firestore.updateDocument(`WorkoutSessions/${docId}`, {
          "session_date": rawDate,
          "activity_type": workoutName,
          "raw_entry_text": content.toString(),
          "etl_timestamp": new Date()
        });
        Utilities.sleep(200);
      }
    });

    // Process DAILY SUMMARIES (Columns Q & R)
    const energy = row[16]; // Column Q
    const sleep = row[17];  // Column R

    if (energy || sleep) {
      console.log("DEBUG: EnergyLevel Table IN")
      const summaryId = dateStr; 
      firestore.updateDocument(`EnergyLevel/${summaryId}`, {
        "session_date": rawDate,
        "energy_level": energy ? energy.toString() : "Not Recorded",
        "sleep_quality": sleep ? sleep.toString() : "Not Recorded",
        "etl_timestamp": new Date()
      });
      Utilities.sleep(200);
    }
    console.log(`ETL Completed: Row ${startRow + rowIndex} of ${lastRow}`);
  });
  
  console.log(`Sync Completed for rows ${startRow} to ${lastRow}`);
}