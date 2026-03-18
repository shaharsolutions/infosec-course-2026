const SCORM = {
    connected: false,
    api: null,
    
    init() {
        console.log("[SCORM] Searching for API...");
        this.api = this.findAPI(window);
        
        if (!this.api && window.opener) {
            this.api = this.findAPI(window.opener);
        }
        
        if (!this.api && window.parent && window.parent !== window) {
            this.api = this.findAPI(window.parent);
        }

        if (this.api) {
            console.log("[SCORM] API found, initializing...");
            try {
                const res = this.api.LMSInitialize("");
                if (res === "true" || res === true) {
                    this.connected = true;
                    console.log("[SCORM] Initialized successfully");
                } else {
                    const errCode = this.api.LMSGetLastError();
                    const errDesc = this.api.LMSGetErrorString(errCode);
                    console.error(`[SCORM] LMSInitialize failed: ${errDesc} (${errCode})`);
                }
            } catch (e) {
                console.error("[SCORM] Exception during initialization", e);
            }
        } else {
            console.warn("[SCORM] API NOT FOUND - LMS features will be disabled.");
        }
    },

    findAPI(win) {
        let attempts = 0;
        while (win) {
            if (win.LMSInitialize) return win;
            if (win.API && win.API.LMSInitialize) return win.API;
            
            if (win === win.parent) break;
            win = win.parent;
            attempts++;
            if (attempts > 10) break;
        }
        return null;
    },

    get(param) {
        if (!this.connected || !this.api) return null;
        try {
            return this.api.LMSGetValue(param);
        } catch (e) {
            console.error(`[SCORM] Error getting ${param}`, e);
            return null;
        }
    },

    set(param, value) {
        if (!this.connected || !this.api) return false;
        try {
            const res = this.api.LMSSetValue(param, value);
            this.api.LMSCommit("");
            return res === "true" || res === true;
        } catch (e) {
            console.error(`[SCORM] Error setting ${param}`, e);
            return false;
        }
    },

    setScore(score) {
        this.set("cmi.core.score.raw", String(score));
        this.set("cmi.core.score.min", "0");
        this.set("cmi.core.score.max", "100");
    },

    setComplete() {
        this.set("cmi.core.lesson_status", "completed");
    },

    finish() {
        if (!this.connected || !this.api) return;
        try {
            this.api.LMSFinish("");
        } catch (e) {
            console.error("[SCORM] Error in LMSFinish", e);
        }
    },

    getSuspendData() {
        const data = this.get("cmi.suspend_data");
        if (!data) return {};
        try {
            return JSON.parse(data);
        } catch (e) {
            console.warn("[SCORM] Failed to parse suspend_data", data);
            return {};
        }
    },

    saveProgressState(location, data) {
        if (location) this.set("cmi.core.lesson_location", String(location));
        if (data) this.set("cmi.suspend_data", JSON.stringify(data));
    },

    getBookmark() {
        return this.get("cmi.core.lesson_location");
    }
};
