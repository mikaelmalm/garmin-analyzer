/**
 * Garmin Analyzer - API client module
 * Handles all network requests to the local server
 */

export class GarminAPI {
    constructor(baseUrl = '') {
        this.baseUrl = baseUrl;
    }

    /**
     * Fetch all routes grouped with their activities
     * @returns {Promise<Object>} The routes data
     */
    async fetchRoutes() {
        try {
            const response = await fetch(`${this.baseUrl}/api/activities`);
            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error("Failed to fetch activities:", error);
            throw error;
        }
    }

    /**
     * Upload a FIT, GPX, or TCX file
     * @param {File} file The file to upload
     * @returns {Promise<Object>} Server response
     */
    async uploadFile(file) {
        const formData = new FormData();
        formData.append("file", file);

        try {
            const response = await fetch(`${this.baseUrl}/api/upload`, {
                method: "POST",
                body: formData
            });
            
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.detail || "File upload failed");
            }
            return data;
        } catch (error) {
            console.error("Failed to upload file:", error);
            throw error;
        }
    }

    /**
     * Attempt to log into Garmin Connect and sync activities
     * @param {string} email 
     * @param {string} password 
     * @returns {Promise<Object>} Server response
     */
    async loginAndSync(email, password) {
        try {
            const response = await fetch(`${this.baseUrl}/api/garmin/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || "Failed to log in to Garmin Connect");
            }
            return data;
        } catch (error) {
            console.error("Garmin sync error:", error);
            throw error;
        }
    }
}
