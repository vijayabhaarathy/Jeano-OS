/**
 * Jeano's Multi-Macro Health Engine (Universal Library & Batch AI Version)
 * Optimized for: Quota management, IST manual filtering, and dynamic config.
 */
/**
 * Jeano's Multi-Macro Health Engine (Universal Library & Batch AI Version)
 * Optimized for: Real-time visibility, Type-Safety, and Performance.
 */

function getHealthContext(tier = "DAILY", lookbackDays = 1, offset = 1) {
  console.log(`🚀 [ENGINE START] Tier: ${tier} | Window: ${lookbackDays}d | Offset: ${offset}d`);

  // 1. CONFIG & TARGETS
  const config = getJeanoConfig(); 
  const pTarget = parseFloat(config.Protein_Target) || 150; 
  const sedentaryBurn = parseFloat(config.Daily_BMR) || 2250;
  console.log(`🎯 [TARGETS] Protein: ${pTarget}g | BMR: ${sedentaryBurn}kcal`);

  // 2. LOAD NUTRIENT LIBRARY
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const libSheet = ss.getSheetByName("Nutrient_Library");
  const library = {};

  if (libSheet) {
    const data = libSheet.getDataRange().getValues();
    console.log(`📚 [LIBRARY] Loading ${data.length - 1} known food items...`);
    data.slice(1).forEach(row => {
      const key = row[0] ? row[0].toString().toLowerCase().trim() : null;
      if (key) {
        library[key] = {
          basePortion: parseFloat(row[1]) || 1,
          kcal: parseFloat(row[2]) || 0,
          carbs: parseFloat(row[3]) || 0,
          protein: parseFloat(row[4]) || 0,
          fat: parseFloat(row[5]) || 0
        };
      }
    });
  }

  // 3. HARVEST RAW DATA
  const firestore = getFirestore();
  console.log("📥 [FIRESTORE] Harvesting raw data...");
  const allRecentMeals = firestore.getDocuments("DailyMealEntries") || [];
  const allRecentWorkouts = firestore.getDocuments("WorkoutSessions") || [];

  const dates = [];
  for (let i = offset; i < (lookbackDays + offset); i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(Utilities.formatDate(d, JEANO_TIMEZONE, "yyyy-MM-dd"));
  }

  let finalNarrative = `--- HEALTH SME DATA [Tier: ${tier}] ---\n`;

  // 4. PROCESS EACH DATE
  dates.forEach(dateStr => {
    console.log(`\n--- 📅 SCANNING: ${dateStr} ---`);
    let totals = { kcal: 0, carbs: 0, protein: 0, fat: 0 };
    let gaps = [];
    let unknownMealsBatch = [];
    let workoutSummary = ""; 
    let totalBurnout = 0;
    let totalWorkoutDuration = 0; // New accumulator
    let batchResults = null; // Initialize at the date-loop level

    const meals = allRecentMeals.filter(m => {
      const f = m.fields || m;
      const ts = f.session_date?.timestampValue || f.created_at?.timestampValue;
      return ts ? Utilities.formatDate(new Date(ts), JEANO_TIMEZONE, "yyyy-MM-dd") === dateStr : false;
    });

    const workouts = allRecentWorkouts.filter(w => {
      const f = w.fields || w;
      const ts = f.session_date?.timestampValue || f.created_at?.timestampValue;
      return ts ? Utilities.formatDate(new Date(ts), JEANO_TIMEZONE, "yyyy-MM-dd") === dateStr : false;
    });

    const safeNum = (v) => {
      if (!v) return 0;
      const ex = v.doubleValue || v.integerValue || v.stringValue || v;
      const p = parseFloat(ex);
      return isNaN(p) ? 0 : p;
    };
    const safeStr = (v) => v?.stringValue || (typeof v === 'string' ? v : "Not Set");

    let dayStr = `\n[DATE: ${dateStr}]\nTimeline: `;

    // --- STEP A: PROCESS WORKOUTS FIRST ---
    workouts.forEach(w => {
      const wFields = w.fields || w;
      const type = safeStr(wFields.workout_name); 
      const burn = safeNum(wFields.calories_burned);
      const duration = safeNum(wFields.duration_minutes); // Extract duration

      totalBurnout += burn;
      totalWorkoutDuration += duration;
      workoutSummary += `${type} (${duration}m, ${burn} kcal); `;
      dayStr += `Workout: ${type} (~${Math.round(burn)} kcal); `;
    });

    // --- STEP B: PROCESS MEALS ---
    if (meals.length > 0) {
      meals.forEach(m => {
        const mFields = m.fields || m;
        const rawText = safeStr(mFields.raw_entry_text);
        const slot = safeStr(mFields.meal_time_slot);
        const text = rawText.toLowerCase();
        dayStr += `${slot}: "${rawText}"; `;

        const segments = text.split(/[,+]/); 
        segments.forEach(segment => {
          let matchFoundInSegment = false;
          const cleanSegment = segment.trim();

          Object.keys(library)
            .sort((a, b) => b.length - a.length)
            .forEach(foodKey => {
              if (cleanSegment.includes(foodKey) && !matchFoundInSegment) {
                const entry = library[foodKey];
                const weightMatch = cleanSegment.match(/(\d+)/); 
                let ratio = 1;
                if (weightMatch) {
                  const amount = parseFloat(weightMatch[1]);
                  ratio = entry.basePortion <= 1 ? amount : amount / entry.basePortion;
                }
                totals.kcal += (entry.kcal * ratio);
                totals.protein += (entry.protein * ratio);
                totals.carbs += (entry.carbs * ratio);
                totals.fat += (entry.fat * ratio);
                matchFoundInSegment = true;
                console.log(`✅ [LIB MATCH] "${foodKey}" (x${ratio}) -> ${Math.round(entry.kcal * ratio)}kcal`);
              }
            });

          if (!matchFoundInSegment && cleanSegment !== "" && cleanSegment !== "not set") {
            unknownMealsBatch.push(cleanSegment);
          }
        });
      });

      // --- STEP C: AI ESTIMATION ---
      if (unknownMealsBatch.length > 0) {
        console.log(`🤖 [AI BATCH] Estimating: ${unknownMealsBatch.join(", ")}`);
        const batchResults = getAiBatchMacroEstimate(unknownMealsBatch, workoutSummary); 

        if (batchResults && batchResults.summary) {
          totals.kcal += (batchResults.summary.calories_in || 0);
          totals.protein += (batchResults.summary.protein || 0);
          totals.carbs += (batchResults.summary.carbs || 0);
          totals.fat += (batchResults.summary.fat || 0);

          if (batchResults.audit && batchResults.audit.purine_risk === "High") {
            dayStr += `\n⚠️ PURINE ALERT: ${batchResults.audit.outlier_detected || "Check meal logs."}\n`;
          }
        }
      }
    } else {
      gaps.push("Meal Logs");
    }

    // --- STEP D: FINAL CALCULATIONS ---
    const totalOut = sedentaryBurn + totalBurnout;
    const netBalance = totals.kcal - totalOut;
    const pGap = totals.protein - pTarget;

    dayStr += `\nEnergy: In ${Math.round(totals.kcal)} - Out ${Math.round(totalOut)} = Net ${Math.round(netBalance)} kcal\n`;
    dayStr += `Macros: P ${Math.round(totals.protein)}g (${Math.round(pGap)}g vs target) | C ${Math.round(totals.carbs)}g | F ${Math.round(totals.fat)}g\n`;

    if (gaps.length > 0) dayStr += `⚠️ MISSING: ${gaps.join(", ")}\n`;
    finalNarrative += dayStr;

    // --- STEP E: CONSTRUCT & PERSIST JSON ---
    const todayStr = Utilities.formatDate(new Date(), JEANO_TIMEZONE, "yyyy-MM-dd");
    const briefDateDisplay = Utilities.formatDate(new Date(), JEANO_TIMEZONE, "dd MMM yyyy");

    const healthState = {
      "user_id": "Vijay",
      "brief_date": briefDateDisplay, // Today: 17 Mar 2026
      "health": {
        "source_date": dateStr, // Yesterday: 2026-03-16
        "metrics": {
          "net_energy": Math.round(netBalance),
          "protein": Math.round(totals.protein),
          "fat": Math.round(totals.fat),
          "carbs": Math.round(totals.carbs),
          "workout_min": totalWorkoutDuration,
          "workout_kcal": Math.round(totalBurnout)
        },
        "flags": {
          "is_complete": meals.length >= 3,
          "high_purine": (batchResults?.audit?.purine_risk === "High"),
          "outlier": batchResults?.audit?.outlier_detected || "None" 
        },
        "clinical_context": {
          "weight": parseFloat(config.Current_Weight) || 0,
          "uric_acid_last": parseFloat(config.Last_Uric_Acid) || 0
        }
      },
      "market": {
        "source_date": todayStr,
        "status": "Pending_Market_SME" // Placeholder for your next integration
      }
    };

    // Persistence layer
    try {
      // Path format: CollectionName/DocumentID
      const documentPath = `Daily_Summaries/${todayStr}`;
    
      // firestore.createDocument("Daily_Summaries", healthState);
      // Use updateDocument to force the ID to be the dateStr (e.g., "2026-03-16")
      firestore.updateDocument(documentPath, healthState);
      
      console.log(`💾 [HEALTH DATA] Daily Summary upsert successful: ${documentPath}`);
    } catch (e) {
      console.error(`❌ [MARKET DATA] Failed to update Daily Summary: ${e.message}`);
    }
  }); // End dates.forEach

  console.log("🏁 [ENGINE FINISHED] Narrative built successfully.");
  return finalNarrative;
}

/**
 * Agent_Health.gs
 * Domain Logic: Nutrition expertise lives here.
 */
function getAiBatchMacroEstimate(meals, activitySummary = "") { 
  // 1. Validate Input
  if (!meals || !Array.isArray(meals) || meals.length === 0) {
    console.warn("⚠️ [SKIP] No unknown meals to estimate. Returning zero-object.");
    return {
      summary: { calories_in: 0, protein: 0, fat: 0, carbs: 0, calories_out: 0, workout_min: 0 },
      audit: { is_complete: false, purine_risk: "None", outlier_detected: null },
      items: []
    };
  }

  console.log("--- HEALTH AGENT: STARTING 2-PHASE EXTRACTION ---");

  // --- PHASE 1: RESEARCH ---
  const researchPrompt = `Act as a clinical nutrition researcher. 
    Estimate macros (kcal, protein, carbs, fat) for: ${meals.join(" |" )}
    CRITICAL: Use Google Search for South Indian standards (Dosa ~120kcal, Katori ~150ml).
    INSTRUCTIONS:
    - You must return exactly ${meals.length} lines.
    - If a meal is "-", return: "Empty: 0, 0, 0, 0"
    - Otherwise, return: "Meal Name: kcal, p, c, f"
    - Use South Indian standards.
    `;

  const researchText = callJeanoAI(researchPrompt, "TEXT", true);
  console.log("Phase 1 Research Summary: " + researchText);

  // // --- PHASE 2: COMPILATION ---
  // const compilePrompt = `Convert this text into a STRICT JSON array of objects.
  //   Must have exactly ${meals.length} objects.
  //   Keys: "kcal", "protein", "carbs", "fat".
  //   Text: ${researchText}`;

  // --- PHASE 2: STRUCTURED COMPILATION (Data Contract) ---
  // We pass the Research text + Activity data into one final JSON constructor
  const compilePrompt = `
    Act as a Data Engineer. Consolidate the following nutrition research and activity data into a SINGLE JSON object.
    
    RESEARCH DATA: 
    ${researchText}
    
    ACTIVITY DATA:
    ${activitySummary}

    STRICT JSON SCHEMA:
    {
      "summary": { "calories_in": total, "protein": total, "fat": total, "carbs": total, "calories_out": 0, "workout_min": 0 },
      "audit": { "is_complete": boolean, "purine_risk": "Low/Med/High", "outlier_detected": "string/null" },
      "items": [{"name": "string", "kcal": 0, "p": 0, "c": 0, "f": 0}]
    }

    LOGIC:
    - purine_risk: High if organ meats, shellfish, or high-purine items are found.
    - outlier_detected: Flag entries >1000kcal or unusual volume.
    - calories_out/workout_min: Extract from Activity Data.
  `;

  try {
    const finalJson = callJeanoAI(compilePrompt, "JSON", false);
    
    // Check if the result is still a string and parse it if necessary
    const parsedResults = (typeof finalJson === 'string') ? JSON.parse(finalJson) : finalJson;
    
    console.log("✅ Phase 2 Persistable Object Created", Array.isArray(parsedResults)); // Should be 'true'
    return parsedResults; 
  } catch (e) {
    console.error("Health Agent Failed to Compile: " + e.message);
    // Return a structured empty object so the rest of the script doesn't break
    return {
      summary: { calories_in: 0, protein: 0, fat: 0, carbs: 0, calories_out: 0, workout_min: 0 },
      audit: { is_complete: false, purine_risk: "Unknown", outlier_detected: "Compile Error" },
      items: meals.map(m => ({ name: m, kcal: 0, p: 0, c: 0, f: 0 }))
    };
  }
}

// function getHealthContext(tier = "DAILY", lookbackDays = 1, offset = 1) {
//   console.log(`🚀 [ENGINE START] Tier: ${tier} | Window: ${lookbackDays}d | Offset: ${offset}d`);

//   const config = getJeanoConfig(); 
//   const pTarget = parseFloat(config.Protein_Target) || 150; 
//   const sedentaryBurn = parseFloat(config.Daily_BMR) || 2250;
//   console.log(`🎯 [TARGETS] Protein: ${pTarget}g | BMR: ${sedentaryBurn}kcal`);

//   const firestore = getFirestore();
//   const ss = SpreadsheetApp.getActiveSpreadsheet();
//   const libSheet = ss.getSheetByName("Nutrient_Library");
  
//   let matchedParts = []; // Track what we've already counted

//   // Sort keys by length (longest first) so "soya beans boiled" 
//   // matches before "soya beans"
//   Object.keys(library)
//     .sort((a, b) => b.length - a.length)
//     .forEach(foodKey => {
//       if (text.includes(foodKey) && !matchedParts.includes(foodKey)) {
//         const entry = library[foodKey];
        
//         // Improved Regex: Now looks for numbers before the name OR units like 'pcs'
//         // This catches "3 chapathi" OR "250g soya"
//         const weightMatch = text.match(/(\d+)\s*(?=g|gram|scoop|pcs|ml|unit|chapathi|idli|dosa)/i) || text.match(/(\d+)\s+/);
        
//         // Logic: If it's a 'unit' based food (like chapathi), use the raw number.
//         // If it's gram based, use the ratio.
//         let ratio = 1;
//         if (weightMatch) {
//           const amount = parseFloat(weightMatch[1]);
//           // If library base is 1 (like 1 chapathi), ratio is just the amount.
//           // If library base is 100 (like 100g rice), ratio is amount/100.
//           ratio = entry.basePortion <= 1 ? amount : amount / entry.basePortion;
//         }
        
//         const itemKcal = (entry.kcal * ratio);
//         const itemP = (entry.protein * ratio);
        
//         totals.kcal += itemKcal;
//         totals.protein += itemP;
//         totals.carbs += (entry.carbs * ratio);
//         totals.fat += (entry.fat * ratio);
        
//         matchFound = true;
//         matchedParts.push(foodKey); // Prevent double-matching "soya" and "soya beans"
//         console.log(`✅ [LIB MATCH] "${foodKey}" (x${ratio}) -> ${Math.round(itemKcal)}kcal`);
//       }
//     });
    
//   // const library = {};
//   // if (libSheet) {
//   //   const data = libSheet.getDataRange().getValues();
//   //   console.log(`📚 [LIBRARY] Loading ${data.length - 1} known food items...`);
//   //   data.slice(1).forEach(row => {
//   //     const key = row[0] ? row[0].toString().toLowerCase().trim() : null;
//   //     if (key) {
//   //       library[key] = {
//   //         basePortion: parseFloat(row[1]) || 100,
//   //         kcal: parseFloat(row[2]) || 0,
//   //         carbs: parseFloat(row[3]) || 0,
//   //         protein: parseFloat(row[4]) || 0,
//   //         fat: parseFloat(row[5]) || 0
//   //       };
//   //     }
//   //   });
//   // }

//   // Fetch documents once outside the loop for performance
//   console.log("📥 [FIRESTORE] Harvesting raw data for lookback window...");
//   const allRecentMeals = firestore.getDocuments("DailyMealEntries") || [];
//   const allRecentWorkouts = firestore.getDocuments("WorkoutSessions") || [];
//   console.log(`✅ [FIRESTORE] Retrieved ${allRecentMeals.length} meals and ${allRecentWorkouts.length} workouts total.`);

//   const dates = [];
//   for (let i = offset; i < (lookbackDays + offset); i++) {
//     const d = new Date();
//     d.setDate(d.getDate() - i);
//     dates.push(Utilities.formatDate(d, "GMT+5:30", "yyyy-MM-dd"));
//   }

//   let finalNarrative = `--- HEALTH SME DATA [Tier: ${tier}] ---\n`;

//   dates.forEach(dateStr => {
//     console.log(`\n--- 📅 SCANNING: ${dateStr} ---`);
//     let totals = { kcal: 0, carbs: 0, protein: 0, fat: 0, micros: [] };
//     let gaps = [];
//     let unknownMealsBatch = [];

//     const meals = allRecentMeals.filter(m => {
//        const f = m.fields || m;
//        const ts = f.session_date?.timestampValue || f.created_at?.timestampValue;
//        return ts ? Utilities.formatDate(new Date(ts), "GMT+5:30", "yyyy-MM-dd") === dateStr : false;
//     });

//     const workouts = allRecentWorkouts.filter(w => {
//       const f = w.fields || w;
//       const ts = f.session_date?.timestampValue || f.created_at?.timestampValue;
//       return ts ? Utilities.formatDate(new Date(ts), "GMT+5:30", "yyyy-MM-dd") === dateStr : false;
//     });

//     console.log(`🔎 [FILTER] Found ${meals.length} meals and ${workouts.length} workouts for this date.`);

//     const safeNum = (val) => {
//       if (!val) return 0;
//       const extracted = val.doubleValue || val.integerValue || val.stringValue || val;
//       const parsed = parseFloat(extracted);
//       return isNaN(parsed) ? 0 : parsed;
//     };

//     const safeStr = (val) => {
//       if (!val) return "Not Set";
//       return val.stringValue || (typeof val === 'string' ? val : JSON.stringify(val));
//     };

//     let dayStr = `\n[DATE: ${dateStr}]\n`;
//     dayStr += "Timeline: ";

//     if (meals.length > 0) {
//       meals.forEach(m => {
//         const mFields = m.fields || m;
//         const rawText = safeStr(mFields.raw_entry_text);
//         const slot = safeStr(mFields.meal_time_slot);
//         const text = rawText.toLowerCase();
//         dayStr += `${slot}: "${rawText}"; `;

//         let matchFound = false;
//         Object.keys(library).forEach(foodKey => {
//           if (text.includes(foodKey)) {
//             const entry = library[foodKey];
//             const weightMatch = text.match(/(\d+)\s*(?=g|gram|scoop|pcs|ml)/i);
//             const ratio = weightMatch ? parseFloat(weightMatch[1]) / entry.basePortion : 1;
            
//             const itemKcal = (entry.kcal * ratio);
//             const itemP = (entry.protein * ratio);
            
//             totals.kcal += itemKcal;
//             totals.protein += itemP;
//             totals.carbs += (entry.carbs * ratio);
//             totals.fat += (entry.fat * ratio);
//             matchFound = true;
//             console.log(`✅ [LIB MATCH] "${foodKey}" -> ${Math.round(itemKcal)}kcal, ${Math.round(itemP)}g Protein`);
//           }
//         });

//         if (!matchFound && rawText !== "Not Set") {
//           unknownMealsBatch.push(rawText);
//         }
//       });

//       if (unknownMealsBatch.length > 0) {
//         console.log(`🤖 [AI BATCH] Estimating: ${unknownMealsBatch.join(", ")}`);
//         const batchResults = getAiBatchMacroEstimate(unknownMealsBatch);
//         batchResults.forEach((est, idx) => {
//           totals.kcal += est.kcal || 0;
//           totals.protein += est.protein || 0;
//           totals.carbs += est.carbs || 0;
//           totals.fat += est.fat || 0;
//           console.log(`✨ [AI RESULT] "${unknownMealsBatch[idx]}" -> ${est.kcal}kcal, ${est.protein}g P`);
//         });
//       }
//     } else {
//       gaps.push("Meal Logs");
//     }

//     let totalBurnout = 0;
//     workouts.forEach(w => {
//       const wFields = w.fields || w;
//       const type = safeStr(wFields.workout_name); 
//       const burn = safeNum(wFields.calories_burned);
//       totalBurnout += burn;
//       dayStr += `Workout: ${type} (~${Math.round(burn)} kcal); `;
//       console.log(`🏃 [WORKOUT] ${type}: -${Math.round(burn)} kcal`);
//     });

//     const totalOut = sedentaryBurn + totalBurnout;
//     const netBalance = totals.kcal - totalOut;
//     const pGap = totals.protein - pTarget;

//     console.log(`📊 [DAILY TOTALS] In: ${Math.round(totals.kcal)} | Out: ${Math.round(totalOut)} | Net: ${Math.round(netBalance)}`);

//     dayStr += `\nEnergy: In ${Math.round(totals.kcal)} - Out ${Math.round(totalOut)} = Net ${Math.round(netBalance)} kcal\n`;
//     dayStr += `Macros: P ${Math.round(totals.protein)}g (${Math.round(pGap)}g vs target) | C ${Math.round(totals.carbs)}g | F ${Math.round(totals.fat)}g\n`;
    
//     if (gaps.length > 0) {
//       dayStr += `⚠️ MISSING: ${gaps.join(", ")}\n`;
//       console.warn(`⚠️ [DATA GAP] ${dateStr}: No meal logs found.`);
//     }
//     finalNarrative += dayStr;
//   });

//   console.log("🏁 [ENGINE FINISHED] Narrative built successfully.");
//   return finalNarrative;
// }

// /**
//  * MODULE: BATCH AI ESTIMATOR - Requests a single JSON array for multiple meal descriptions
//  */
// function getAiBatchMacroEstimate(mealList) {
//   const prompt = `Act as a nutrition database. Estimate macros for: ${JSON.stringify(mealList)}. 
//   Return ONLY a JSON array of objects with keys: "kcal", "protein", "carbs", "fat". Same order as input.`;
  
//   try {
//     const response = callGemini(prompt);
//     const cleanJson = response.replace(/```json|```/g, "").trim();
//     return JSON.parse(cleanJson);
//   } catch (e) {
//     console.error("Batch AI Error:", e);
//     return mealList.map(() => ({ kcal: 0, protein: 0, carbs: 0, fat: 0 }));
//   }
// }

// function getAiBatchMacroEstimate(meals) {
//   try {
//     // Phase 1: Deep Research
//     const research = geminiResearch(meals);
    
//     // Phase 2: Strict Compilation
//     const macroArray = geminiCompileToJson(research);
    
//     return macroArray; // This goes straight into your sheet/Firestore!
//   } catch (e) {
//     console.error("Pipeline Failure: " + e.message);
//     return meals.map(() => ({ kcal: 0, protein: 0, carbs: 0, fat: 0 }));
//   }
// }