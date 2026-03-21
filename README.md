# Jeano // OS
> **The Personal AI Orchestrator: A Stateful Multi-Agent System for Health, Wealth, and Market Intelligence.**

`Jeano // OS` is a high-autonomy orchestration layer built on Google Cloud and Workspace. Inspired by the loyal, witty, and protective AI from Tamil science fiction, it transforms fragmented life-logs into structured, actionable intelligence.

---

## 🏗️ System Architecture: The Orchestrator-SME Model
Jeano operates on a hub-and-spoke architecture where a central **Orchestrator** manages specialized **Subject Matter Expert (SME) Agents**.

### 1. The Orchestrator (The Brain)
The core logic gate that routes user intent, manages session state via Firestore, and synthesizes multi-agent outputs into a cohesive "Today Anchor" brief.

### 2. Health Agent (Clinical Auditor)
Operates a **2-Phase Extraction** pipeline to parse natural language logs (meals, workouts) against a medical knowledge base and structure them into JSON for longitudinal tracking.

### 3. Market Agent (Intelligence Sieve)
A specialized ETL agent that sifts raw Google Sheets data and enriches it with Web Intelligence (Nifty/GIFT Nifty trends) to signal alignment with trading strategies.

---

## 🛠️ Technical Stack
* **Backend Logic:** Google Apps Script (GAS)
* **Core Intelligence:** Gemini 2.5 Flash
* **Stateful Memory:** Cloud Firestore (`Daily_Summaries` collection)
* **Mobile Interface:** Telegram Bot API
* **Data Lake:** Google Sheets

---

## 🔒 Security & Governance
* **Identity Lock:** Strict Telegram `UserID` validation.
* **Secret Management:** All API keys are encapsulated within encrypted **GAS Script Properties**.
