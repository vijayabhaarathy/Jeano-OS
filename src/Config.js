

const JEANO_TIMEZONE = "GMT+5:30"; // Centralized IST

/**
 * Configures and returns the Firestore instance.
 */
/**
 * Configures and returns the Firestore instance with key sanitization.
 */
function getFirestore() {
  const props = PropertiesService.getScriptProperties().getProperties();
  
  const email = props['CLIENT_EMAIL'];
  const projectId = props['PROJECT_ID'];
  let key = props['PRIVATE_KEY'];

  if (!email || !key || !projectId) {
    throw new Error("Missing credentials! Check Script Properties.");
  }

  // 1. Remove literal quotes from the start and end (your JSON has a trailing quote)
  key = key.trim().replace(/^"|"$/g, '');

  // 2. Fix the line breaks: Convert the text "\n" into real invisible line breaks
  // We handle both single and double backslashes just in case
  key = key.replace(/\\n/g, '\n'); 

  return FirestoreApp.getFirestore(email, key, projectId);
}

