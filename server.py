import os
import json
import math
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# We will try importing fitparse, and have a fallback parser for GPX/TCX XML if fitparse is unavailable
try:
    import fitparse
    HAS_FITPARSE = True
except ImportError:
    HAS_FITPARSE = False

try:
    import xml.etree.ElementTree as ET
    HAS_XML = True
except ImportError:
    HAS_XML = False

app = FastAPI(title="Garmin Analyzer & Progress Tracker")

# Storage directory for uploaded/synced runs
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)

# Cache file for resolved routes/tracks
ROUTES_CACHE_FILE = os.path.join(DATA_DIR, "routes.json")


# Model schemas
class GarminLoginRequest(BaseModel):
    email: str
    password: str

class TrackGroup(BaseModel):
    id: str
    name: str
    runs_count: int
    distance_m: float
    average_pace_sec: float
    average_hr: float
    best_pace_sec: float


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points in meters."""
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2))
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


def generate_high_fidelity_mock_data() -> List[Dict[str, Any]]:
    """Generate rich, realistic running activity history over 6 months across 3 distinct routes."""
    activities = []
    
    # Define 3 tracks
    # 1. Lake Loop (Flat, 5.2 km)
    # Start: 47.6062, -122.3321
    lake_loop_pts = []
    center_lat, center_lon = 47.610, -122.335
    radius = 0.008  # approx 5.2 km perimeter
    for i in range(100):
        angle = (i / 100.0) * 2 * math.pi
        lat = center_lat + radius * math.cos(angle) * 0.7  # slightly squished circle
        lon = center_lon + radius * math.sin(angle)
        lake_loop_pts.append((lat, lon))

    # 2. Hill Climber (Steep, 3.5 km)
    # Start: 47.6200, -122.3493
    hill_pts = []
    start_lat, start_lon = 47.6200, -122.3493
    for i in range(100):
        t = i / 99.0
        # Out and back hill track
        if t <= 0.5:
            progress = t * 2
            lat = start_lat + 0.012 * progress
            lon = start_lon + 0.005 * progress
        else:
            progress = (1.0 - t) * 2
            lat = start_lat + 0.012 * progress
            lon = start_lon + 0.005 * progress
        hill_pts.append((lat, lon))

    # 3. Forest Trail (Rolling hills, 8.4 km)
    # Start: 47.585, -122.310
    forest_pts = []
    for i in range(100):
        angle = (i / 100.0) * 2 * math.pi
        lat = 47.585 + 0.015 * math.sin(angle) + 0.003 * math.sin(3 * angle)
        lon = -122.310 + 0.015 * math.cos(angle) + 0.002 * math.cos(4 * angle)
        forest_pts.append((lat, lon))

    routes_config = [
        {
            "name": "Lake Loop",
            "distance": 5200.0,
            "points": lake_loop_pts,
            "runs": 6,
            "initial_pace": 340,  # 5:40 / km in seconds
            "final_pace": 285,    # 4:45 / km in seconds
            "initial_hr": 164,
            "final_hr": 152,
            "elevation_profile": [10.0 + 3.0 * math.sin(i * 0.1) for i in range(100)]
        },
        {
            "name": "Hill Climber Interval",
            "distance": 3500.0,
            "points": hill_pts,
            "runs": 4,
            "initial_pace": 410,  # 6:50 / km
            "final_pace": 345,    # 5:45 / km
            "initial_hr": 178,
            "final_hr": 168,
            "elevation_profile": [50.0 + 150.0 * (math.sin(i * 0.0314) if i < 50 else math.sin((100-i) * 0.0314)) for i in range(100)]
        },
        {
            "name": "Forest Trail",
            "distance": 8400.0,
            "points": forest_pts,
            "runs": 3,
            "initial_pace": 380,  # 6:20 / km
            "final_pace": 330,    # 5:30 / km
            "initial_hr": 160,
            "final_hr": 149,
            "elevation_profile": [120.0 + 40.0 * math.cos(i * 0.15) for i in range(100)]
        }
    ]

    base_date = datetime.now() - timedelta(days=120)
    activity_id_counter = 9001001

    for r_idx, route in enumerate(routes_config):
        runs_count = route["runs"]
        for run_idx in range(runs_count):
            activity_id_counter += 1
            progress_ratio = run_idx / (runs_count - 1) if runs_count > 1 else 1.0
            
            # Linearly interpolate improvements
            target_pace = route["initial_pace"] - (route["initial_pace"] - route["final_pace"]) * progress_ratio
            # Add small random noise to pace (+/- 5 seconds)
            target_pace += (run_idx * 3.7 % 11) - 5
            
            target_hr = route["initial_hr"] - (route["initial_hr"] - route["final_hr"]) * progress_ratio
            # Heart rate random variance
            target_hr += (run_idx * 2.3 % 5) - 2

            elapsed_seconds = int(target_pace * (route["distance"] / 1000.0))
            run_date = base_date + timedelta(days=int(progress_ratio * 110) + r_idx * 5)
            
            # Build continuous samples
            samples = []
            cumulative_dist = 0.0
            step_dist = route["distance"] / 100.0
            step_time = elapsed_seconds / 100.0

            for i in range(100):
                lat, lon = route["points"][i]
                ele = route["elevation_profile"][i]
                
                # Pace and HR variations throughout the run
                sample_speed = 1000.0 / target_pace # m/s
                # Speed is slightly slower on hills, faster downhill
                elevation_change = 0.0
                if i > 0:
                    elevation_change = ele - route["elevation_profile"][i-1]
                
                speed_mod = 1.0 - (elevation_change * 0.05)
                # Keep within bounds
                speed_mod = max(0.6, min(1.4, speed_mod))
                current_speed = sample_speed * speed_mod

                # Heart rate spikes on uphill
                current_hr = target_hr + (elevation_change * 2.5)
                # Add some physiological warmup/cardiac drift
                if i < 15:
                    current_hr -= (15 - i) * 1.5
                else:
                    current_hr += (i * 0.05)
                current_hr = max(100, min(195, current_hr))

                samples.append({
                    "time_offset": int(i * step_time),
                    "latitude": lat,
                    "longitude": lon,
                    "elevation": round(ele, 1),
                    "heart_rate": int(current_hr),
                    "speed": round(current_speed, 2),
                    "distance": round(cumulative_dist, 1)
                })
                cumulative_dist += step_dist

            activities.append({
                "activity_id": str(activity_id_counter),
                "name": f"Afternoon Run - {route['name']}",
                "start_time": run_date.strftime("%Y-%m-%d %H:%M:%S"),
                "distance_m": route["distance"],
                "duration_seconds": elapsed_seconds,
                "average_hr": round(sum(s["heart_rate"] for s in samples) / len(samples), 1),
                "max_hr": max(s["heart_rate"] for s in samples),
                "average_speed_m_s": round(route["distance"] / elapsed_seconds, 2),
                "calories": int(route["distance"] * 0.07),
                "samples": samples,
                "is_mock": True
            })

    return activities


def group_activities_by_route(activities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Analyze start/end points and track profiles to group activities into physical routes/tracks."""
    if not activities:
        return []

    groups = []
    group_counter = 1

    for act in sorted(activities, key=lambda a: a["start_time"]):
        samples = act.get("samples", [])
        if not samples:
            continue

        start_lat = samples[0]["latitude"]
        start_lon = samples[0]["longitude"]
        end_lat = samples[-1]["latitude"]
        end_lon = samples[-1]["longitude"]
        dist = act["distance_m"]

        # Attempt to match with an existing group
        matched_group_id = None
        for g in groups:
            # We match if start/end points are within ~250m and overall distance is within 15%
            dist_start = haversine_distance(start_lat, start_lon, g["start_lat"], g["start_lon"])
            dist_end = haversine_distance(end_lat, end_lon, g["end_lat"], g["end_lon"])
            dist_diff_pct = abs(dist - g["distance_m"]) / g["distance_m"]

            if dist_start < 250.0 and dist_end < 250.0 and dist_diff_pct < 0.15:
                matched_group_id = g["id"]
                break

        if matched_group_id is None:
            # Create a new route group
            # Parse route name from the activity if it has one
            route_name = "Custom Track"
            for keyword in ["Lake Loop", "Hill Climber", "Forest Trail"]:
                if keyword in act["name"]:
                    route_name = keyword
                    break
            
            if route_name == "Custom Track":
                route_name = f"Route {group_counter} ({round(dist/1000.0, 1)}km)"
                group_counter += 1

            matched_group_id = f"route_{len(groups) + 1}"
            groups.append({
                "id": matched_group_id,
                "name": route_name,
                "start_lat": start_lat,
                "start_lon": start_lon,
                "end_lat": end_lat,
                "end_lon": end_lon,
                "distance_m": dist,
                "activities": []
            })

        # Append activity to the group
        for g in groups:
            if g["id"] == matched_group_id:
                g["activities"].append(act)
                break

    # Format the return structure with summaries
    formatted_groups = []
    for g in groups:
        runs = g["activities"]
        if not runs:
            continue
        
        avg_pace = sum(r["duration_seconds"] / (r["distance_m"] / 1000.0) for r in runs) / len(runs)
        avg_hr = sum(r["average_hr"] for r in runs) / len(runs)
        best_pace = min(r["duration_seconds"] / (r["distance_m"] / 1000.0) for r in runs)
        
        # Sort runs chronologically for progress graphing
        runs_sorted = sorted(runs, key=lambda r: r["start_time"])
        
        # Pull map path preview (average representation of points)
        map_points = [[s["latitude"], s["longitude"]] for s in runs_sorted[-1]["samples"]]

        formatted_groups.append({
            "id": g["id"],
            "name": g["name"],
            "runs_count": len(runs),
            "distance_m": round(g["distance_m"], 1),
            "average_pace_sec": round(avg_pace, 1),
            "average_hr": round(avg_hr, 1),
            "best_pace_sec": round(best_pace, 1),
            "map_preview_points": map_points,
            "activities": [{
                "activity_id": r["activity_id"],
                "name": r["name"],
                "start_time": r["start_time"],
                "distance_m": r["distance_m"],
                "duration_seconds": r["duration_seconds"],
                "average_hr": r["average_hr"],
                "max_hr": r["max_hr"],
                "average_speed_m_s": r["average_speed_m_s"],
                "calories": r["calories"],
                "samples": r["samples"],
                "is_mock": r.get("is_mock", False)
            } for r in runs_sorted]
        })

    return formatted_groups


# Load activities from local files
def load_all_activities() -> List[Dict[str, Any]]:
    activities = []
    
    # Check if we have any synced JSON files on disk
    real_files = [f for f in os.listdir(DATA_DIR) if f.endswith(".json") and f != "routes.json"]
    
    if real_files:
        # Load only synced/uploaded files
        for filename in real_files:
            try:
                with open(os.path.join(DATA_DIR, filename), "r") as f:
                    data = json.load(f)
                    activities.append(data)
            except Exception as e:
                print(f"Error loading {filename}: {e}")
    else:
        # Fallback to mock data only if no real synced runs exist
        activities.extend(generate_high_fidelity_mock_data())
                
    return activities



def parse_tcx_file(file_content: bytes) -> Dict[str, Any]:
    """Parse telemetry from GPX/TCX standard XML format."""
    root = ET.fromstring(file_content)
    # Remove XML namespaces to simplify querying
    for elem in root.iter():
        if '}' in elem.tag:
            elem.tag = elem.tag.split('}', 1)[1]

    samples = []
    
    # Auto-detect if GPX or TCX
    is_gpx = len(root.findall(".//trkpt")) > 0
    
    if is_gpx:
        trackpoints = root.findall(".//trkpt")
    else:
        trackpoints = root.findall(".//Trackpoint")
        
    start_time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    time_element = root.find(".//time") if is_gpx else root.find(".//Id")
    if time_element is not None and time_element.text:
        try:
            # Parse ISO time
            dt = datetime.strptime(time_element.text[:19], "%Y-%m-%dT%H:%M:%S")
            start_time_str = dt.strftime("%Y-%m-%d %H:%M:%S")
        except:
            pass

    activity_name = "Uploaded GPX Run" if is_gpx else "Uploaded TCX Run"
    
    # Try to find a richer name in metadata
    name_elem = root.find(".//name")
    if name_elem is not None and name_elem.text:
        activity_name = name_elem.text

    cumulative_distance = 0.0
    start_dt = None

    for idx, tp in enumerate(trackpoints):
        if is_gpx:
            lat_val = tp.attrib.get("lat")
            lon_val = tp.attrib.get("lon")
            if lat_val is None or lon_val is None:
                continue
            lat = float(lat_val)
            lon = float(lon_val)
            
            ele_elem = tp.find("ele")
            ele = float(ele_elem.text) if ele_elem is not None and ele_elem.text else 0.0
            
            hr_elem = tp.find(".//hr")
            hr = int(hr_elem.text) if hr_elem is not None and hr_elem.text else 0
            
            # GPX does not have precomputed distance, we will compute it via Haversine
            dist = cumulative_distance
            if idx > 0 and samples:
                prev = samples[-1]
                step_d = haversine_distance(prev["latitude"], prev["longitude"], lat, lon)
                dist = cumulative_distance + step_d
        else:
            lat_elem = tp.find(".//LatitudeDegrees")
            lon_elem = tp.find(".//LongitudeDegrees")
            if lat_elem is None or lon_elem is None:
                continue
            lat = float(lat_elem.text)
            lon = float(lon_elem.text)
            
            ele_elem = tp.find(".//AltitudeMeters")
            ele = float(ele_elem.text) if ele_elem is not None and ele_elem.text else 0.0
            
            hr_elem = tp.find(".//HeartRateBpm/Value")
            hr = int(hr_elem.text) if hr_elem is not None and hr_elem.text else 0
            
            dist_elem = tp.find(".//DistanceMeters")
            dist = float(dist_elem.text) if dist_elem is not None and dist_elem.text else cumulative_distance

        time_elem = tp.find("time") if is_gpx else tp.find(".//Time")
        time_offset = idx * 2  # fallback
        
        if time_elem is not None and time_elem.text:
            try:
                # Parse point timestamp
                pt_time = datetime.strptime(time_elem.text[:19], "%Y-%m-%dT%H:%M:%S")
                if start_dt is None:
                    start_dt = pt_time
                    start_time_str = start_dt.strftime("%Y-%m-%d %H:%M:%S")
                time_offset = int((pt_time - start_dt).total_seconds())
            except:
                pass

        samples.append({
            "time_offset": time_offset,
            "latitude": lat,
            "longitude": lon,
            "elevation": round(ele, 1),
            "heart_rate": hr,
            "speed": 0.0,  # calculated below
            "distance": round(dist, 1)
        })
        cumulative_distance = dist

    # Backfill default heart rate if missing entirely from GPX (e.g. non-HR tracks)
    total_hr = sum(s["heart_rate"] for s in samples)
    if total_hr == 0 and samples:
        for s in samples:
            s["heart_rate"] = 135

    # Calculate speeds between points
    for i in range(1, len(samples)):
        dt = samples[i]["time_offset"] - samples[i-1]["time_offset"]
        dd = samples[i]["distance"] - samples[i-1]["distance"]
        if dt > 0:
            samples[i]["speed"] = round(dd / dt, 2)
        else:
            samples[i]["speed"] = samples[i-1]["speed"]
            
    if samples:
        samples[0]["speed"] = samples[1]["speed"] if len(samples) > 1 else 0.0

    total_duration = samples[-1]["time_offset"] if samples else 0
    total_dist = samples[-1]["distance"] if samples else 0.0
    avg_hr = sum(s["heart_rate"] for s in samples) / len(samples) if samples else 0

    return {
        "activity_id": f"xml_{int(datetime.now().timestamp())}",
        "name": activity_name,
        "start_time": start_time_str,
        "distance_m": total_dist,
        "duration_seconds": total_duration,
        "average_hr": round(avg_hr, 1),
        "max_hr": max([s["heart_rate"] for s in samples]) if samples else 0,
        "average_speed_m_s": round(total_dist / total_duration, 2) if total_duration > 0 else 0.0,
        "calories": int(total_dist * 0.07),
        "samples": samples,
        "is_mock": False
    }



# API Endpoints
@app.get("/api/activities")
def get_activities():
    """Retrieve all synced and mock activities grouped by route tracks."""
    activities = load_all_activities()
    grouped_routes = group_activities_by_route(activities)
    return JSONResponse(content={"routes": grouped_routes})


def parse_csv_file(file_content: bytes) -> Dict[str, Any]:
    """Parse activity trackpoints from a CSV file."""
    import csv
    import io
    
    # Decode content
    text = file_content.decode('utf-8', errors='ignore')
    reader = csv.reader(io.StringIO(text))
    
    rows = list(reader)
    if not rows:
        raise ValueError("CSV file is empty")
        
    # Find headers (look at the first row)
    headers = [h.strip().lower() for h in rows[0]]
    
    # Map headers to standard fields
    field_mapping = {
        'latitude': ['latitude', 'lat'],
        'longitude': ['longitude', 'lon', 'lng'],
        'elevation': ['elevation', 'ele', 'altitude', 'alt'],
        'heart_rate': ['heart_rate', 'hr', 'heartrate', 'bpm'],
        'speed': ['speed', 'velocity'],
        'distance': ['distance', 'dist'],
        'time_offset': ['time_offset', 'offset', 'time', 'timestamp']
    }
    
    col_indices = {}
    for standard_field, aliases in field_mapping.items():
        col_indices[standard_field] = None
        for alias in aliases:
            if alias in headers:
                col_indices[standard_field] = headers.index(alias)
                break
                
    # Check minimum required fields for GPS track
    if col_indices['latitude'] is None or col_indices['longitude'] is None:
        raise ValueError("CSV must contain latitude and longitude columns (e.g. 'lat', 'lon').")
        
    samples = []
    cumulative_distance = 0.0
    start_time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    for row_idx, row in enumerate(rows[1:]):
        if not row or len(row) <= max(idx for idx in col_indices.values() if idx is not None):
            continue
            
        try:
            # Parse latitude and longitude
            lat = float(row[col_indices['latitude']])
            lon = float(row[col_indices['longitude']])
            
            # Parse other fields with fallbacks
            ele = 0.0
            if col_indices['elevation'] is not None and row[col_indices['elevation']]:
                ele = float(row[col_indices['elevation']])
                
            hr = 135
            if col_indices['heart_rate'] is not None and row[col_indices['heart_rate']]:
                hr = int(float(row[col_indices['heart_rate']]))
                
            speed = 0.0
            if col_indices['speed'] is not None and row[col_indices['speed']]:
                speed = float(row[col_indices['speed']])
                
            # If distance is provided, use it, else calculate from previous point
            dist = cumulative_distance
            if col_indices['distance'] is not None and row[col_indices['distance']]:
                dist = float(row[col_indices['distance']])
            elif row_idx > 0 and samples:
                prev = samples[-1]
                step_d = haversine_distance(prev["latitude"], prev["longitude"], lat, lon)
                dist = cumulative_distance + step_d
                
            # If time offset is provided, use it, else default to index * 2 seconds
            time_offset = row_idx * 2
            if col_indices['time_offset'] is not None and row[col_indices['time_offset']]:
                val = row[col_indices['time_offset']]
                try:
                    time_offset = int(float(val))
                except ValueError:
                    # If it's a datetime string, parse it
                    try:
                        # Try parsing as ISO format or standard date format
                        dt = datetime.fromisoformat(val.replace('Z', '+00:00'))
                        if row_idx == 0:
                            start_time_str = dt.strftime("%Y-%m-%d %H:%M:%S")
                            time_offset = 0
                        else:
                            # calculate offset from start_time
                            start_dt = datetime.strptime(start_time_str, "%Y-%m-%d %H:%M:%S")
                            dt_naive = dt.replace(tzinfo=None)
                            time_offset = int((dt_naive - start_dt).total_seconds())
                    except:
                        pass

            samples.append({
                "time_offset": time_offset,
                "latitude": lat,
                "longitude": lon,
                "elevation": round(ele, 1),
                "heart_rate": hr,
                "speed": round(speed, 2),
                "distance": round(dist, 1)
            })
            cumulative_distance = dist
            
        except Exception as e:
            # Skip invalid rows
            continue
            
    if not samples:
        raise ValueError("No valid GPS records found in CSV file.")
        
    # Calculate speed if not present or all 0
    if sum(s["speed"] for s in samples) == 0.0:
        for i in range(1, len(samples)):
            dt = samples[i]["time_offset"] - samples[i-1]["time_offset"]
            dd = samples[i]["distance"] - samples[i-1]["distance"]
            if dt > 0:
                samples[i]["speed"] = round(dd / dt, 2)
            else:
                samples[i]["speed"] = samples[i-1]["speed"]
        if len(samples) > 1:
            samples[0]["speed"] = samples[1]["speed"]
            
    total_duration = samples[-1]["time_offset"]
    total_dist = samples[-1]["distance"]
    avg_hr = sum(s["heart_rate"] for s in samples) / len(samples)
    
    return {
        "activity_id": f"csv_{int(datetime.now().timestamp())}",
        "name": f"Imported CSV Run ({round(total_dist/1000.0, 1)}km)",
        "start_time": start_time_str,
        "distance_m": total_dist,
        "duration_seconds": total_duration,
        "average_hr": round(avg_hr, 1),
        "max_hr": max([s["heart_rate"] for s in samples]),
        "average_speed_m_s": round(total_dist / total_duration, 2) if total_duration > 0 else 0.0,
        "calories": int(total_dist * 0.07),
        "samples": samples,
        "is_mock": False
    }


def parse_duration_str(duration_str: str) -> int:
    try:
        parts = duration_str.split(':')
        if len(parts) == 3:
            h = int(parts[0])
            m = int(parts[1])
            s = float(parts[2])
            return int(h * 3600 + m * 60 + s)
        elif len(parts) == 2:
            m = int(parts[0])
            s = float(parts[1])
            return int(m * 60 + s)
        return int(float(duration_str))
    except:
        return 1800


def parse_summary_csv(file_content: bytes) -> List[Dict[str, Any]]:
    """Parse activities from a Garmin summary export CSV."""
    import csv
    import io
    import math
    from datetime import datetime
    
    text = file_content.decode('utf-8', errors='ignore')
    reader = csv.reader(io.StringIO(text))
    
    rows = list(reader)
    if not rows:
        raise ValueError("CSV file is empty")
        
    headers = [h.strip().lower() for h in rows[0]]
    
    # Map Swedish/English headers
    header_map = {
        'type': ['aktivitetstyp', 'activity type', 'typ'],
        'date': ['datum', 'date', 'starttid'],
        'name': ['namn', 'name', 'titel'],
        'distance': ['distans', 'distance', 'sträcka'],
        'calories': ['kalorier', 'calories', 'energiförbrukning'],
        'duration': ['tid', 'time', 'total tid', 'varaktighet'],
        'avg_hr': ['medelpuls', 'average hr', 'medel hr', 'puls medel'],
        'max_hr': ['maxpuls', 'max hr', 'max hr', 'puls max']
    }
    
    indices = {}
    for key, aliases in header_map.items():
        indices[key] = None
        for alias in aliases:
            if alias in headers:
                indices[key] = headers.index(alias)
                break
                
    if indices['date'] is None or indices['distance'] is None or indices['duration'] is None:
        raise ValueError("CSV summary must contain at least Date, Distance, and Duration columns.")
        
    activities = []
    
    # Base coordinates for Trollhättan loop (swedish runs in dataset are there)
    base_lat = 58.288
    base_lon = 12.307
    
    for row_idx, row in enumerate(rows[1:]):
        if not row or len(row) <= max(idx for idx in indices.values() if idx is not None):
            continue
            
        try:
            # Check type - default to Running if Löpning
            act_type = row[indices['type']] if indices['type'] is not None else "Löpning"
            if act_type not in ["Löpning", "Löpband", "Gång", "Running", "Treadmill", "Walking", "Walk", "Run"]:
                # Filter only running/walking related activities
                continue
            
            # Clean distance (handle quotes and replace comma with dot)
            dist_str = row[indices['distance']].replace('"', '').replace(',', '.').strip()
            dist_km = float(dist_str)
            dist_m = dist_km * 1000.0
            if dist_m <= 0.0:
                continue
            
            # Parse duration
            dur_str = row[indices['duration']].replace('"', '').strip()
            duration_secs = parse_duration_str(dur_str)
            if duration_secs <= 0:
                continue
            
            # Parse date
            date_str = row[indices['date']].replace('"', '').strip()
            
            # Parse Name
            name = row[indices['name']] if indices['name'] is not None else f"Imported Run"
            name = name.replace('"', '').strip()
            if not name:
                name = f"Imported {act_type}"
                
            # Parse HR
            avg_hr = 135
            if indices['avg_hr'] is not None and row[indices['avg_hr']]:
                val = row[indices['avg_hr']].replace('--', '').replace(',', '.').strip()
                if val:
                    avg_hr = int(float(val))
                    
            max_hr = 160
            if indices['max_hr'] is not None and row[indices['max_hr']]:
                val = row[indices['max_hr']].replace('--', '').replace(',', '.').strip()
                if val:
                    max_hr = int(float(val))
                    
            calories = int(dist_m * 0.07)
            if indices['calories'] is not None and row[indices['calories']]:
                val = row[indices['calories']].replace('"', '').replace(',', '.').strip()
                if val:
                    calories = int(float(val))
                    
            # Generate Mock Telemetry Samples for this activity to allow it to render in UI
            samples = []
            num_samples = 100
            step_time = duration_secs / num_samples
            step_dist = dist_m / num_samples
            
            # Generate a loop path starting at base coordinates
            # Loop radius depends on distance: 2 * pi * r = dist_m  =>  r = dist_m / (2 * pi)
            r_deg_lat = (dist_m / 6.28) / 111000.0
            r_deg_lon = (dist_m / 6.28) / (111000.0 * math.cos(math.radians(base_lat)))
            
            for i in range(num_samples):
                angle = (i / num_samples) * 2.0 * math.pi
                lat = base_lat + r_deg_lat * math.sin(angle)
                lon = base_lon + r_deg_lon * (math.cos(angle) - 1.0) # start/end at base point
                
                # Mock HR profile with slight drift
                hr_val = avg_hr
                if i < 15:
                    hr_val = avg_hr - (15 - i) * 1.5
                else:
                    hr_val = avg_hr + (i * 0.05) - 2.5
                hr_val = max(90, min(max_hr, hr_val))
                
                # Mock Speed profile (m/s)
                sample_speed = dist_m / duration_secs
                speed_val = sample_speed + 0.2 * math.sin(i * 0.1)
                
                samples.append({
                    "time_offset": int(i * step_time),
                    "latitude": lat,
                    "longitude": lon,
                    "elevation": 45.0 + 5.0 * math.sin(i * 0.15),
                    "heart_rate": int(hr_val),
                    "speed": round(speed_val, 2),
                    "distance": round(i * step_dist, 1)
                })
                
            try:
                dt_obj = datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S')
                ts = int(dt_obj.timestamp())
            except:
                ts = int(datetime.now().timestamp())
                
            activity_id = f"csv_summary_{ts}_{row_idx}"
            
            activities.append({
                "activity_id": activity_id,
                "name": name,
                "start_time": date_str,
                "distance_m": dist_m,
                "duration_seconds": duration_secs,
                "average_hr": round(avg_hr, 1),
                "max_hr": max_hr,
                "average_speed_m_s": round(dist_m / duration_secs, 2) if duration_secs > 0 else 0.0,
                "calories": calories,
                "samples": samples,
                "is_mock": False
            })
        except Exception as e:
            continue
            
    return activities


@app.post("/api/upload")
async def upload_run(file: UploadFile = File(...)):
    """Upload a raw Garmin .fit, .gpx, .tcx, or .csv file."""
    content = await file.read()
    filename = file.filename.lower()

    activity_data = None

    if filename.endswith(".tcx") or filename.endswith(".gpx"):
        try:
            activity_data = parse_tcx_file(content)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse XML file: {str(e)}")

    elif filename.endswith(".csv"):
        try:
            # Check if summary CSV by scanning the first line
            first_line = content.decode('utf-8', errors='ignore').split('\n')[0].lower()
            if "aktivitetstyp" in first_line or "activity type" in first_line:
                parsed_list = parse_summary_csv(content)
                imported_count = 0
                for act_data in parsed_list:
                    # Save to local server data storage
                    save_path = os.path.join(DATA_DIR, f"{act_data['activity_id']}.json")
                    with open(save_path, "w") as f:
                        json.dump(act_data, f, indent=2)
                    imported_count += 1
                return JSONResponse(content={"success": True, "message": f"Successfully imported {imported_count} activities from CSV summary.", "synced": imported_count})
            else:
                activity_data = parse_csv_file(content)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse CSV file: {str(e)}")

    elif filename.endswith(".fit"):
        if not HAS_FITPARSE:
            raise HTTPException(status_code=501, detail="FIT file parser (fitparse) is not installed on the system.")
        try:
            fitfile = fitparse.FitFile(content)
            samples = []
            start_time = datetime.now()
            
            cumulative_dist = 0.0
            
            for record in fitfile.get_messages('record'):
                # Extract coordinates, heart rate, speed, elevation
                values = record.get_values()
                
                lat = values.get('position_lat')
                lon = values.get('position_long')
                ele = values.get('altitude')
                hr = values.get('heart_rate')
                speed = values.get('speed')
                dist = values.get('distance')
                timestamp = values.get('timestamp')

                if lat is None or lon is None:
                    continue

                # Garmin coordinate semi-circles to degrees convert
                lat_deg = lat * (180.0 / 2**31)
                lon_deg = lon * (180.0 / 2**31)
                
                if idx == 0 and timestamp:
                    start_time = timestamp
                
                offset = int((timestamp - start_time).total_seconds()) if timestamp else len(samples)*2

                samples.append({
                    "time_offset": offset,
                    "latitude": lat_deg,
                    "longitude": lon_deg,
                    "elevation": round(ele, 1) if ele is not None else 0.0,
                    "heart_rate": int(hr) if hr is not None else 130,
                    "speed": round(speed, 2) if speed is not None else 0.0,
                    "distance": round(dist, 1) if dist is not None else cumulative_dist
                })
                if dist is not None:
                    cumulative_dist = dist

            if not samples:
                raise HTTPException(status_code=400, detail="No trackpoint GPS records found in FIT file.")

            total_dist = samples[-1]["distance"]
            total_duration = samples[-1]["time_offset"]
            avg_hr = sum(s["heart_rate"] for s in samples) / len(samples)
            
            activity_data = {
                "activity_id": f"fit_{int(datetime.now().timestamp())}",
                "name": f"Uploaded FIT Run ({round(total_dist/1000.0, 1)}km)",
                "start_time": start_time.strftime("%Y-%m-%d %H:%M:%S"),
                "distance_m": total_dist,
                "duration_seconds": total_duration,
                "average_hr": round(avg_hr, 1),
                "max_hr": max([s["heart_rate"] for s in samples]),
                "average_speed_m_s": round(total_dist / total_duration, 2) if total_duration > 0 else 0.0,
                "calories": int(total_dist * 0.07),
                "samples": samples,
                "is_mock": False
            }

        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse binary FIT file: {str(e)}")

    else:
        raise HTTPException(status_code=400, detail="Unsupported file format. Please upload .fit, .gpx, .tcx, or .csv files.")

    if activity_data:
        # Save to local server data storage
        save_path = os.path.join(DATA_DIR, f"{activity_data['activity_id']}.json")
        with open(save_path, "w") as f:
            json.dump(activity_data, f, indent=2)

        return JSONResponse(content={"success": True, "activity": activity_data})

    raise HTTPException(status_code=500, detail="Internal file processing error.")


@app.post("/api/garmin/login")
def login_garmin(req: GarminLoginRequest):
    """Authenticate with Garmin Connect and pull the latest 10 runs."""
    # Since garminconnect uses real credentials, we will perform a safe attempt.
    # Because Cloudflare blocks standard headless/scraping clients in standard servers,
    # we return a simulated success if we fail, allowing seamless fallbacks.
    try:
        from garminconnect import Garmin
        client = Garmin(req.email, req.password)
        client.login()
        
        # Fetch last 100 activities to sync more historical runs
        fetched = client.get_activities(0, 100)

        synced_count = 0
        
        for act in fetched:
            activity_id = str(act.get("activityId"))
            # We filter only running activities
            activity_type = act.get("activityType", {}).get("typeKey", "")
            if activity_type != "running":
                continue
                
            # If already exists, skip
            save_path = os.path.join(DATA_DIR, f"garmin_{activity_id}.json")
            if os.path.exists(save_path):
                continue
            
            # Request detailed fit/gpx or telemetry summary
            # Unofficial library allows fetching activity details or streams
            try:
                # Fetch activity splits/streams
                splits = client.get_activity_splits(activity_id)
                # Map splits to our sample scheme
                samples = []
                # Simple path reconstruct or sample download
                # Fallback to GPX track downloader built in garminconnect
                gpx_data = client.download_activity(activity_id, dl_fmt=client.ActivityDownloadFormat.GPX)
                
                # Parse GPX XML
                parsed = parse_tcx_file(gpx_data) # our parser removes namespace and extracts trackpoints
                parsed["activity_id"] = f"garmin_{activity_id}"
                parsed["name"] = act.get("activityName", "Garmin Run")
                
                with open(save_path, "w") as f:
                    json.dump(parsed, f, indent=2)
                synced_count += 1
            except Exception as inner:
                print(f"Failed to fetch splits for {activity_id}: {inner}")
                # We can save a minimal wrapper if full GPX stream download fails
                
        return JSONResponse(content={"success": True, "synced": synced_count})
        
    except Exception as e:
        # Graceful return with explanation - since Cloudflare challenges occur, direct scraper sync is brittle.
        return JSONResponse(status_code=400, content={
            "success": False, 
            "error": str(e),
            "message": "Garmin login failed (likely MFA, Cloudflare protection, or wrong password). Feel free to import FIT/GPX files directly instead!"
        })


# Bind index.html and assets
app.mount("/", StaticFiles(directory=os.path.dirname(__file__), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8080, reload=True)
