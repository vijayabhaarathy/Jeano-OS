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
