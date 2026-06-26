/**
 * Garmin Analyzer - Map module
 * Handles all Leaflet map drawing, track renderings, and gradients
 */

export class GarminMap {
    constructor(mapId) {
        this.mapId = mapId;
        this.map = null;
        this.segmentsGroup = null;
        this.comparisonSegmentsGroup = null;
        this.indicatorMarker = null;
        this.comparisonIndicatorMarker = null;
        this.points = [];
        this.comparisonPoints = [];
        this.initMap();
    }

    initMap() {
        // Initialize map centered on Seattle (default mock start)
        this.map = L.map(this.mapId, {
            zoomControl: false
        }).setView([47.6062, -122.3321], 13);

        // Standard modern dark tile layer (sleek aesthetics)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
        }).addTo(this.map);

        L.control.zoom({
            position: 'bottomright'
        }).addTo(this.map);

        this.segmentsGroup = L.featureGroup().addTo(this.map);
        this.comparisonSegmentsGroup = L.featureGroup().addTo(this.map);
    }

    /**
     * Map Heart Rate to a vibrant gradient color (Cool Blue -> Neon Red)
     */
    getColorForHeartRate(hr) {
        // Safe boundaries
        const minHr = 110;
        const maxHr = 185;
        const ratio = Math.max(0, Math.min(1, (hr - minHr) / (maxHr - minHr)));
        
        // Return vibrant HSL gradient
        // Low: HSL 200 (Sky Blue) -> Medium: HSL 100 (Green) -> High: HSL 0 (Neon Red)
        const hue = (1 - ratio) * 200;
        return `hsl(${hue}, 100%, 55%)`;
    }

    /**
     * Map speed to a vibrant color (Red [slow] -> Neon Green [fast])
     */
    getColorForSpeed(speed) {
        // speed in m/s (2 m/s = 8:20/km [slow], 5.5 m/s = 3:00/km [very fast])
        const minSpeed = 2.0;
        const maxSpeed = 5.0;
        const ratio = Math.max(0, Math.min(1, (speed - minSpeed) / (maxSpeed - minSpeed)));
        
        const hue = ratio * 120; // 0 (Red) to 120 (Green)
        return `hsl(${hue}, 95%, 50%)`;
    }

    /**
     * Render the route path with a specific telemetry gradient
     * @param {Array} samples - Continuous telemetry samples
     * @param {string} mode - 'heart_rate' or 'speed'
     */
    drawTrack(samples, mode = 'heart_rate') {
        this.clearTrack();
        if (!samples || samples.length === 0) return;

        this.points = samples;
        const latLngs = [];

        // Draw segmented polylines to represent the visual gradient
        for (let i = 0; i < samples.length - 1; i++) {
            const p1 = samples[i];
            const p2 = samples[i + 1];

            const coords = [
                [p1.latitude, p1.longitude],
                [p2.latitude, p2.longitude]
            ];

            latLngs.push(coords[0]);

            let color;
            if (mode === 'speed') {
                const avgSpeed = (p1.speed + p2.speed) / 2;
                color = this.getColorForSpeed(avgSpeed);
            } else {
                const avgHr = (p1.heart_rate + p2.heart_rate) / 2;
                color = this.getColorForHeartRate(avgHr);
            }

            L.polyline(coords, {
                color: color,
                weight: 6,
                opacity: 0.85,
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(this.segmentsGroup);
        }

        // Add start and end icons
        const startPt = samples[0];
        const endPt = samples[samples.length - 1];

        L.circleMarker([startPt.latitude, startPt.longitude], {
            radius: 8,
            color: '#10b981',
            fillColor: '#10b981',
            fillOpacity: 1,
            weight: 2
        }).addTo(this.segmentsGroup).bindTooltip("Start");

        L.circleMarker([endPt.latitude, endPt.longitude], {
            radius: 8,
            color: '#ef4444',
            fillColor: '#ef4444',
            fillOpacity: 1,
            weight: 2
        }).addTo(this.segmentsGroup).bindTooltip("End");

        // Fit map view to path
        if (latLngs.length > 0) {
            this.map.fitBounds(L.latLngBounds(latLngs), { padding: [40, 40] });
        }
    }

    /**
     * Render a comparison route path with a styled dashed/semi-transparent overlay
     */
    drawComparisonTrack(samples, mode = 'heart_rate') {
        this.clearComparisonTrack();
        if (!samples || samples.length === 0) return;

        this.comparisonPoints = samples;
        const latLngs = [];

        // Draw segmented polylines with dashed style and lower opacity for the comparison track
        for (let i = 0; i < samples.length - 1; i++) {
            const p1 = samples[i];
            const p2 = samples[i + 1];

            const coords = [
                [p1.latitude, p1.longitude],
                [p2.latitude, p2.longitude]
            ];

            latLngs.push(coords[0]);

            let color;
            if (mode === 'speed') {
                const avgSpeed = (p1.speed + p2.speed) / 2;
                color = this.getColorForSpeed(avgSpeed);
            } else {
                const avgHr = (p1.heart_rate + p2.heart_rate) / 2;
                color = this.getColorForHeartRate(avgHr);
            }

            L.polyline(coords, {
                color: color,
                weight: 4,
                opacity: 0.45,
                dashArray: '5, 8',
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(this.comparisonSegmentsGroup);
        }

        // Add comparison start/end markers
        const startPt = samples[0];
        const endPt = samples[samples.length - 1];

        L.circleMarker([startPt.latitude, startPt.longitude], {
            radius: 5,
            color: '#10b981',
            fillColor: '#10b981',
            fillOpacity: 0.5,
            weight: 1
        }).addTo(this.comparisonSegmentsGroup).bindTooltip("Comparison Start");

        L.circleMarker([endPt.latitude, endPt.longitude], {
            radius: 5,
            color: '#ef4444',
            fillColor: '#ef4444',
            fillOpacity: 0.5,
            weight: 1
        }).addTo(this.comparisonSegmentsGroup).bindTooltip("Comparison End");

        // Fit map bounds to encompass both tracks if needed
        if (this.points.length > 0) {
            const allLatLngs = this.points.concat(samples).map(s => [s.latitude, s.longitude]);
            this.map.fitBounds(L.latLngBounds(allLatLngs), { padding: [40, 40] });
        } else if (latLngs.length > 0) {
            this.map.fitBounds(L.latLngBounds(latLngs), { padding: [40, 40] });
        }
    }

    /**
     * Clear all current tracks and markers
     */
    clearTrack() {
        this.segmentsGroup.clearLayers();
        if (this.indicatorMarker) {
            this.indicatorMarker.remove();
            this.indicatorMarker = null;
        }
        this.points = [];
    }

    /**
     * Clear the comparison track layers
     */
    clearComparisonTrack() {
        this.comparisonSegmentsGroup.clearLayers();
        if (this.comparisonIndicatorMarker) {
            this.comparisonIndicatorMarker.remove();
            this.comparisonIndicatorMarker = null;
        }
        this.comparisonPoints = [];
    }

    /**
     * Position a glowing marker at a specific index to show slide-replays
     */
    updateHoverIndicator(index, comparisonIndex = null) {
        if (this.points && this.points.length > 0) {
            const pt = this.points[Math.min(index, this.points.length - 1)];
            if (pt) {
                const latlng = [pt.latitude, pt.longitude];

                if (!this.indicatorMarker) {
                    this.indicatorMarker = L.circleMarker(latlng, {
                        radius: 10,
                        color: '#a855f7',
                        fillColor: '#ffffff',
                        fillOpacity: 0.9,
                        weight: 4,
                        className: 'glow-marker'
                    }).addTo(this.map);
                } else {
                    this.indicatorMarker.setLatLng(latlng);
                }
            }
        }

        if (comparisonIndex !== null && this.comparisonPoints && this.comparisonPoints.length > 0) {
            const pt = this.comparisonPoints[Math.min(comparisonIndex, this.comparisonPoints.length - 1)];
            if (pt) {
                const latlng = [pt.latitude, pt.longitude];

                if (!this.comparisonIndicatorMarker) {
                    this.comparisonIndicatorMarker = L.circleMarker(latlng, {
                        radius: 8,
                        color: '#06b6d4',
                        fillColor: '#ffffff',
                        fillOpacity: 0.9,
                        weight: 3,
                        className: 'glow-marker'
                    }).addTo(this.map);
                } else {
                    this.comparisonIndicatorMarker.setLatLng(latlng);
                }
            }
        } else if (this.comparisonIndicatorMarker) {
            this.comparisonIndicatorMarker.remove();
            this.comparisonIndicatorMarker = null;
        }
    }
}
