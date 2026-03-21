// function callGemini(prompt) {
//   const props = PropertiesService.getScriptProperties();
//   const apiKey = props.getProperty('JEANO_ORCHESTRATOR_API_KEY');
  
//   if (!apiKey) throw new Error("Missing JEANO_ORCHESTRATOR_API_KEY!");

//   const modelId = "gemini-2.5-flash"; 
//   const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

//   console.log("Prompt: " + prompt);
//   const cleanPrompt = prompt.replace(/\\"/g, '"').replace(/\n/g, ' ');

//   // Build the payload as a clean object first
//   const requestBody = {
//     "contents": [
//       {
//         "parts": [
//           {
//             "text": cleanPrompt
//           }
//         ]
//       }
//     ],
//     "tools": [
//       {
//         "google_search": {}
//       }
//     ],
//     "generationConfig": {
//       "temperature": 0.1,
//       "maxOutputTokens": 1000
//     }
//   };

//   const options = {
//     "method": "post",
//     "contentType": "application/json",
//     "payload": JSON.stringify(requestBody), // Ensure standard JSON formatting
//     "muteHttpExceptions": true
//   };

//   // Log for debugging: Copy this from your Apps Script logs if it fails again
//   console.log("Sending Payload: " + JSON.stringify(requestBody));

//   try {
//     const response = UrlFetchApp.fetch(apiUrl, options);
//     const responseText = response.getContentText();
//     const json = JSON.parse(responseText);

//     if (json.candidates && json.candidates[0].content) {
//       const rawText = json.candidates[0].content.parts[0].text;
      
//       // NEW: Extract ONLY the JSON array from the response
//       // This regex finds the first '[' and last ']' and grabs everything in between
//       const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      
//       if (jsonMatch) {
//         return jsonMatch[0]; // Returns just the clean [{}, {}] string
//       }
      
//       return rawText; // Fallback if no brackets are found
//     }
//   } catch (e) {
//     console.error("Critical Failure:", e.toString());
//     return "Error: " + e.message;
//   }
// }

// function geminiResearch(meals) {
//   console.log("--- PHASE 1: RESEARCH START ---");
//   console.log("Input Meals: " + meals.join(", "));

//   const prompt = `Act as a clinical nutrition researcher. 
//     Estimate macros (kcal, protein, carbs, fat) for these specific meals:
//     ${meals.join("\n")}
    
//     CRITICAL: Use Google Search to find calorie data specifically for South Indian standards:
//     - 1 Regular Dosa = ~120 kcal
//     - 1 Katori (Standard Bowl) = ~150ml - 200ml
//     - 1 Egg Dosa = ~200-250 kcal
    
//     Provide the estimate for each meal clearly. DO NOT return JSON.`;

//   const requestBody = {
//     "contents": [{"parts": [{"text": prompt}]}],
//     "tools": [{"google_search": {}}],
//     "generationConfig": { "temperature": 0.2, "maxOutputTokens": 1200 }
//   };
//   console.log("Request Body:" + requestBody);
//   const researchResult = callGeminiRaw(requestBody);
//   console.log("Phase 1 Result: " + researchResult.substring(0, 500) + "..."); // Log first 500 chars
//   return researchResult;
// }

// function geminiCompileToJson(researchText) {
//   console.log("--- PHASE 2: COMPILATION START ---");
  
//   const prompt = `Convert the nutrition research text below into a STRICT JSON array of objects.
//     Each object must have keys: "kcal", "protein", "carbs", "fat".
//     Order must match the research text.
    
//     TEXT TO CONVERT:
//     ${researchText}`;

//   const requestBody = {
//     "contents": [{"parts": [{"text": prompt}]}],
//     "generationConfig": {
//       "temperature": 0,
//       "response_mime_type": "application/json"
//     }
//   };

//   const rawJson = callGeminiRaw(requestBody);
//   console.log("Phase 2 RAW JSON: " + rawJson);
//   return JSON.parse(rawJson);
// }

function callGeminiRaw(body) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('JEANO_ORCHESTRATOR_API_KEY');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());
  
  // if (json.candidates && json.candidates[0].content.parts[0].text) {
  //   const queries = json.candidates[0].groundingMetadata.webSearchQueries;
  //   console.log("Gemini Search Queries executed: " + JSON.stringify(queries));
  //   return json.candidates[0].content.parts[0].text;
  // }
  
  if (json.candidates && json.candidates[0].content?.parts?.[0]?.text) {
    const grounding = json.candidates[0].groundingMetadata;
    const queries = grounding?.webSearchQueries || [];

    if (queries.length > 0) {
      console.log(
        "Gemini Search Queries executed: " +
        JSON.stringify(queries)
      );
    }

    return json.candidates[0].content.parts[0].text;
  }

  throw new Error("Gemini API returned no content: " + response.getContentText());
}

/**
 * AIGateway.gs
 * Generic Bridge: No meal/stock logic allowed here.
 */
function callJeanoAI(prompt, responseType = "TEXT", useSearch = false) {
  const requestBody = {
    "contents": [{"parts": [{"text": prompt}]}],
    "generationConfig": {
      "temperature": (responseType === "JSON") ? 0 : 0.2, // Low temp for extraction
      "response_mime_type": (responseType === "JSON") ? "application/json" : "text/plain"
    }
  };

  if (useSearch) {
    requestBody.tools = [{"google_search": {}}];
  }

  return callGeminiRaw(requestBody);
}
