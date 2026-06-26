# Garmin Connect Track Analyzer & Progress Tracker

A premium, interactive web dashboard designed to retrieve your Garmin running activities, group routes by spatial track similarity, and visualize your performance improvements over time (heart rate, pace, speed, and elevation) for specific physical tracks.

## 🌟 Features

* **Spatially Grouped Route Tracks**: Automatically groups running activities sharing similar starting and ending points and route lengths into repeating "Tracks."
* **Chronological Progress Charts**: Track your average pace reductions and heart rate cardiovascular efficiency over multiple activities on the same track.
* **Vibrant Segmented Maps**: Renders GPX/TCX/FIT paths on Leaflet.js with continuous gradient colors matching your heart rate or speed intensity.
* **Interactive Telemetry Scrubbing**: Scrub along the continuous run chart to trace your exact telemetry (distance, elevation, pace, heart rate) at any specific meter of the run, with a glowing marker tracking your position live on the map.
* **Local Storage Caching**: Caches parsed routes and activities inside `localStorage` so that the dashboard loads instantly on start, updating dynamically in the background.
* **Zero-Credentials Sandbox Mode**: Automatically serves rich running mock data across 3 tracks over 6 months if no personal synced runs are found, letting you test the dashboard immediately.
* **Garmin Connect Sync & Offline Uploads**: Drag-and-drop raw Garmin `.fit`, `.gpx`, or `.tcx` files directly, or connect your Garmin account securely to sync workouts locally.

---

## 🛠️ Tech Stack

* **Backend**: FastAPI (Python), uvicorn, fitparse, python-multipart
* **Frontend**: HTML5, Vanilla CSS (Glassmorphism layout), Leaflet.js (Maps), Chart.js (Interactive Charts)
* **Modular Architecture**: Clean, separation-of-concerns ES6 Javascript modules (`js/api.js`, `js/maps.js`, `js/charts.js`, `js/app.js`).

---

## 🚀 How to Install and Run Locally

### 1. Prerequisites
Make sure you have **Python 3.10+** installed.

### 2. Set Up Virtual Environment & Dependencies
Clone the repository and run:
```bash
# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Run the Backend Server
Start the local server with:
```bash
python server.py
```
The server will start on: **[http://127.0.0.1:8080](http://127.0.0.1:8080)**

---

## 📂 Project Structure

```
├── js/
│   ├── api.js       # Handles API communications with the FastAPI backend
│   ├── maps.js      # Handles Leaflet map rendering & path segment gradients
│   ├── charts.js    # Handles Chart.js telemetry & progress charts
│   └── app.js       # Central coordinator managing app states & UI binding
├── server.py        # FastAPI backend server with unified GPX/TCX and FIT parser
├── styles.css       # Premium glassmorphic styling
├── index.html       # Single Page Application main entry point
├── requirements.txt # Python dependency file
└── .gitignore       # Prevents local data, venv, and credentials from committing
```
