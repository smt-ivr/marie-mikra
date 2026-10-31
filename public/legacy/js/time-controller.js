// ======================================================
//  time-controller.js - ניהול לשונית זמני המבחן (גרסה 8.1 - תיקון טייפו)
// ======================================================

const timeController = {
    view: document.getElementById('time-view'),
    initialized: false,
    originalLines: [], // מערך לשמירת כל שורות הקובץ המקוריות
    settings: {
        mode: 'filter', // 'open', 'closed', 'filter'
        filters: []
    },
    
    TIME_INI_FILE_PATH: 'ivr2:/ext.ini',

    // --- מילון ימים לצורך חישובים ---
    dayMap: { 'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6 },
    dayNameMap: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'],
    MINUTES_IN_WEEK: 7 * 24 * 60, // 10080

    init: function(forceRefresh = false) {
        if (!this.initialized || forceRefresh) {
            this.initialized = true;
            this.fetchAndDisplaySettings();
        }
    },

    fetchAndDisplaySettings: async function() {
        this.view.innerHTML = `<div id="loading"><i class="fas fa-spinner fa-spin"></i> טוען הגדרות זמנים...</div>`;
        try {
            const fileContent = await pointsController.fetchFileContent(this.TIME_INI_FILE_PATH, false);
            if (fileContent === null) {
                this.view.innerHTML = `<p class="info-message"><i class="fas fa-info-circle"></i> לא נמצא קובץ הגדרות זמנים (ext.ini).</p>`;
                return;
            }
            this.parseIniContent(fileContent);
            this.renderView();
        } catch (error) {
            this.view.innerHTML = `<p class="error-message"><i class="fas fa-exclamation-triangle"></i> שגיאה בטעינת הנתונים: ${error.message}</p>`;
        }
    },

    parseIniContent: function(content) {
        this.originalLines = content.split('\n');
        this.settings.filters = [];
        
        let checkAccessFilter = null;
        let accessFilterYesGoto = null;

        this.originalLines.forEach((line, index) => {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('check_access_filter=')) {
                checkAccessFilter = trimmedLine.split('=')[1];
            } else if (trimmedLine.replace(/^;/, '').startsWith('access_filter_yes_goto=')) {
                if(!trimmedLine.startsWith(';')) {
                    accessFilterYesGoto = trimmedLine.split('=')[1];
                }
            } else if (trimmedLine.match(/^(,)?(access_filter_\d+)=(.*)$/)) {
                const parts = trimmedLine.match(/^(,)?(access_filter_\d+)=(.*)$/);
                
                const fullValue = parts[3];
                const valueParts = fullValue.match(/g\.(\d{2}:\d{2})-(\d{2}:\d{2})\.([a-z]{3})-([a-z]{3})/);

                this.settings.filters.push({
                    enabled: !parts[1],
                    key: parts[2], // זה המפתח המקורי (access_filter_1, _2 וכו')
                    value: fullValue,
                    parsedValue: valueParts, 
                    originalLineIndex: index // שומרים את מיקום השורה המקורי
                });
            }
        });
        
        // --- מיון הכללים לפי הסדר המספרי שלהם בקובץ (כדי שהממשק ישקף את הקובץ) ---
        this.settings.filters.sort((a, b) => {
            const numA = parseInt(a.key.split('_')[2], 10);
            const numB = parseInt(b.key.split('_')[2], 10);
            return numA - numB;
        });


        if (checkAccessFilter === 'no') {
            this.settings.mode = 'open';
        } else if (accessFilterYesGoto === '3') {
            this.settings.mode = 'closed';
        } else {
            this.settings.mode = 'filter';
        }
    },

    renderView: function() {
        const days = [
            { value: 'sun', label: 'ראשון' }, { value: 'mon', label: 'שני' },
            { value: 'tue', label: 'שלישי' }, { value: 'wed', label: 'רביעי' },
            { value: 'thu', label: 'חמישי' }, { value: 'fri', label: 'שישי' },
            { value: 'sat', label: 'שבת' }
        ];

        // הסדר כעת מגיע מהמיון שנעשה ב-parseIniContent
        let filtersHtml = this.settings.filters.map((filter) => {
            const valueParts = filter.parsedValue;
            const [startTime, endTime, startDay, endDay] = valueParts ? [valueParts[1], valueParts[2], valueParts[3], valueParts[4]] : ["00:00", "23:59", "sun", "sun"];
            
            return `
                <div class="time-filter-item" data-filter-key="${filter.key}">
                    <div class="time-filter-enable"><input type="checkbox" id="filter-enabled-${filter.key}" class="filter-enable-checkbox" ${filter.enabled ? 'checked' : ''}><label for="filter-enabled-${filter.key}">פעיל</label></div>
                    <div class="time-filter-controls">
                        מיום: <select class="day-select start-day">${days.map(d => `<option value="${d.value}" ${d.value === startDay ? 'selected' : ''}>${d.label}</option>`).join('')}</select>
                        משעה: <input type="time" class="time-input start-time" value="${startTime}">
                        עד יום: <select class="day-select end-day">${days.map(d => `<option value="${d.value}" ${d.value === endDay ? 'selected' : ''}>${d.label}</option>`).join('')}</select>
                        עד שעה: <input type="time" class="time-input end-time" value="${endTime}">
                    </div>
                    <div class="time-filter-actions"><button class="button button-danger remove-filter-btn"><i class="fas fa-trash"></i></button></div>
                </div>`;
        }).join('');
        
        const statusConfig = {
            open: { icon: 'fa-check-circle', title: 'כניסה חופשית פעילה (פילטר עקוף)', desc: 'המערכת פתוחה לכולם ללא הגבלת זמן. הגדרה זו תישאר פעילה עד שתבוטל ידנית.', button: '<button class="button button-primary" data-mode="filter"><i class="fas fa-filter"></i> חזור והפעל סינון לפי שעות</button>' },
            closed: { icon: 'fa-times-circle', title: 'המערכת סגורה (פילטר עקוף)', desc: 'המערכת סגורה לחלוטין. אף משתמש לא יוכל להיכנס. הגדרה זו תישאר פעילה עד שתבוטל ידנית.', button: '<button class="button button-primary" data-mode="filter"><i class="fas fa-filter"></i> חזור והפעל סינון לפי שעות</button>' },
            filter: { icon: 'fa-filter', title: 'המערכת במצב סינון לפי שעות', desc: 'הכניסה למערכת מנוהלת אוטומטית לפי הכללים שהוגדרו למטה.', button: `<button class="button button-success" data-mode="open"><i class="fas fa-check-circle"></i> עקוף פילטר ואפשר כניסה חופשית</button> <button class="button button-danger" data-mode="closed"><i class="fas fa-times-circle"></i> עקוף פילטר וחסום כל גישה</button>` }
        };
        const currentStatus = statusConfig[this.settings.mode];

        const viewHtml = `
            <div class="time-view-container">
                <div id="time-status-message-container" style="margin-bottom: 1.5rem; text-align: center;"></div>
                
                <div class="status-banner status-${this.settings.mode}">
                    <div class="status-icon"><i class="fas ${currentStatus.icon}"></i></div>
                    <div class="status-text"><h4>${currentStatus.title}</h4><p>${currentStatus.desc}</p></div>
                    <div class="status-actions">${currentStatus.button}</div>
                </div>
                <div id="time-filters-section">
                    <h3><i class="fas fa-tasks"></i> עריכת כללי הסינון (לשמירה יש ללחוץ על כפתור השמירה למטה)</h3>
                    <div id="time-filters-list">${filtersHtml}</div>
                    <button id="add-filter-btn" class="button button-primary"><i class="fas fa-plus"></i> הוסף כלל חדש</button>
                </div>
                <div class="view-actions" style="justify-content: center; margin-top: 2rem; border-top: none;">
                    <button id="save-time-settings-btn" class="button button-success" style="font-size: 1.2rem; padding: 0.8rem 2rem;"><i class="fas fa-save"></i> שמור שינויים בכללי הזמן</button>
                </div>
            </div>`;
        this.view.innerHTML = viewHtml;
        
        this.calculateAndDisplayTimeStatus();
        this.addEventListeners();
    },

    addEventListeners: function() {
        this.view.querySelectorAll('.status-actions button').forEach(b => b.addEventListener('click', (e) => this.executeModeChange(e.target.closest('button').dataset.mode, e.target.closest('button'))));
        document.getElementById('add-filter-btn').addEventListener('click', () => this.addFilter());
        document.getElementById('save-time-settings-btn').addEventListener('click', () => this.saveFilterChanges());
        this.view.querySelectorAll('.remove-filter-btn').forEach(b => b.addEventListener('click', (e) => this.removeFilterUI(e.target.closest('.time-filter-item'))));
    },

    addFilter: function() {
        const defaultValue = 'g.08:00-16:00.sun-sun.*.*.*.*.*.*.*';
        const defaultParsedValue = defaultValue.match(/g\.(\d{2}:\d{2})-(\d{2}:\d{2})\.([a-z]{3})-([a-z]{3})/);
        
        let maxNum = 0;
        this.settings.filters.forEach(f => {
            const num = parseInt(f.key.split('_')[2], 10);
            if (num > maxNum) maxNum = num;
        });
        const newKey = `access_filter_${maxNum + 1}`;

        // הוספת הכלל החדש *לסוף* המערך
        this.settings.filters.push({
            isNew: true, // סימון שהוא חדש
            enabled: true,
            value: defaultValue,
            parsedValue: defaultParsedValue,
            key: newKey, 
            originalLineIndex: -1 
        });
        
        this.renderView(); // רענן תצוגה
    },

    removeFilterUI: function(filterItemElement) {
        filterItemElement.classList.add('marked-for-deletion');
        filterItemElement.style.opacity = '0.5';
        filterItemElement.style.backgroundColor = '#f8d7da';
    },

    executeModeChange: async function(newMode, button) {
        const originalButtonHtml = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> מעדכן...';
        
        // --- שינוי: עובד על מערך השורות המקורי ---
        let modifiedLines = [...this.originalLines];
        
        let yesGotoIndex = modifiedLines.findIndex(line => line.trim().replace(/^;/, '').startsWith('access_filter_yes_goto='));
        if (yesGotoIndex !== -1) {
            modifiedLines.splice(yesGotoIndex, 1); // מחק את השורה הישנה
        }
        
        let checkAccessFilterIndex = modifiedLines.findIndex(line => line.trim().startsWith('check_access_filter='));
        if (checkAccessFilterIndex !== -1) {
            modifiedLines[checkAccessFilterIndex] = newMode === 'open' ? 'check_access_filter=no' : 'check_access_filter=yes';
        } else {
             // אם לא נמצא, הוסף אותו
             checkAccessFilterIndex = modifiedLines.length;
             modifiedLines.push(newMode === 'open' ? 'check_access_filter=no' : 'check_access_filter=yes');
        }

        if (newMode === 'closed') {
            // הוסף את השורה מיד אחרי שורת ה-check_access_filter
            modifiedLines.splice(checkAccessFilterIndex + 1, 0, 'access_filter_yes_goto=3');
        }
        
        const newContent = modifiedLines.join('\n');
        try {
            await this.uploadNewContent(newContent);
            this.parseIniContent(newContent);
            this.renderView();
        } catch(error) {
            alert(`שגיאה בעדכון המצב: ${error.message}`);
            button.disabled = false;
            button.innerHTML = originalButtonHtml;
        }
    },

    // =================================================================
    //  ===== פונקציית שמירה (גרסה 8.0) - שומרת על מבנה =====
    // =================================================================
    saveFilterChanges: async function() {
        
        // 1. איסוף כל הכללים מהממשק (כולל חדשים)
        const filtersFromUI = [];
        this.view.querySelectorAll('.time-filter-item').forEach(item => {
            const filterKey = item.dataset.filterKey;
            const filter = this.settings.filters.find(f => f.key === filterKey);
            if (!filter) return; 

            const isDeleted = item.classList.contains('marked-for-deletion');
            const isEnabled = item.querySelector('.filter-enable-checkbox').checked;
            const startTime = item.querySelector('.start-time').value;
            const endTime = item.querySelector('.end-time').value;
            const startDay = item.querySelector('.start-day').value;
            const endDay = item.querySelector('.end-day').value;
            
            const originalValue = filter.value || 'g.00:00-00:00.sun-sun.*.*.*.*.*.*.*';
            const baseRegex = /g\.\d{2}:\d{2}-\d{2}:\d{2}\.[a-z]{3}-[a-z]{3}/;
            const extraPart = originalValue.match(baseRegex) ? originalValue.replace(baseRegex, '') : '.*.*.*.*.*.*.*';
            
            const newBaseValue = `g.${startTime}-${endTime}.${startDay}-${endDay}`;
            const finalNewValue = newBaseValue + extraPart;

            filtersFromUI.push({
                key: filter.key, // המפתח המקורי (access_filter_1...)
                value: finalNewValue, // הערך המעודכן
                enabled: isEnabled,
                isNew: filter.isNew || false,
                isDeleted: isDeleted
            });
        });

        // 2. חלוקה לפעילים ולא פעילים (תוך שמירה על סדר הממשק)
        const activeFilters = filtersFromUI.filter(f => f.enabled && !f.isDeleted);
        const inactiveFilters = filtersFromUI.filter(f => !f.enabled && !f.isDeleted);

        // 3. בניית מערך השורות החדש
        let newFileLines = [];
        let activeCounter = 1;
        
        // יצירת תורים (Queues)
        const activeQueue = [...activeFilters];
        const inactiveQueue = [...inactiveFilters];
        
        // 4. מעבר על השורות המקוריות
        this.originalLines.forEach(line => {
            const match = line.trim().match(/^(,)?(access_filter_\d+)=/);
            
            if (!match) {
                // אם זו לא שורת פילטר, פשוט הוסף אותה
                newFileLines.push(line);
                return;
            }

            const originalKey = match[2];
            
            // בדוק אם הכלל הזה נמחק
            const uiState = filtersFromUI.find(f => f.key === originalKey);
            if (uiState && uiState.isDeleted) {
                return; // אל תוסיף את השורה (מחיקה)
            }
            
            // שתול את הפילטרים לפי הסדר
            if (activeQueue.length > 0) {
                // יש עדיין פעילים לשתול
                const filterData = activeQueue.shift();
                newFileLines.push(`access_filter_${activeCounter++}=${filterData.value}`);
            } else if (inactiveQueue.length > 0) {
                // נגמרו הפעילים, שתול לא פעילים
                const filterData = inactiveQueue.shift();
                newFileLines.push(`,${filterData.key}=${filterData.value}`);
            }
            // אם הגענו לכאן ואין כלום בתורים, השורה המקורית פשוט נמחקת
            // (כי היא הוחלפה כבר, או שהיא נמחקה ואין מה שיחליף אותה)
        });

        // 5. הוספת כללים חדשים שנוספו בסוף הקובץ
        while (activeQueue.length > 0) {
             const filterData = activeQueue.shift();
             newFileLines.push(`access_filter_${activeCounter++}=${filterData.value}`);
        }
         while (inactiveQueue.length > 0) {
            const filterData = inactiveQueue.shift();
            newFileLines.push(`,${filterData.key}=${filterData.value}`);
        }
        
        const newContent = newFileLines.join('\n');

        // 6. שמירה בשרת
        const saveBtn = document.getElementById('save-time-settings-btn');
        const originalButtonHtml = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> שומר...';

        try {
            await this.uploadNewContent(newContent);
            alert('כללי הזמן נשמרו בהצלחה!');
            this.init(true); // טען מחדש את הכל מהשרת
        } catch (error) {
            alert(`שגיאה בשמירת הכללים: ${error.message}`);
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalButtonHtml;
        }
    },
    
    uploadNewContent: async function(content) {
        // ... (ללא שינוי מהגרסה הקודמת) ...
        const token = auth.getToken();
        const apiUrl = `${auth.API_BASE}/UploadTextFile`;
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token, what: this.TIME_INI_FILE_PATH, contents: content })
        });
        if (!response.ok) throw new Error(`שגיאת רשת (${response.status})`);
        const result = await response.json();
        if (result.responseStatus !== 'OK') throw new Error(result.message || 'השרת החזיר שגיאה בעת השמירה.');
    },
    
    // =================================================================
    //  ===== פונקציות חישוב סטטוס (גרסה 6.1, תקינה) =====
    // =================================================================
    
    timeToMinutes: function(dayStr, timeStr) {
        // ... (ללא שינוי מהגרסה הקודמת) ...
        const dayIndex = this.dayMap[dayStr] || 0;
        const parts = timeStr.split(':').map(Number);
        return (dayIndex * 24 * 60) + (parts[0] * 60) + parts[1];
    },

    minutesToTime: function(totalMinutes) {
        // ... (ללא שינוי מהגרסה הקודמת) ...
        if (totalMinutes === this.MINUTES_IN_WEEK) totalMinutes = 0; 
        
        const minutes = totalMinutes % this.MINUTES_IN_WEEK;
        
        const dayIndex = Math.floor(minutes / (24 * 60)) % 7;
        const dayMinutes = minutes % (24 * 60);
        const hours = Math.floor(dayMinutes / 60);
        const mins = dayMinutes % 60;

        return {
            dayName: this.dayNameMap[dayIndex],
            timeStr: `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`,
            dayIndex: dayIndex
        };
    },

    getCurrentWeekMinutes: function() {
        // ... (ללא שינוי מהגרסה הקודמת) ...
        const now = new Date();
        const dayIndex = now.getDay(); // 0 = Sunday (ראשון)
        const hours = now.getHours();
        const minutes = now.getMinutes();
        return (dayIndex * 24 * 60) + (hours * 60) + minutes;
    },
    
    formatTimeDiff: function(diffMinutes) {
        // ... (ללא שינוי מהגרסה הקודמת) ...
        const days = Math.floor(diffMinutes / (24 * 60));
        const hours = Math.floor((diffMinutes % (24 * 60)) / 60);
        const minutes = diffMinutes % 60;
        
        let parts = [];
        if (days > 0) parts.push(`${days} ימים`);
        if (hours > 0) parts.push(`${hours} שעות`);
        if (minutes > 0) parts.push(`${minutes} דקות`);
        if (parts.length === 0) return "פחות מדקה";
        
        return parts.join(', ');
    },

    calculateAndDisplayTimeStatus: function() {
        // ... (ללא שינוי מהגרסה הקודמת) ...
        const container = this.view.querySelector('#time-status-message-container');
        if (!container) return;
        
        if (this.settings.mode === 'open') {
            container.innerHTML = `<div class="info-message" style="padding: 1rem;"><i class="fas fa-check-circle"></i> המערכת פתוחה כעת (כניסה חופשית ללא הגבלה).</div>`;
            return;
        }
        if (this.settings.mode === 'closed') {
            container.innerHTML = `<div class="error-message" style="padding: 1rem;"><i class="fas fa-times-circle"></i> המערכת סגורה כעת (חסימה יזומה).</div>`;
            return;
        }

        const activeRules = this.settings.filters.filter(f => f.enabled && f.parsedValue);
        if (activeRules.length === 0) {
            container.innerHTML = `<div class="warning-message" style="padding: 1rem;"><i class="fas fa-filter"></i> המערכת סגורה כעת (לא הוגדרו כללי סינון פעילים).</div>`;
            return;
        }

        let slots = [];
        activeRules.forEach(f => {
            const parts = f.parsedValue; 
            const start = this.timeToMinutes(parts[3], parts[1]);
            let end = this.timeToMinutes(parts[4], parts[2]);
            
            if (parts[2] === '00:00') {
                 end = this.timeToMinutes(parts[4], '00:00') + 1440;
                 if (parts[4] !== 'sat') {
                     end = end % this.MINUTES_IN_WEEK;
                 } else if (end > this.MINUTES_IN_WEEK) {
                      end = this.MINUTES_IN_WEEK; 
                 }
            }

            if (end < start) {
                slots.push({ start: start, end: this.MINUTES_IN_WEEK }); 
                slots.push({ start: 0, end: end }); 
            } else {
                slots.push({ start: start, end: end });
            }
        });

        slots.sort((a, b) => a.start - b.start);
        
        const mergedSlots = [];
        if (slots.length > 0) {
            let current = { ...slots[0] };
            for (let i = 1; i < slots.length; i++) {
                const next = slots[i];
                if (next.start <= current.end) {
                    current.end = Math.max(current.end, next.end); 
                } else {
                    mergedSlots.push(current); 
                    current = { ...next }; 
                }
            }
            mergedSlots.push(current); 
        }
        
        if (mergedSlots.length > 1) {
            const first = mergedSlots[0];
            const last = mergedSlots[mergedSlots.length - 1];
            if (last.end === this.MINUTES_IN_WEEK && first.start === 0) {
                last.end = first.end;
                mergedSlots.shift(); 
            }
        }
        
        const nowMinutes = this.getCurrentWeekMinutes();
        
        let currentSlot = null;
        for (const s of mergedSlots) {
            if (s.end < s.start) {
                if (nowMinutes >= s.start || nowMinutes < s.end) {
                    currentSlot = s;
                    break;
                }
            } else {
                if (nowMinutes >= s.start && nowMinutes < s.end) {
                    currentSlot = s;
                    break;
                }
            }
        }
        
        if (currentSlot) {
            const endTime = this.minutesToTime(currentSlot.end);
            let diffMinutes;
            
            if (currentSlot.end < nowMinutes) {
                diffMinutes = (this.MINUTES_IN_WEEK - nowMinutes) + currentSlot.end;
            } else {
                diffMinutes = currentSlot.end - nowMinutes;
            }
            
            container.innerHTML = `
                <div class="info-message" style="padding: 1rem;">
                    <i class="fas fa-check-circle"></i> המערכת פתוחה כעת.
                    הסגירה הבאה ביום <strong>${endTime.dayName}</strong> בשעה <strong>${endTime.timeStr}</strong>
                    (בעוד ${this.formatTimeDiff(diffMinutes)}).
                </div>`;
        } else {
            let nextSlot = mergedSlots.find(s => s.start > nowMinutes);
            let diffMinutes;
            
            if (nextSlot) {
                diffMinutes = nextSlot.start - nowMinutes;
            } else {
                nextSlot = mergedSlots[0];
                diffMinutes = (nextSlot.start + this.MINUTES_IN_WEEK) - nowMinutes;
            }
            
            const startTime = this.minutesToTime(nextSlot.start);
            container.innerHTML = `
                <div class="warning-message" style="padding: 1rem;">
                    <i class="fas fa-info-circle"></i> המערכת סגורה כעת.
                    הפתיחה הבאה ביום <strong>${startTime.dayName}</strong> בשעה <strong>${startTime.timeStr}</strong>
                    (בעוד ${this.formatTimeDiff(diffMinutes)}).
                </div>`;
        }
    }
};