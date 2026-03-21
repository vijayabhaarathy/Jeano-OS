function verifyKeyStorage() {
  const key = PropertiesService.getScriptProperties().getProperty('HEALTH_AGENT_API_KEY');
  if (key) {
    // We only log the first 4 and last 4 characters for security
    const maskedKey = key.substring(0, 4) + "...." + key.substring(key.length - 4);
    Logger.log("✅ Key found! Masked value: " + maskedKey);
  } else {
    Logger.log("❌ Error: 'HEALTH_AGENT_API_KEY' not found in Script Properties.");
  }
}