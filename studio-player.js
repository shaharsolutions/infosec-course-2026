(function() {
    let screens = [];
    let currentIndex = 0;
    let score = 0;
    let answeredCount = 0;
    let slideTimers = {};
    let slideStartTime = Date.now();
    let currentAudio = null;
    let selectedIndex = -1;
    let isSubmitted = false;
    let questionStates = {}; // Persistent answers: { slideId: { selectedIndex, isSubmitted } }

    console.log('[StudioPlayer] Initialization started');

    function stopAllAudio() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            currentAudio = null;
        }
    }

    function fitPlayer() {
        const container = document.getElementById('player-container');
        if (!container) return;
        
        const windowW = window.innerWidth;
        const windowH = window.innerHeight;
        const targetW = 1280;
        const targetH = 720;
        const ratio = targetW / targetH;
        const screenRatio = windowW / windowH;

        let finalW, finalH;
        if (screenRatio > ratio) {
            finalH = Math.min(windowH, targetH);
            finalW = finalH * ratio;
        } else {
            finalW = Math.min(windowW, targetW);
            finalH = finalW / ratio;
        }

        container.style.width = Math.floor(finalW) + 'px';
        container.style.height = Math.floor(finalH) + 'px';
    }

    window.addEventListener('resize', fitPlayer);
    window.addEventListener('orientationchange', () => setTimeout(fitPlayer, 200));

    function hexToRgba(hex, alpha = 1) {
        if (!hex || !hex.startsWith('#')) return `rgba(56, 189, 248, ${alpha})`;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    /**
     * Centralized path resolution for all assets (images, audio, logos).
     * Strips GUID prefixes and ensures relative paths are correctly mapped.
     */
    function resolveAssetPath(path) {
        if (!path || path.startsWith('http') || path.startsWith('data:')) return path;
        
        let clean = path;
        // Strip leading GUID/ UUID prefix if present
        if (clean.includes('/')) {
            const parts = clean.split('/');
            if (parts[0].length > 15 && parts[0].includes('-')) {
                clean = parts.slice(1).join('/');
            }
        }
        
        // If it still doesn't have a directory part, fallback to assets/
        if (!clean.includes('/')) {
            clean = 'assets/' + clean;
        }
        
        return clean.replace(/\/+/g, '/');
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const playerContainer = document.getElementById('player-container');
        const contentArea = document.getElementById('content-area');
        const progressBar = document.getElementById('progress-bar');
        const nextBtn = document.getElementById('next-btn');
        const prevBtn = document.getElementById('prev-btn');

        // Initial Loading View
        contentArea.innerHTML = `
            <div style="text-align:center; padding:50px;">
                <i class="fas fa-spinner fa-spin" style="font-size:3rem; color:#38bdf8;"></i>
                <p style="margin-top:20px; color:#94a3b8;">טוען נתונים...</p>
            </div>`;

        // SCORM Init
        try {
            if (window.SCORM) {
                SCORM.init();
            }
        } catch (e) {
            console.warn('[StudioPlayer] SCORM error:', e);
        }

        async function loadData() {
            try {
                // Priority 1: Check if data was loaded via script tag (data.js) - works offline/local
                if (window.courseData) {
                    screens = window.courseData.screens || [];
                    console.log(`[StudioPlayer] Success: Loaded ${screens.length} screens from global variable`);
                    return true;
                }

                // Priority 2: Fallback to fetch (works via http/server)
                const pathVariants = ['data.json', './data.json'];
                let data = null;
                
                for (const p of pathVariants) {
                    try {
                        const res = await fetch(p + '?v=' + Date.now());
                        if (res.ok) {
                            data = await res.json();
                            break;
                        }
                    } catch (e) { continue; }
                }

                if (!data) throw new Error('Could not find data.json and no global courseData found');
                
                screens = data.screens || [];
                console.log(`[StudioPlayer] Success: Loaded ${screens.length} screens via fetch`);
                return true;
            } catch (e) {
                console.error("[StudioPlayer] Data load failed:", e);
                contentArea.innerHTML = `
                    <div style="color:#ef4444; padding:40px; text-align:center; background:rgba(239,68,68,0.1); border:1px solid #ef4444; border-radius:15px;">
                        <h3>שגיאה בטעינת הקורס</h3>
                        <p>לא ניתן היה למצוא את קובץ הנתונים (data.json).</p>
                        <code style="display:block; margin-top:10px; font-size:0.8rem;">${e.message}</code>
                    </div>`;
                return false;
            }
        }

        function updateNav() {
            const screen = screens[currentIndex];
            const isQ = !!(screen && screen.question);
            const isSplash = currentIndex === 0 && (screen && !screen.content && !screen.question);

            // Per User Request: If submitted (already answered), 
            // the Check Answer button should NEVER show. Next/Prev are allowed.
            if (isSubmitted && isQ) {
                prevBtn.style.display = (currentIndex > 0) ? 'flex' : 'none';
                nextBtn.style.display = 'flex';
                nextBtn.innerHTML = (currentIndex === screens.length - 1) ? 'סיום ויציאה' : 'המשך <i class="fas fa-chevron-left" style="margin-right:8px;"></i>';
                nextBtn.onclick = () => renderSlide(currentIndex + 1);
                return;
            }

            // Normal Navigation Logic
            prevBtn.style.display = (currentIndex > 0 && !isSplash) ? 'flex' : 'none';
            
            if (isSplash) {
                nextBtn.innerHTML = 'התחל למידה <i class="fas fa-play" style="margin-right:8px;"></i>';
                nextBtn.onclick = () => renderSlide(currentIndex + 1);
            } else if (isQ) {
                nextBtn.innerHTML = 'בדוק תשובה <i class="fas fa-check" style="margin-right:8px;"></i>';
                nextBtn.onclick = checkAnswer;
            } else {
                if (currentIndex === screens.length - 1) {
                    nextBtn.innerHTML = 'סיום ויציאה <i class="fas fa-flag-checkered" style="margin-right:8px;"></i>';
                    nextBtn.onclick = finishCourse;
                } else {
                    nextBtn.innerHTML = 'המשך <i class="fas fa-chevron-left" style="margin-right:8px;"></i>';
                    nextBtn.onclick = () => renderSlide(currentIndex + 1);
                }
            }
        }

        async function preloadMedia() {
            const status = document.getElementById('loading-status');
            const assets = [];
            
            const updateStatus = (msg) => {
                if (status) status.innerText = msg;
            };

            const loadImg = (url) => new Promise((res) => {
                if (!url) return res();
                const timeout = setTimeout(() => {
                    console.warn('[StudioPlayer] Image load timeout:', url);
                    res();
                }, 5000);
                const img = new Image();
                img.onload = img.onerror = () => {
                    clearTimeout(timeout);
                    res();
                };
                img.src = url;
            });

            const loadAudio = (url) => new Promise((res) => {
                if (!url) return res();
                // Most mobile browsers block audio preloading. 
                // We'll set a short timeout and also listen for initial load events.
                const timeout = setTimeout(() => {
                    console.warn('[StudioPlayer] Audio load timeout (expected on mobile):', url);
                    res();
                }, 2000);
                
                const audio = new Audio();
                // On mobile, 'onloadstart' or 'onloadedmetadata' might fire, 
                // but 'oncanplaythrough' often won't until user gesture.
                audio.onloadedmetadata = audio.onloadstart = audio.onerror = () => {
                    clearTimeout(timeout);
                    res();
                };
                audio.src = url;
                audio.load(); // Explicitly trigger load
            });

            updateStatus('טוען גרפיקה וסאונד...');
            
            screens.forEach(s => {
                if (s.bgImage) assets.push(loadImg(resolveAssetPath(s.bgImage)));
                if (s.audio) assets.push(loadAudio(resolveAssetPath(s.audio)));
                if (s.logo) assets.push(loadImg(resolveAssetPath(s.logo)));
            });
            assets.push(loadImg(resolveAssetPath('maya_guide.png')));

            // Split into batches to avoid overloading, but don't let it block forever
            const batchSize = 10;
            const total = assets.length;
            for (let i = 0; i < assets.length; i += batchSize) {
                const batch = assets.slice(i, i + batchSize);
                try {
                    await Promise.all(batch);
                } catch (e) {
                    console.warn('[StudioPlayer] Batch load error:', e);
                }
                updateStatus(`טוען משאבי לומדה (${Math.round((Math.min(i + batchSize, total) / total) * 100)}%)...`);
            }
            
            updateStatus('הטעינה הושלמה!');
            await new Promise(r => setTimeout(r, 500));
        }

        function renderSlide(index) {
            stopAllAudio();
            if (!screens[index]) return;
            
            // Remove splash-mode by default
            contentArea.classList.remove('splash-mode');

            // Track time
            const now = Date.now();
            if (screens[currentIndex]) {
                const diff = Math.round((now - slideStartTime) / 1000);
                const pid = screens[currentIndex].id || `s${currentIndex}`;
                slideTimers[pid] = (slideTimers[pid] || 0) + diff;
            }
            
            currentIndex = index;
            slideStartTime = now;
            const screen = screens[index];
            const slideId = screen.id || `s${index}`;
            
            // Restore persistent state for this slide
            const qState = questionStates[slideId];
            if (qState) {
                selectedIndex = qState.selectedIndex;
                isSubmitted = qState.isSubmitted;
            } else {
                selectedIndex = -1;
                isSubmitted = false;
            }

            // UI
            if (screen.bgImage) {
                const bgUrl = resolveAssetPath(screen.bgImage);
                playerContainer.style.backgroundImage = `url('${encodeURI(bgUrl)}')`;
                console.log(`[StudioPlayer] Setting background: ${bgUrl}`);
                
                // Diagnostic check
                const testImg = new Image();
                testImg.onerror = () => console.warn(`[StudioPlayer] Background IMAGE NOT FOUND: ${bgUrl}`);
                testImg.src = bgUrl;
            } else {
                playerContainer.style.backgroundImage = 'none';
            }

            // Character
            const combined = ((screen.title || '') + (screen.content || '')).toLowerCase();
            const isInfoSec = combined.includes('אבטחה') || combined.includes('מידע') || combined.includes('סיסמה') || 
                              combined.includes('סייבר') || combined.includes('פרטיות') || combined.includes('תקיפה') ||
                              combined.includes('הגנה');
            
            const isHarassment = combined.includes('הטרדה') || combined.includes('מינית');
            let charImg = 'maya_guide.png';
            const charLabel = 'מיה - הממונה על אבטחת מידע';
            const ci = document.getElementById('player-char-img');
            const cl = document.getElementById('player-char-label');
            const cSection = document.getElementById('character-section');
            if (ci) {
                ci.src = resolveAssetPath(charImg);
                console.log(`[StudioPlayer] Setting character: ${charLabel} (asset: ${charImg})`);
            }
            if (cl) cl.textContent = charLabel;

            // Ensure character section is visible (SplashScreen hides it)
            if (cSection) cSection.style.display = 'flex';

            // Main Content
            let html = `<h1>${screen.title || ''}</h1>`;
            if (screen.question) {
                html += `<p class="question-text">${screen.question.text || ''}</p>`;
                html += `<div class="options-list" style="margin-top:25px; ${isSubmitted ? 'pointer-events: none;' : ''}">
                    ${(screen.question.options || []).map((opt, i) => {
                        let cls = 'option';
                        if (isSubmitted) {
                            const correctIdx = (screen.question.options || []).findIndex(o => o.correct);
                            if (i === correctIdx) cls += ' correct';
                            else if (i === selectedIndex) cls += ' incorrect';
                        } else if (i === selectedIndex) {
                            cls += ' selected';
                        }
                        return `<div class="${cls}" data-idx="${i}">${opt.text || ''}</div>`;
                    }).join('')}
                </div>`;
            } else {
                html += `<p>${screen.content || ''}</p>`;
            }

            if (screen.id === 'officer_details' && screen.officer) {
                html += `
                    <div class="officer-card" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(14, 165, 233, 0.2); border-radius: 20px; padding: 25px; margin-top: 20px;">
                        <div class="officer-info" style="display: flex; flex-direction: column; gap: 12px;">
                            <div class="officer-field" style="font-size: 1.1rem; color: #e2e8f0;"><strong>שם:</strong> <span>${screen.officer.name}</span></div>
                            <div class="officer-field" style="font-size: 1.1rem; color: #e2e8f0;"><strong>תפקיד:</strong> <span>${screen.officer.role}</span></div>
                            <div class="officer-field" style="font-size: 1.1rem; color: #e2e8f0;"><strong>טלפון:</strong> <a href="tel:${screen.officer.phone}" style="color: #818cf8;">${screen.officer.phone}</a></div>
                            <div class="officer-field" style="font-size: 1.1rem; color: #e2e8f0;"><strong>אימייל:</strong> <a href="mailto:${screen.officer.email}" style="color: #818cf8;">${screen.officer.email}</a></div>
                        </div>
                    </div>
                `;
            }
            contentArea.innerHTML = html;

            // Attach listeners to options
            if (screen.question) {
                document.querySelectorAll('.option').forEach(el => {
                    el.onclick = () => selectOption(parseInt(el.dataset.idx));
                });
            }

            progressBar.style.width = `${((index + 1) / screens.length) * 100}%`;
            updateNav();

            // --- Locking Logic (minDelay & waitForAudio) ---
            const minDelay = screen.minDelay || 0;
            const waitForAudio = !!screen.waitForAudio;
            
            let audioFinished = !waitForAudio || !screen.audio;
            let timerFinished = minDelay <= 0;

            const checkUnlock = () => {
                if (audioFinished && timerFinished) {
                    nextBtn.disabled = false;
                    nextBtn.style.opacity = '1';
                    nextBtn.style.pointerEvents = 'auto';
                }
            };

            if ((minDelay > 0 || (waitForAudio && screen.audio)) && !isSubmitted && !screen.question) {
                nextBtn.disabled = true;
                nextBtn.style.opacity = '0.5';
                nextBtn.style.pointerEvents = 'none';
            }

            // Audio
            if (screen.audio) {
                const audioUrl = resolveAssetPath(screen.audio);
                currentAudio = new Audio(audioUrl);
                
                if (waitForAudio && !isSubmitted) {
                    currentAudio.onended = () => {
                        audioFinished = true;
                        checkUnlock();
                    };
                }

                currentAudio.play().catch(e => {
                    console.warn('[StudioPlayer] Auto-play blocked or failed:', e);
                    audioFinished = true;
                    checkUnlock();
                });
            }

            if (minDelay > 0 && !isSubmitted) {
                setTimeout(() => {
                    timerFinished = true;
                    checkUnlock();
                }, minDelay * 1000);
            }

            saveState();

            // Return feedback toast if already submitted
            if (isSubmitted && screen.question) {
                setTimeout(() => {
                    const status = `<span class="feedback-status info">כבר ענית על שאלה זו</span>`;
                    const feedback = screen.question.feedback || "התשובה הנכונה מסומנת בירוק.";
                    showToast(screen.question.text || "", `${status}<br><br>${feedback}`, () => renderSlide(currentIndex + 1));
                }, 300);
            }
        }

        function selectOption(idx) {
            if (isSubmitted) return;
            selectedIndex = idx;
            document.querySelectorAll('.option').forEach((el, i) => {
                el.classList.toggle('selected', i === idx);
            });
        }

        function checkAnswer() {
            if (selectedIndex === -1) {
                showToast("שימו לב", "יש לסמן תשובה לפני הבדיקה.", null, "חזור לבחירה");
                return;
            }
            isSubmitted = true;
            const screen = screens[currentIndex];
            const opts = screen.question.options || [];
            const correctIdx = opts.findIndex(o => o.correct);
            
            document.querySelectorAll('.option').forEach((el, i) => {
                if (i === correctIdx) el.classList.add('correct');
                else if (i === selectedIndex) el.classList.add('incorrect');
                el.style.cursor = 'default';
            });

            const questionText = screen.question.text || "";
            if (selectedIndex === correctIdx) {
                score++;
                showToast(questionText, `<span class="feedback-status correct">תשובה נכונה</span><br><br>כל הכבוד! נכון מאוד.`, () => renderSlide(currentIndex + 1));
            } else {
                const feedback = screen.question.feedback || "לא נורא, התשובה הנכונה מסומנת בירוק.";
                showToast(questionText, `<span class="feedback-status incorrect">תשובה לא נכונה</span><br><br>${feedback}`, () => renderSlide(currentIndex + 1));
            }
            answeredCount++;
            
            // Save to persistent question states
            const slideId = screen.id || `s${currentIndex}`;
            questionStates[slideId] = { selectedIndex, isSubmitted: true };
            
            updateNav();
            saveState();
        }

        function showToast(title, msg, onContinue = null, btnText = null) {
            const t = document.getElementById('toast');
            const isFinish = (title === "סיום לומדה" || title === "סיום הלומדה" || title === "סיכום לומדה");
            t.classList.toggle('finish-toast', isFinish);
            
            t.innerHTML = `
                <div style="border-bottom: 2px solid var(--primary); padding-bottom: 15px; margin-bottom: 20px;">
                    <h3 style="color: var(--primary); font-size: 1.2rem; margin-bottom: 10px;">${isFinish ? "סיכום לומדה" : (title === "שימו לב" ? "" : "השאלה:")}</h3>
                    <p style="font-weight: 500; font-size: 1.1rem;">${title}</p>
                </div>
                ${isFinish ? '<h3>תוצאות</h3>' : ''}
                <p>${msg}</p>
                <button class="btn btn-primary" style="margin-top:20px; width:100%" id="toast-close">${btnText || (isFinish ? "סגור לומדה" : "המשך ללמידה")}</button>
            `;
            t.style.display = 'block';

            // Disable all other interactions by adding a modal backdrop
            let overlay = document.getElementById('toast-backdrop');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'toast-backdrop';
                overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:999; backdrop-filter:blur(4px);';
                document.body.appendChild(overlay);
            }
            overlay.style.display = 'block';
            t.style.zIndex = '1000';

            document.getElementById('toast-close').onclick = () => {
                t.style.display = 'none';
                overlay.style.display = 'none';
                if (onContinue && typeof onContinue === 'function') {
                    onContinue();
                }
            };
        }

        function saveState() {
            if (!screens[currentIndex] || !window.SCORM || !SCORM.connected) return;
            const state = { index: currentIndex, score, answered: answeredCount, timers: slideTimers, questions: questionStates };
            SCORM.saveProgressState(screens[currentIndex].id || `s${currentIndex}`, state);
            SCORM.set("cmi.core.progress_measure", ((currentIndex + 1) / screens.length).toFixed(2));
        }

        function restoreState() {
            if (!window.SCORM) return;
            const state = SCORM.getSuspendData();
            if (state && state.index !== undefined) {
                // If bookmarked index > 0, we still want to show it, 
                // but the user might want a "splash" screen anyway if it's a fresh launch.
                // For now, we follow the bookmark as standard SCORM behavior.
                currentIndex = state.index;
                score = state.score || 0;
                answeredCount = state.answered || 0;
                slideTimers = state.timers || {};
                questionStates = state.questions || {};
            }
        }

        function finishCourse() {
            const totalQ = screens.filter(s => s.question).length;
            const finalScore = totalQ > 0 ? Math.round((score / totalQ) * 100) : 100;
            SCORM.setScore(finalScore);
            SCORM.setComplete();
            saveState();
            showToast("סיום לומדה", `סיימת את הלומדה!<br><br>הציון שלך הוא:<br><span class="final-score">${finalScore}</span><br><br>הלומדה תיסגר כעת.`);
            setTimeout(() => { SCORM.finish(); window.close(); }, 3000);
        }

        // --- Start Execution ---
        const success = await loadData();
        if (success) {
            await preloadMedia();
            
            // Hide loading screen and show player
            document.getElementById('loading-screen').style.display = 'none';
            document.getElementById('player-container').style.display = 'block';
            fitPlayer();

            restoreState();
            // If we are at index 0 and it's a fresh start, we can show a dedicated splash
            if (currentIndex === 0 && !SCORM.getSuspendData()?.index) {
                renderSplashScreen();
            } else {
                renderSlide(currentIndex);
            }
            prevBtn.onclick = () => { if (currentIndex > 0) renderSlide(currentIndex - 1); };
        }

        function renderSplashScreen() {
            // Find logo from first screen or elsewhere
            const firstScreen = screens[0] || {};
            const splashLogo = resolveAssetPath(firstScreen.logo || '');
            const logoColor = firstScreen.logoBgColor || '#38bdf8';
            const logoBg = hexToRgba(logoColor, 0.1);

            // Set background from first slide for sense of continuity
            if (firstScreen.bgImage) {
                const bgUrl = resolveAssetPath(firstScreen.bgImage);
                playerContainer.style.backgroundImage = `url('${encodeURI(bgUrl)}')`;
            } else {
                playerContainer.style.backgroundImage = 'none';
            }

            const cSection = document.getElementById('character-section');
            if (cSection) cSection.style.display = 'none';
            
            // Add splash-mode to content area
            contentArea.classList.add('splash-mode');

            const logoHtml = splashLogo ? `
                <div class="logo-placeholder" style="background: ${logoColor}; border: 4px solid rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: 0 0 30px rgba(0,0,0,0.3);">
                    <img src="${encodeURI(splashLogo)}" style="max-width: 80%; max-height: 80%; object-fit: contain;">
                </div>
            ` : `
                <div class="logo-placeholder" style="background: ${logoColor}; border: 4px solid rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 30px rgba(0,0,0,0.3);">
                    <i class="fas fa-shield-halved" style="font-size: 3rem; color: white;"></i>
                </div>
            `;

            const title = (firstScreen.id === 'welcome' ? firstScreen.title : "ברוכים הבאים ללומדה");
            const content = "לחצו על הכפתור למטה כדי להתחיל בלמידה.";

            contentArea.innerHTML = `
                <div class="splash-view" style="text-align: center;">
                    ${logoHtml}
                    <h1 style="color: ${logoColor};">${title}</h1>
                    <p style="margin-bottom: 20px;">${content}</p>
                </div>
            `;

            prevBtn.style.display = 'none';
            nextBtn.innerHTML = 'התחל למידה <i class="fas fa-play" style="margin-right:8px;"></i>';
            nextBtn.onclick = () => {
                // Always start from Slide 0 after the splash
                renderSlide(0);
            };
            progressBar.style.width = '0%';
        }
    });
})();
