# 🚀 ProspectMiner AI  
### Domain-Specific Lead Mining & AI Enrichment Engine

---

## 📌 Overview

ProspectMiner AI is a **production-style backend system** designed to generate **high-quality, enriched business leads** instead of basic contact lists.

Unlike traditional scrapers, this system:
- Scrapes business data from Google Maps
- Extracts website content
- Uses AI to generate structured business insights
- Scores leads based on quality

---

## 🎯 Use Case

Sales teams often require **qualified leads**, not just names and phone numbers.

Example:
> Searching for *"Dentists in Indore"* should return:
- Verified websites
- Services offered
- Business type
- AI-generated description
- Lead quality score

---

## 🧠 Key Features

### 🔍 1. Stealth Scraping Pipeline
- Puppeteer-based Google Maps scraping
- Extracts:
  - Name
  - Address
  - Phone
  - Website
- Designed to handle pagination and avoid blocking

---

### ⚙️ 2. Queue-Based Architecture
- Built using **BullMQ + Redis**
- Handles scraping asynchronously
- Ensures system stability under load

---

### 🌐 3. Website Content Extraction
- Primary: Axios + Cheerio
- Fallback: Puppeteer (for JS-heavy sites)
- Smart filtering:
  - Skips social media links
  - Skips aggregator platforms
  - Removes duplicate domains

---

### 🤖 4. AI Enrichment Layer (Core Differentiator)
- Uses **Google Gemini API**
- Extracts:
  - Business Type
  - Services Offered
  - Description
  - Owner Name (if available)

- Batch processing implemented for efficiency

---

### 📊 5. Lead Scoring System
Leads are categorized as:

| Score | Criteria |
|------|--------|
| High | Rich content, multiple services, contact info |
| Medium | Moderate data |
| Low | Poor or incomplete data |

---

### ⚡ 6. Smart Optimizations
- Batch AI requests (reduce API usage)
- Domain deduplication
- Heavy-site filtering (e.g., Marriott, Taj, etc.)
- Invalid website filtering
- Quota-aware AI handling

---

## 🏗️ System Architecture
API → Queue → Worker → Scraper → MongoDB
↓
Enrichment Queue
↓
Enrichment Worker
↓
Website Extractor → Gemini AI
↓
MongoDB


---

## 🛠️ Tech Stack

| Layer | Technology |
|------|-----------|
| Backend | Node.js, Express |
| Database | MongoDB |
| Queue | BullMQ |
| Cache/Queue Backend | Redis |
| Scraping | Puppeteer |
| Parsing | Cheerio |
| AI | Gemini API |

---

---

## 🚀 How It Works

1. User triggers scraping (API)
2. Scraper worker collects leads from Google Maps
3. Data stored in MongoDB
4. Enrichment worker:
   - Extracts website text
   - Sends batch to Gemini AI
   - Stores structured insights
5. Leads are scored and finalized

---

## 🧪 AI Accuracy Testing

A manual testing script validates AI output:

- Extracts website text
- Runs AI enrichment
- Compares output with real website data

✔ Ensures:
- Correct business classification  
- Relevant services extraction  
- Accurate descriptions  

---

## 📈 Current Status

| Module | Status |
|------|--------|
| Scraper | ✅ Complete |
| Queue System | ✅ Complete |
| AI Enrichment | ✅ Complete |
| Lead Scoring | ✅ Complete |
| Optimization | 🔥 Advanced |

---

## ⚠️ Limitations

- Free-tier Gemini API has daily quota limits
- Some JS-heavy websites may fail extraction
- Owner name extraction depends on website availability

---

## 🔮 Future Enhancements

- CSV/Excel export feature
- Analytics dashboard
- Credit-based usage system
- Multi-key AI load balancing
- Frontend dashboard (React)

---

## 👨‍💻 Author

**Tanmay Paliwal**  
B.Tech CSE (2024–2028)  
NMIMS Indore  

---

## ⭐ Final Note

This project demonstrates:
- Distributed system design  
- Queue-based architecture  
- AI integration in real-world pipelines  
- Production-level backend engineering  

---
