function wakeUpJeano() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('HEALTH_AGENT_API_KEY');
  
  // 1. Updated 2025 Model Path (Using 2.0 Flash for stability)
  const modelId = "gemini-2.5-flash-lite"; 
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
  
  const payload = {
    "contents": [{
      "parts": [{ "text": "System check. State your name and current status." }]
    }],
    // In 2025, system_instruction is the standard for v1beta
    "system_instruction": {
      "parts": [{ "text": "Your name is Jeano. You are a sophisticated, articulate AI. Your tone is loyal and refined. Respond briefly." }]
    }
  };

  const options = {
    "method": "POST",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const resText = response.getContentText();
    const json = JSON.parse(resText);

    if (response.getResponseCode() === 200) {
      Logger.log("✅ JEANO IS AWAKE: " + json.candidates[0].content.parts[0].text);
    } else {
      Logger.log("❌ Connection Error " + response.getResponseCode() + ": " + resText);
    }
  } catch (e) {
    Logger.log("❌ Script Error: " + e.toString());
  }
}