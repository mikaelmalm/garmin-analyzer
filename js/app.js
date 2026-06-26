/**
 * Garmin Analyzer - Main application coordinator
 * Connects the API, Maps, and Charts modules into a unified dashboard
 */

import { GarminAPI } from './api.js';
import { GarminMap } from './maps.js';
import { GarminCharts } from './charts.js';

class GarminAnalyzerApp {
    constructor() {
        this.api = new GarminAPI();
        this.map = null;
        this.charts = null;
        
        // App State
        this.routes = [];
        this.selectedRoute = null;
        this.selectedActivity = null;
        this.isCompareMode = false;
        this.compareActivity = null;
        this.mapMode = 'heart_rate'; // 'heart_rate' or 'speed'

        this.init();
    }

    async init() {
        // Wait for DOM
        document.addEventListener("DOMContentLoaded", () => {
            this.initModules();
            this.bindUIEvents();
            this.loadDashboardData();
        });
    }

    initModules() {
        // Initialize Map
        this.map = new GarminMap('map-container');

        // Initialize Charts with link back to Map hover/scrub indicator
        this.charts = new GarminCharts(
            'progress-chart', 
            'telemetry-chart',
            (index, comparisonIndex) => {
                this.map.updateHoverIndicator(index, comparisonIndex);
                this.updateTelemetryTooltipOverlay(index, comparisonIndex);
            }
        );
    }

    bindUIEvents() {
        // Map Color Toggle Buttons
        const btnHr = document.getElementById('btn-map-hr');
        const btnSpeed = document.getElementById('btn-map-speed');
        
        if (btnHr && btnSpeed) {
            btnHr.addEventListener('click', () => {
                this.mapMode = 'heart_rate';
                btnHr.classList.add('active');
                btnSpeed.classList.remove('active');
                this.refreshTrackRendering();
            });

            btnSpeed.addEventListener('click', () => {
                this.mapMode = 'speed';
                btnSpeed.classList.add('active');
                btnHr.classList.remove('active');
                this.refreshTrackRendering();
            });
        }

        // Upload files drag & drop
        const dropzone = document.getElementById('upload-dropzone');
        const fileInput = document.getElementById('file-input');

        if (dropzone && fileInput) {
            dropzone.addEventListener('click', () => fileInput.click());
            
            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.classList.add('dragover');
            });

            dropzone.addEventListener('dragleave', () => {
                dropzone.classList.remove('dragover');
            });

            dropzone.addEventListener('drop', async (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
                if (e.dataTransfer.files.length > 0) {
                    await this.handleFileUpload(e.dataTransfer.files[0]);
                }
            });

            fileInput.addEventListener('change', async () => {
                if (fileInput.files.length > 0) {
                    await this.handleFileUpload(fileInput.files[0]);
                }
            });
        }

        // Garmin sync credentials form
        const syncForm = document.getElementById('garmin-sync-form');
        const syncStatus = document.getElementById('sync-status-msg');

        if (syncForm) {
            syncForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('garmin-email').value;
                const password = document.getElementById('garmin-password').value;
                const syncBtn = syncForm.querySelector('button[type="submit"]');

                if (!email || !password) return;

                syncBtn.disabled = true;
                syncBtn.innerHTML = '<span class="spinner"></span> Syncing...';
                syncStatus.className = 'status-info';
                syncStatus.textContent = "Connecting to Garmin... This may take up to a minute.";

                try {
                    const result = await this.api.loginAndSync(email, password);
                    syncStatus.className = 'status-success';
                    syncStatus.textContent = `Sync successful! Imported ${result.synced} runs.`;
                    
                    // Reload data
                    await this.loadDashboardData();
                } catch (err) {
                    syncStatus.className = 'status-error';
                    syncStatus.textContent = err.message || "Failed to sync. Please verify credentials or upload files directly.";
                } finally {
                    syncBtn.disabled = false;
                    syncBtn.textContent = 'Sync Garmin Account';
                }
            });
        }

        // Help Modal controllers
        const modalToggle = document.getElementById('toggle-sync-modal');
        const modalClose = document.getElementById('close-sync-modal');
        const modal = document.getElementById('sync-modal');

        if (modalToggle && modalClose && modal) {
            modalToggle.addEventListener('click', () => modal.classList.add('visible'));
            modalClose.addEventListener('click', () => modal.classList.remove('visible'));
            // Click outside modal closing
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.remove('visible');
            });
        }

        // Compare Mode Event Listeners
        const compareToggle = document.getElementById('compare-mode-toggle');
        const compareSelectorGroup = document.getElementById('compare-selector-group');
        const compareSelector = document.getElementById('compare-runs-selector');

        if (compareToggle && compareSelectorGroup && compareSelector) {
            compareToggle.addEventListener('change', (e) => {
                this.isCompareMode = e.target.checked;
                if (this.isCompareMode) {
                    compareSelectorGroup.style.display = 'flex';
                    this.populateCompareRunsSelector();
                } else {
                    compareSelectorGroup.style.display = 'none';
                    this.compareActivity = null;
                    this.map.clearComparisonTrack();
                    this.refreshTrackRendering();
                    this.refreshHUDStats();
                    if (this.selectedActivity) {
                        this.charts.renderTelemetry(this.selectedActivity.samples);
                    }
                }
            });

            compareSelector.addEventListener('change', () => {
                const activities = this.selectedRoute ? this.selectedRoute.activities : [];
                const selectedComp = activities.find(a => a.activity_id === compareSelector.value);
                if (selectedComp) {
                    this.selectComparisonActivity(selectedComp);
                } else {
                    this.compareActivity = null;
                    this.map.clearComparisonTrack();
                    this.refreshTrackRendering();
                    this.refreshHUDStats();
                    if (this.selectedActivity) {
                        this.charts.renderTelemetry(this.selectedActivity.samples);
                    }
                }
            });
        }
    }

    async loadDashboardData() {
        // 1. Try loading cached routes from localStorage for instant display
        const cached = localStorage.getItem('garmin_dashboard_routes');
        if (cached) {
            try {
                this.routes = JSON.parse(cached);
                this.renderRouteSidebar();
                if (this.routes.length > 0) {
                    const previousRouteId = this.selectedRoute ? this.selectedRoute.id : null;
                    const match = this.routes.find(r => r.id === previousRouteId) || this.routes[0];
                    this.selectRoute(match);
                }
            } catch (err) {
                console.error("Failed to parse cached routes:", err);
            }
        }

        // 2. Fetch fresh metrics from backend in background
        try {
            const data = await this.api.fetchRoutes();
            this.routes = data.routes || [];
            
            // Update cache safely
            try {
                localStorage.setItem('garmin_dashboard_routes', JSON.stringify(this.routes));
            } catch (cacheError) {
                console.warn("Failed to cache routes (likely due to size limits):", cacheError);
            }
            
            this.renderRouteSidebar();

            if (this.routes.length > 0) {
                const previousRouteId = this.selectedRoute ? this.selectedRoute.id : null;
                const match = this.routes.find(r => r.id === previousRouteId) || this.routes[0];
                this.selectRoute(match);
            }
        } catch (error) {
            console.error("Dashboard background sync failed:", error);
        }
    }


    renderRouteSidebar() {
        const listContainer = document.getElementById('routes-list');
        if (!listContainer) return;

        listContainer.innerHTML = '';

        this.routes.forEach(route => {
            const item = document.createElement('div');
            item.className = `route-sidebar-card ${this.selectedRoute?.id === route.id ? 'active' : ''}`;
            
            // Format average pace (sec/km to mm:ss)
            const paceMins = Math.floor(route.average_pace_sec / 60);
            const paceSecs = Math.round(route.average_pace_sec % 60);
            const paceStr = `${paceMins}:${paceSecs < 10 ? '0' : ''}${paceSecs}/km`;

            item.innerHTML = `
                <div class="route-info-header">
                    <h4>${route.name}</h4>
                    <span class="badge">${route.runs_count} runs</span>
                </div>
                <div class="route-metrics-grid">
                    <div>
                        <span class="label">Distance</span>
                        <span class="val">${(route.distance_m / 1000.0).toFixed(2)} km</span>
                    </div>
                    <div>
                        <span class="label">Avg Pace</span>
                        <span class="val">${paceStr}</span>
                    </div>
                    <div>
                        <span class="label">Avg HR</span>
                        <span class="val">${Math.round(route.average_hr)} bpm</span>
                    </div>
                </div>
            `;

            item.addEventListener('click', () => this.selectRoute(route));
            listContainer.appendChild(item);
        });
    }

    selectRoute(route) {
        this.selectedRoute = route;
        
        // Highlight in sidebar
        const listItems = document.getElementById('routes-list').children;
        this.routes.forEach((r, idx) => {
            if (listItems[idx]) {
                if (r.id === route.id) {
                    listItems[idx].classList.add('active');
                } else {
                    listItems[idx].classList.remove('active');
                }
            }
        });

        // Update Track Statistics View
        document.getElementById('track-title').textContent = route.name;

        // Reset compare checkbox on new route selection
        const compareToggle = document.getElementById('compare-mode-toggle');
        if (compareToggle) {
            compareToggle.checked = false;
            this.isCompareMode = false;
            const compareSelectorGroup = document.getElementById('compare-selector-group');
            if (compareSelectorGroup) compareSelectorGroup.style.display = 'none';
        }
        this.compareActivity = null;
        this.map.clearComparisonTrack();

        // Render Route Historical Progress Chart
        this.charts.renderProgress(route.activities || []);

        // Populate Runs list dropdown/selector for detailed comparison
        this.populateRunsSelector(route.activities || []);
    }

    populateRunsSelector(activities) {
        const selector = document.getElementById('runs-selector');
        if (!selector) return;

        selector.innerHTML = '';
        
        // Sort chronologically (newest first for selector)
        const sorted = Array.isArray(activities) ? [...activities].reverse() : [];

        sorted.forEach((run, idx) => {
            const option = document.createElement('option');
            option.value = run.activity_id;
            
            const dt = new Date(run.start_time);
            const dateStr = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const paceMins = Math.floor((run.duration_seconds / (run.distance_m / 1000)) / 60);
            const paceSecs = Math.round((run.duration_seconds / (run.distance_m / 1000)) % 60);
            const paceStr = `${paceMins}:${paceSecs < 10 ? '0' : ''}${paceSecs}/km`;
            
            option.textContent = `${dateStr} — Pace: ${paceStr} (HR: ${Math.round(run.average_hr)} bpm)`;
            selector.appendChild(option);
        });

        // Change handler
        selector.onchange = () => {
            const activitiesList = activities || [];
            const selectedAct = activitiesList.find(a => a.activity_id === selector.value);
            if (selectedAct) {
                this.selectActivity(selectedAct);
                if (this.isCompareMode) {
                    this.populateCompareRunsSelector();
                }
            }
        };

        // Preselect newest activity
        if (sorted.length > 0) {
            this.selectActivity(sorted[0]);
        }
    }

    populateCompareRunsSelector() {
        const compareSelector = document.getElementById('compare-runs-selector');
        if (!compareSelector || !this.selectedRoute) return;

        compareSelector.innerHTML = '';
        
        const activeId = this.selectedActivity ? this.selectedActivity.activity_id : null;
        const activities = this.selectedRoute.activities || [];
        const sorted = Array.isArray(activities) ? [...activities].reverse() : [];

        let firstOption = document.createElement('option');
        firstOption.textContent = "Select run to compare...";
        firstOption.value = "";
        compareSelector.appendChild(firstOption);

        let validCompareRuns = sorted.filter(run => run.activity_id !== activeId);

        validCompareRuns.forEach(run => {
            const option = document.createElement('option');
            option.value = run.activity_id;
            
            const dt = new Date(run.start_time);
            const dateStr = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const paceMins = Math.floor((run.duration_seconds / (run.distance_m / 1000)) / 60);
            const paceSecs = Math.round((run.duration_seconds / (run.distance_m / 1000)) % 60);
            const paceStr = `${paceMins}:${paceSecs < 10 ? '0' : ''}${paceSecs}/km`;
            
            option.textContent = `${dateStr} — Pace: ${paceStr} (HR: ${Math.round(run.average_hr)} bpm)`;
            compareSelector.appendChild(option);
        });

        // Pre-select the second newest run if possible
        if (validCompareRuns.length > 0) {
            const preSelected = validCompareRuns[0];
            compareSelector.value = preSelected.activity_id;
            this.selectComparisonActivity(preSelected);
        }
    }

    selectActivity(activity) {
        this.selectedActivity = activity;
        
        // Render map tracks, HUD, & telemetry graph
        this.refreshTrackRendering();
        this.refreshHUDStats();
        
        if (this.isCompareMode && this.compareActivity) {
            this.charts.renderTelemetry(activity.samples, this.compareActivity.samples);
        } else {
            this.charts.renderTelemetry(activity.samples);
        }

        // Reset hover HUD indicators
        const hud = document.getElementById('scrub-hud');
        if (hud) hud.classList.remove('active');
    }

    selectComparisonActivity(activity) {
        this.compareActivity = activity;
        this.refreshTrackRendering();
        this.refreshHUDStats();
        if (this.selectedActivity) {
            this.charts.renderTelemetry(this.selectedActivity.samples, activity.samples);
        }

        // Reset hover HUD indicators
        const hud = document.getElementById('scrub-hud');
        if (hud) hud.classList.remove('active');
    }

    refreshTrackRendering() {
        if (this.selectedActivity) {
            this.map.drawTrack(this.selectedActivity.samples, this.mapMode);
            if (this.isCompareMode && this.compareActivity) {
                this.map.drawComparisonTrack(this.compareActivity.samples, this.mapMode);
            }
        }
    }

    refreshHUDStats() {
        if (!this.selectedActivity) return;

        const runA = this.selectedActivity;
        const runB = this.compareActivity;

        // 1. Distance
        const distA = runA.distance_m / 1000.0;
        document.getElementById('stat-distance').textContent = `${distA.toFixed(2)} km`;
        this.updateCardCompareRow('hud-distance', distA, runB ? runB.distance_m / 1000.0 : null, 'km', true);

        // 2. Average Pace
        const paceSecsA = runA.duration_seconds / distA;
        const paceMinsA = Math.floor(paceSecsA / 60);
        const paceSecsRemainderA = Math.round(paceSecsA % 60);
        document.getElementById('stat-pace').textContent = `${paceMinsA}:${paceSecsRemainderA < 10 ? '0' : ''}${paceSecsRemainderA}/km`;
        
        const paceSecsB = runB ? (runB.duration_seconds / (runB.distance_m / 1000.0)) : null;
        this.updateCardCompareRow('hud-pace', paceSecsA, paceSecsB, '/km', false, true);

        // 3. Duration Comparison
        const labelBestPace = document.querySelector('#hud-best-pace .hud-label');
        if (labelBestPace) {
            labelBestPace.textContent = runB ? "Duration Comparison" : "Run Duration";
        }
        const formatTime = (secs) => {
            const h = Math.floor(secs / 3600);
            const m = Math.floor((secs % 3600) / 60);
            const s = Math.round(secs % 60);
            return `${h > 0 ? h + ':' : ''}${m < 10 && h > 0 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
        };
        document.getElementById('stat-best-pace').textContent = formatTime(runA.duration_seconds);
        this.updateCardCompareRow('hud-best-pace', runA.duration_seconds, runB ? runB.duration_seconds : null, '', false, true);

        // 4. Heart Rate
        document.getElementById('stat-hr').textContent = `${Math.round(runA.average_hr)} bpm`;
        this.updateCardCompareRow('hud-hr', runA.average_hr, runB ? runB.average_hr : null, 'bpm', false, true);
    }

    updateCardCompareRow(cardId, valA, valB, unit = '', isDistance = false, lowerIsBetter = false) {
        const card = document.getElementById(cardId);
        if (!card) return;

        // Remove existing comparison row if any
        const existingRow = card.querySelector('.hud-compare-row');
        if (existingRow) {
            existingRow.remove();
        }

        if (valB === null || valB === undefined) return;

        // Create new comparison row
        const row = document.createElement('div');
        row.className = 'hud-compare-row';

        let diff = valA - valB;
        let displayValB = '';
        let displayDelta = '';
        let badgeClass = 'neutral';

        // Formatting values
        if (cardId === 'hud-pace') {
            const formatPaceSecs = (totalSecs) => {
                const m = Math.floor(totalSecs / 60);
                const s = Math.round(totalSecs % 60);
                return `${m}:${s < 10 ? '0' : ''}${s}`;
            };
            displayValB = `${formatPaceSecs(valB)}${unit}`;
            const absDiff = Math.abs(diff);
            const diffSign = diff > 0 ? '+' : '-';
            displayDelta = `${diffSign}${formatPaceSecs(absDiff)}`;
        } else if (cardId === 'hud-best-pace') {
            const formatDuration = (totalSecs) => {
                const h = Math.floor(totalSecs / 3600);
                const m = Math.floor((totalSecs % 3600) / 60);
                const s = Math.round(totalSecs % 60);
                return `${h > 0 ? h + ':' : ''}${m < 10 && h > 0 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
            };
            displayValB = formatDuration(valB);
            const absDiff = Math.abs(diff);
            const diffSign = diff > 0 ? '+' : '-';
            displayDelta = `${diffSign}${formatDuration(absDiff)}`;
        } else {
            displayValB = `${valB.toFixed(isDistance ? 2 : 0)} ${unit}`;
            const diffSign = diff > 0 ? '+' : '';
            displayDelta = `${diffSign}${diff.toFixed(isDistance ? 2 : 0)} ${unit}`;
        }

        if (Math.abs(diff) < 0.01) {
            badgeClass = 'neutral';
            displayDelta = 'Equal';
        } else {
            const isBetter = lowerIsBetter ? diff < 0 : diff > 0;
            badgeClass = isBetter ? 'better' : 'worse';
        }

        row.innerHTML = `
            <span class="hud-compare-val">vs ${displayValB}</span>
            <span class="hud-delta-badge ${badgeClass}">${displayDelta}</span>
        `;
        card.appendChild(row);
    }

    updateTelemetryTooltipOverlay(index, comparisonIndex = null) {
        if (!this.selectedActivity || !this.selectedActivity.samples) return;
        const pt = this.selectedActivity.samples[index];
        if (!pt) return;

        const hud = document.getElementById('scrub-hud');
        if (!hud) return;

        hud.classList.add('active');

        // Convert speed to pace
        let paceStr = '--';
        if (pt.speed > 0.5) {
            const paceSec = 1000 / pt.speed;
            const mins = Math.floor(paceSec / 60);
            const secs = Math.round(paceSec % 60);
            paceStr = `${mins}:${secs < 10 ? '0' : ''}${secs}/km`;
        }

        // If compare mode is active and comparison index is provided
        if (this.isCompareMode && this.compareActivity && comparisonIndex !== null) {
            const compPt = this.compareActivity.samples[comparisonIndex];
            if (compPt) {
                let compPaceStr = '--';
                if (compPt.speed > 0.5) {
                    const compPaceSec = 1000 / compPt.speed;
                    const mins = Math.floor(compPaceSec / 60);
                    const secs = Math.round(compPaceSec % 60);
                    compPaceStr = `${mins}:${secs < 10 ? '0' : ''}${secs}/km`;
                }

                hud.innerHTML = `
                    <div class="hud-stat">
                        <span class="hud-label">DISTANCE</span>
                        <span class="hud-val">${(pt.distance / 1000.0).toFixed(2)} km <small style="color: var(--primary);">vs ${(compPt.distance / 1000.0).toFixed(2)}</small></span>
                    </div>
                    <div class="hud-stat">
                        <span class="hud-label">HEART RATE</span>
                        <span class="hud-val text-red">${pt.heart_rate} <small>bpm</small> <small style="color: var(--primary); font-weight: normal;">vs ${compPt.heart_rate}</small></span>
                    </div>
                    <div class="hud-stat">
                        <span class="hud-label">PACE</span>
                        <span class="hud-val text-cyan">${paceStr} <small style="color: var(--primary); font-weight: normal;">vs ${compPaceStr}</small></span>
                    </div>
                    <div class="hud-stat">
                        <span class="hud-label">ELEVATION</span>
                        <span class="hud-val">${pt.elevation} <small>m</small> <small style="color: var(--primary); font-weight: normal;">vs ${compPt.elevation}</small></span>
                    </div>
                `;
                return;
            }
        }

        // Default single run hud
        hud.innerHTML = `
            <div class="hud-stat">
                <span class="hud-label">DISTANCE</span>
                <span class="hud-val">${(pt.distance / 1000.0).toFixed(2)} km</span>
            </div>
            <div class="hud-stat">
                <span class="hud-label">HEART RATE</span>
                <span class="hud-val text-red">${pt.heart_rate} <small>bpm</small></span>
            </div>
            <div class="hud-stat">
                <span class="hud-label">PACE</span>
                <span class="hud-val text-cyan">${paceStr}</span>
            </div>
            <div class="hud-stat">
                <span class="hud-label">ELEVATION</span>
                <span class="hud-val">${pt.elevation} <small>m</small></span>
            </div>
        `;
    }

    async handleFileUpload(file) {
        const status = document.getElementById('upload-status-msg');
        if (status) {
            status.className = 'status-info';
            status.textContent = `Processing and analyzing ${file.name}...`;
        }

        try {
            await this.api.uploadFile(file);
            if (status) {
                status.className = 'status-success';
                status.textContent = `Successfully processed ${file.name}!`;
            }
            // Reload data
            await this.loadDashboardData();
        } catch (err) {
            if (status) {
                status.className = 'status-error';
                status.textContent = err.message || "Failed to parse file.";
            }
        }
    }
}

// Instantiate App
new GarminAnalyzerApp();
