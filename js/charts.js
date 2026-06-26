/**
 * Garmin Analyzer - Charts module
 * Handles progress graphs and telemetry timeseries charts
 */

export class GarminCharts {
    constructor(progressCanvasId, telemetryCanvasId, onTelemetryHover = null) {
        this.progressCanvasId = progressCanvasId;
        this.telemetryCanvasId = telemetryCanvasId;
        this.onTelemetryHover = onTelemetryHover; // Callback when scrubbing telemetry chart
        
        this.progressChart = null;
        this.telemetryChart = null;

        // Custom global Chart.js styling overrides for dark theme
        Chart.defaults.color = 'rgba(255, 255, 255, 0.7)';
        Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.1)';
        Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";
    }

    /**
     * Convert pace in seconds/km to readable MM:SS/km format
     */
    formatPace(secondsPerKm) {
        const mins = Math.floor(secondsPerKm / 60);
        const secs = Math.round(secondsPerKm % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}/km`;
    }

    /**
     * Render chronological improvements of runs within a specific track
     * @param {Array} activities - Array of sorted runs for a track
     */
    renderProgress(activities) {
        if (this.progressChart) {
            this.progressChart.destroy();
        }

        const ctx = document.getElementById(this.progressCanvasId).getContext('2d');
        if (!activities || activities.length === 0) {
            ctx.clearRect(0, 0, 500, 500);
            return;
        }

        const labels = activities.map(act => {
            const dt = new Date(act.start_time);
            return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
        });

        // average pace values in mins/km as decimals (for easy plotting)
        const paces = activities.map(act => {
            const paceSec = act.duration_seconds / (act.distance_m / 1000.0);
            return Math.round(paceSec); // store in seconds
        });

        const heartRates = activities.map(act => act.average_hr);

        this.progressChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Average Pace (sec/km)',
                        data: paces,
                        borderColor: '#10b981', // Neon Green
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 3,
                        pointRadius: 6,
                        pointBackgroundColor: '#10b981',
                        yAxisID: 'yPace',
                        tension: 0.35,
                        fill: true
                    },
                    {
                        label: 'Average Heart Rate (bpm)',
                        data: heartRates,
                        borderColor: '#a855f7', // Purple
                        backgroundColor: 'rgba(168, 85, 247, 0.05)',
                        borderWidth: 3,
                        pointRadius: 6,
                        pointBackgroundColor: '#a855f7',
                        yAxisID: 'yHr',
                        tension: 0.35,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 12 }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                if (context.datasetIndex === 0) {
                                    return `Avg Pace: ${this.formatPace(context.raw)}`;
                                }
                                return `Avg HR: ${context.raw} bpm`;
                            }
                        }
                    }
                },
                scales: {
                    yPace: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: 'Pace (MM:SS/km)', color: '#10b981' },
                        grid: { drawOnChartArea: true },
                        ticks: {
                            callback: (value) => this.formatPace(value)
                        }
                    },
                    yHr: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: 'Heart Rate (bpm)', color: '#a855f7' },
                        grid: { drawOnChartArea: false },
                        min: 120,
                        max: 190
                    }
                }
            }
        });
    }

    /**
     * Binary search helper to find the closest sample in targetSamples by distance
     */
    findClosestSampleByDistance(distance, targetSamples) {
        if (!targetSamples || targetSamples.length === 0) return null;
        let low = 0;
        let high = targetSamples.length - 1;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (targetSamples[mid].distance < distance) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        if (low > 0 && Math.abs(targetSamples[low - 1].distance - distance) < Math.abs(targetSamples[low].distance - distance)) {
            return targetSamples[low - 1];
        }
        return targetSamples[low];
    }

    /**
     * Find the index of the closest sample in targetSamples by distance
     */
    findClosestSampleIndexByDistance(distance, targetSamples) {
        if (!targetSamples || targetSamples.length === 0) return null;
        let low = 0;
        let high = targetSamples.length - 1;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (targetSamples[mid].distance < distance) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        if (low > 0 && Math.abs(targetSamples[low - 1].distance - distance) < Math.abs(targetSamples[low].distance - distance)) {
            return low - 1;
        }
        return low;
    }

    /**
     * Render the detailed continuous telemetry curve for a single run, and optionally overlay a comparison run
     * @param {Array} samples - Time series trackpoint samples for active run
     * @param {Array} comparisonSamples - Optional time series trackpoint samples for comparison run
     */
    renderTelemetry(samples, comparisonSamples = null) {
        if (this.telemetryChart) {
            this.telemetryChart.destroy();
        }

        const ctx = document.getElementById(this.telemetryCanvasId).getContext('2d');
        if (!samples || samples.length === 0) {
            ctx.clearRect(0, 0, 500, 500);
            return;
        }

        const distances = samples.map(s => (s.distance / 1000.0).toFixed(2));
        const heartRates = samples.map(s => s.heart_rate);
        const elevation = samples.map(s => s.elevation);
        
        // Convert active speed (m/s) to pace (sec/km)
        const paces = samples.map(s => {
            if (s.speed <= 0.5) return 999; // stationary limit
            const paceSec = 1000 / s.speed;
            return paceSec > 900 ? 900 : Math.round(paceSec); // cap at 15 mins/km
        });

        // Initialize datasets array
        const datasets = [
            {
                label: 'Active Elevation (m)',
                data: elevation,
                borderColor: 'rgba(255, 255, 255, 0.4)',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                borderWidth: 2,
                pointRadius: 0,
                yAxisID: 'yElevation',
                tension: 0.2,
                fill: true
            },
            {
                label: 'Active Pace (sec/km)',
                data: paces,
                borderColor: '#06b6d4', // Cyan
                borderWidth: 3,
                pointRadius: 0,
                yAxisID: 'yPace',
                tension: 0.3
            },
            {
                label: 'Active Heart Rate (bpm)',
                data: heartRates,
                borderColor: '#ef4444', // Red
                borderWidth: 3,
                pointRadius: 0,
                yAxisID: 'yHr',
                tension: 0.2
            }
        ];

        // Align and add comparison datasets if provided
        if (comparisonSamples && comparisonSamples.length > 0) {
            const compElevation = samples.map(s => {
                const closest = this.findClosestSampleByDistance(s.distance, comparisonSamples);
                return closest ? closest.elevation : null;
            });

            const compPaces = samples.map(s => {
                const closest = this.findClosestSampleByDistance(s.distance, comparisonSamples);
                if (!closest) return null;
                if (closest.speed <= 0.5) return 999;
                const paceSec = 1000 / closest.speed;
                return paceSec > 900 ? 900 : Math.round(paceSec);
            });

            const compHeartRates = samples.map(s => {
                const closest = this.findClosestSampleByDistance(s.distance, comparisonSamples);
                return closest ? closest.heart_rate : null;
            });

            datasets.push(
                {
                    label: 'Comp Elevation (m)',
                    data: compElevation,
                    borderColor: 'rgba(255, 255, 255, 0.15)',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    yAxisID: 'yElevation',
                    tension: 0.2,
                    fill: false
                },
                {
                    label: 'Comp Pace (sec/km)',
                    data: compPaces,
                    borderColor: '#a855f7', // Violet
                    borderWidth: 2.5,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    yAxisID: 'yPace',
                    tension: 0.3
                },
                {
                    label: 'Comp Heart Rate (bpm)',
                    data: compHeartRates,
                    borderColor: '#f97316', // Orange
                    borderWidth: 2.5,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    yAxisID: 'yHr',
                    tension: 0.2
                }
            );
        }

        this.telemetryChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: distances,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                hover: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 12 }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: (context) => {
                                const datasetLabel = context.dataset.label;
                                if (datasetLabel.includes('Elevation')) {
                                    return `${datasetLabel}: ${context.raw} m`;
                                }
                                if (datasetLabel.includes('Pace')) {
                                    return `${datasetLabel}: ${context.raw === 999 ? '--' : this.formatPace(context.raw)}`;
                                }
                                return `${datasetLabel}: ${context.raw} bpm`;
                            }
                        }
                    }
                },
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Distance (km)' },
                        grid: { display: false }
                    },
                    yElevation: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: 'Elevation (m)' },
                        grid: { drawOnChartArea: false }
                    },
                    yPace: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: 'Pace', color: '#06b6d4' },
                        grid: { drawOnChartArea: true },
                        reverse: true, // faster pace is lower seconds/km
                        max: 600, // standard range cap 10 min/km
                        min: 210, // 3:30 min/km
                        ticks: {
                            callback: (value) => this.formatPace(value)
                        }
                    },
                    yHr: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: 'Heart Rate (bpm)', color: '#ef4444' },
                        grid: { drawOnChartArea: false },
                        min: 100,
                        max: 200
                    }
                },
                plugins: [{
                    // Custom plugin to listen to vertical hover line & sync back to the Leaflet map
                    id: 'mapHoverLink',
                    afterDatasetsDraw: (chart) => {
                        if (chart.tooltip?._active && chart.tooltip._active.length > 0) {
                            const index = chart.tooltip._active[0].index;
                            if (this.onTelemetryHover) {
                                let compIndex = null;
                                if (comparisonSamples && comparisonSamples.length > 0) {
                                    const dist = samples[index].distance;
                                    compIndex = this.findClosestSampleIndexByDistance(dist, comparisonSamples);
                                }
                                this.onTelemetryHover(index, compIndex);
                            }
                        }
                    }
                }]
            }
        });
    }
}
