/**
 * MODULE: CLINICAL DATA FETCH
 * Clinical Data Module: Extracts and validates latest results from MedicalRecords
 **/
 
function getLatestClinicalMarkers() {
  const firestore = getFirestore();
  const medicalDocs = firestore.getDocuments("MedicalRecords") || [];
  
  if (medicalDocs.length === 0) return "No clinical data found.";

  const latestMarkers = {};
  
  medicalDocs.forEach(doc => {
    const f = doc.fields || doc;
    const name = unwrapValue(f.test_name); 
    const val = parseFloat(unwrapValue(f.result_value)) || 0;
    const unitRaw = unwrapValue(f.unit);
    const dateTs = f.report_date?.timestampValue || f.report_date;

    // Fix for the [object Object] unit issue
    const unit = (typeof unitRaw === 'object') ? "" : unitRaw;

    if (!name || !dateTs) return;

    const reportDate = new Date(dateTs);
    const ageInDays = (new Date() - reportDate) / (1000 * 60 * 60 * 24);

    // MODULE: Active Range Validation 
    const min = parseFloat(unwrapValue(f.ref_min)) || 0;
    const max = parseFloat(unwrapValue(f.ref_max)) || 9999;
    
    let status = "Normal";
    if (val < min) status = "⚠️ LOW";
    if (val > max) status = "🚨 HIGH";

    if (!latestMarkers[name] || reportDate > latestMarkers[name].date) {
      latestMarkers[name] = {
        value: val,
        unit: unit,
        status: status,
        date: reportDate,
        isStale: ageInDays > 180, // Flag data older than 6 months
        // dateStr: Utilities.formatDate(reportDate, "GMT+5:30", "dd MMM yyyy")
        dateStr: Utilities.formatDate(reportDate, JEANO_TIMEZONE, "yyyy-MM-dd")
      };
    }
  });

  let clinicalString = "--- LATEST CLINICAL MARKERS ---\n";
  Object.keys(latestMarkers).forEach(key => {
    const m = latestMarkers[key];
    const staleTag = m.isStale ? "[HISTORICAL]" : "[CURRENT]";
    clinicalString += `${staleTag} ${key}: ${m.value} ${m.unit} (${m.status}) [Reported: ${m.dateStr}]\n`;
  });

  console.log(clinicalString);
  return clinicalString;
}

/**
 * Utility to safely unwrap Firestore data types
 * This must be present in the same script project to be globally accessible.
 */
function unwrapValue(field) {
  if (!field) return 0; // Default to 0 for missing numbers
  const val = field.stringValue || field.doubleValue || field.integerValue || field.booleanValue || field.timestampValue || field;
  
  // If the result is technically NaN, force it to 0
  return isNaN(val) && typeof val === 'number' ? 0 : val;
}