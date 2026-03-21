# Jeano // OS: System Architecture

## 1. Multi-Agent Orchestration Logic
Jeano operates as a "Directed Acyclic Graph" (DAG) where the **Orchestrator** acts as the traffic controller. 

### Subject Matter Expert (SME) Workflow:
1.  **Ingestion:** Raw data enters via Telegram (User logs) or Google Sheets (Market data).
2.  **Sieving:** The `Market_SME_Engine` and `Clinical_SME_Engine` filter out noise using predefined logic thresholds.
3.  **Synthesis:** The `AI_Gateway` sends structured context to Gemini 2.5 Flash for final summarization.

## 2. The Clinical Audit (Health Agent)
Unlike simple calorie trackers, the Health Agent performs a **Behavioral Audit** against medical markers:
* **Uric Acid Sensitivity:** Automatically flags high-purine food logs.
* **Lipid Tracking:** Correlates workout volume from `ETL_Health_Fitness` against LDL/Triglyceride trends.

## 3. The Market Intelligence Sieve
The `Market_Intelligence` module doesn't just pull prices; it tracks:
* **Strategy Alignment:** Checks if current Nifty/GIFT Nifty movements align with the user's specific trading timeframe.
* **Daily Briefing:** Summarizes "Market Readiness" before the Indian market opens.

## 4. Stateful Memory Pattern
Data is persisted in **Firestore** using a `YYYY-MM-DD` document ID. This ensures:
* **Idempotency:** Re-running the script on the same day updates the existing summary rather than creating duplicates.
* **Context Continuity:** Jeano "remembers" the previous day's closing state to provide a 24-hour delta.
