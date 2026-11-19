// ======================================================
//  reports-controller.js - ניהול דוחות ולוגים (עיצוב חדש ומתקדם)
// ======================================================

const reportsController = {
    // רכיבי DOM
    view: document.getElementById('logs-view'),
    container: document.getElementById('reports-app-container'),
    
    // מצב נוכחי
    currentLogType: 'password', // 'password' | 'enterid'
    currentData: [], // הנתונים המקוריים שנטענו
    filteredData: [], // הנתונים לאחר סינון (להצגה)
    
    // נתיבים
    PASSWORD_LOG_PATH: 'ivr2:/Log/LogPassword.ini',
    ENTERID_LOG_PATH: 'ivr2:/Log/LogEnterID.ymgr',

    init: function() {
        if (!this.view.querySelector('.reports-layout')) {
            this.renderLayout();
        }
        // טעינה ראשונית - מעדכן את ה-UI ומביא נתונים
        this.switchLogType(this.currentLogType);
    },

    // יצירת מבנה הדף החדש
    renderLayout: function() {
        if (this.container) this.container.innerHTML = ''; 
        
        const html = `
            <div class="reports-layout">
                <div class="log-selection-area">
                    <div class="log-card" id="card-log-password" onclick="reportsController.handleLogSwitch('password')">
                        <div class="card-icon"><i class="fas fa-key"></i></div>
                        <div class="card-content">
                            <h3>לוג סיסמאות</h3>
                            <span class="card-desc">תיעוד סיסמאות במערכת</span>
                        </div>
                        <div class="card-indicator"></div>
                    </div>
                    
                    <div class="log-card" id="card-log-enterid" onclick="reportsController.handleLogSwitch('enterid')">
                        <div class="card-icon"><i class="fas fa-id-card"></i></div>
                        <div class="card-content">
                            <h3>לוג כניסות (EnterID)</h3>
                            <span class="card-desc">תיעוד כניסות למערכת</span>
                        </div>
                        <div class="card-indicator"></div>
                    </div>
                </div>

                <div class="filters-toolbar">
                    <div class="filter-group main-search">
                        <i class="fas fa-search"></i>
                        <input type="text" id="logs-general-search" placeholder="חיפוש חופשי (שם, טלפון)...">
                    </div>

                    <div id="filters-password" class="specific-filters hidden">
                        <div class="filter-group">
                            <label><i class="fas fa-filter"></i> סינון לפי סטטוס:</label>
                            <select id="filter-pass-status">
                                <option value="all">הכל</option>
                                <option value="OK">סיסמה נכונה (OK)</option>
                                <option value="ERROR">סיסמה שגויה (ERROR)</option>
                            </select>
                        </div>
                    </div>

                    <div id="filters-enterid" class="specific-filters hidden">
                        <div class="filter-group">
                            <i class="fas fa-fingerprint"></i>
                            <input type="text" id="filter-enterid-num" placeholder="סינון לפי קוד תלמיד">
                        </div>
                    </div>

                    <div class="toolbar-actions">
                        <button id="btn-refresh-log" class="button button-icon" title="רענן נתונים"><i class="fas fa-sync-alt"></i></button>
                    </div>
                </div>
                
                <div id="logs-status-bar" class="status-bar"></div>

                <div id="logs-table-container"></div>
            </div>
        `;
        
        this.view.innerHTML = html;
        this.addEventListeners();
    },

    addEventListeners: function() {
        // האזנה לשינויים בשדות הסינון
        document.getElementById('logs-general-search').addEventListener('input', () => this.applyFilters());
        
        document.getElementById('filter-pass-status').addEventListener('change', () => this.applyFilters());
        
        document.getElementById('filter-enterid-num').addEventListener('input', () => this.applyFilters());

        // כפתור רענון
        document.getElementById('btn-refresh-log').addEventListener('click', () => {
            this.loadLog(this.currentLogType);
        });
    },

    // פונקציית עזר למעבר בין לוגים (מופעלת מה-HTML)
    handleLogSwitch: function(type) {
        if (this.currentLogType === type) return; // מניעת טעינה כפולה
        this.switchLogType(type);
    },

    switchLogType: function(type) {
        this.currentLogType = type;
        
        // עדכון UI של הכרטיסיות
        document.querySelectorAll('.log-card').forEach(el => el.classList.remove('active'));
        document.getElementById(`card-log-${type}`).classList.add('active');

        // הצגת המסננים הרלוונטיים
        document.querySelectorAll('.specific-filters').forEach(el => el.classList.add('hidden'));
        document.getElementById(`filters-${type}`).classList.remove('hidden');

        // איפוס שדות הסינון
        document.getElementById('logs-general-search').value = '';
        document.getElementById('filter-pass-status').value = 'all';
        document.getElementById('filter-enterid-num').value = '';

        // טעינת הנתונים
        this.loadLog(type);
    },

    loadLog: async function(type) {
        const container = document.getElementById('logs-table-container');
        const status = document.getElementById('logs-status-bar');
        
        container.innerHTML = `<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> טוען נתונים...</div>`;
        status.innerHTML = 'טוען...';

        try {
            if (type === 'password') {
                await this.fetchAndRenderPasswordLog();
            } else {
                await this.fetchAndRenderEnterIDLog();
            }
        } catch (error) {
            container.innerHTML = `<div class="error-state"><i class="fas fa-exclamation-triangle"></i> שגיאה בטעינת הלוג: ${error.message}</div>`;
            status.innerHTML = 'שגיאה';
        }
    },

    // --- לוגיקה ללוג סיסמאות ---
    fetchAndRenderPasswordLog: async function() {
        const token = auth.getToken();
        const url = `${auth.API_BASE}/GetTextFile?token=${token}&what=${encodeURIComponent(this.PASSWORD_LOG_PATH)}&_=${Date.now()}`;
        
        const response = await fetch(url);
        const data = await response.json();

        if (data.responseStatus !== 'OK') {
             if (data.message === 'File Not Found') {
                 this.currentData = [];
             } else {
                 throw new Error(data.message);
             }
        } else {
            this.currentData = this.parsePasswordContent(data.contents);
        }
        
        this.updateStatusLine(data.file ? data.file.mtime : 'לא ידוע', this.currentData.length);
        this.applyFilters(); // מפעיל את הסינון והרינדור
    },

    parsePasswordContent: function(text) {
        if (!text) return [];
        const lines = text.split('\n');
        const rows = [];
        
        lines.forEach(line => {
            if (!line.trim()) return;
            const statusMatch = line.match(/Password-(OK|ERROR)/);
            const phoneMatch = line.match(/Phone-([\d]+)/);
            const dateMatch = line.match(/Date-([\d\-]+)/);
            const timeMatch = line.match(/\.(\d{2}:\d{2}:\d{2})/);
            const pathMatch = line.match(/^([^\.]+)\./); 

            if (dateMatch) {
                const dateStr = dateMatch[1];
                const dateParts = dateStr.split('-');
                const displayDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : dateStr;
                
                let rawPath = pathMatch ? pathMatch[1] : '?';
                let cleanPath = rawPath;
                if (rawPath.includes('-')) {
                    cleanPath = rawPath.split('-').slice(1).join('-');
                }

                rows.push({
                    date: displayDate,
                    time: timeMatch ? timeMatch[1] : '00:00:00',
                    phone: phoneMatch ? phoneMatch[1] : '---',
                    status: statusMatch ? statusMatch[1] : 'UNKNOWN',
                    path: cleanPath,
                    // שדה עזר לחיפוש
                    searchText: `${displayDate} ${phoneMatch ? phoneMatch[1] : ''} ${cleanPath}`.toLowerCase()
                });
            }
        });
        return rows.reverse(); 
    },

    // --- לוגיקה ללוג כניסות (YMGR) ---
    fetchAndRenderEnterIDLog: async function() {
        const token = auth.getToken();
        const url = `${auth.API_BASE}/RenderYMGRFile?token=${token}&wath=${encodeURIComponent(this.ENTERID_LOG_PATH)}&convertType=json&_=${Date.now()}`;
        
        const response = await fetch(url);
        const data = await response.json();

        if (data.responseStatus !== 'OK') {
             if (data.message === 'File Not Found') {
                 this.currentData = [];
             } else {
                 throw new Error(data.message);
             }
        } else {
            this.currentData = data.data || [];
            // מיון לפי תאריך יורד
            this.currentData.sort((a, b) => {
                const dateA = this.parseDateTime(a['תאריך'], a['שעה']);
                const dateB = this.parseDateTime(b['תאריך'], b['שעה']);
                return dateB - dateA;
            });
            
            // הכנת שדה חיפוש לכל שורה לביצועים טובים יותר
            this.currentData.forEach(row => {
                row.searchText = `${row['שם'] || ''} ${row['טלפון'] || ''} ${row['מספר זיהוי'] || ''} ${row['סוג זיהוי'] || ''}`.toLowerCase();
            });
        }

        this.updateStatusLine(null, this.currentData.length);
        this.applyFilters();
    },

    parseDateTime: function(d, t) {
        if (!d) return 0;
        const parts = d.split('/');
        const timeParts = (t || '00:00:00').split(':');
        if (parts.length < 3) return 0;
        return new Date(parts[2], parts[1]-1, parts[0], timeParts[0], timeParts[1], timeParts[2] || 0).getTime();
    },

    // --- מנוע הסינון ---
    applyFilters: function() {
        const generalSearch = document.getElementById('logs-general-search').value.toLowerCase();
        
        let filtered = this.currentData;

        // 1. סינון טקסט חופשי (משותף לכולם)
        if (generalSearch) {
            filtered = filtered.filter(row => row.searchText.includes(generalSearch));
        }

        // 2. סינונים ספציפיים
        if (this.currentLogType === 'password') {
            const statusFilter = document.getElementById('filter-pass-status').value;
            if (statusFilter !== 'all') {
                filtered = filtered.filter(row => row.status === statusFilter);
            }
        } 
        else if (this.currentLogType === 'enterid') {
            const idFilter = document.getElementById('filter-enterid-num').value.trim();
            if (idFilter) {
                filtered = filtered.filter(row => row['מספר זיהוי'] && row['מספר זיהוי'].includes(idFilter));
            }
        }

        this.filteredData = filtered;
        this.renderTable(filtered);
    },

    // --- רינדור הטבלה ---
    renderTable: function(data) {
        const container = document.getElementById('logs-table-container');
        
        if (data.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <p>לא נמצאו נתונים תואמים לחיפוש</p>
                </div>`;
            return;
        }

        let headers = [];
        if (this.currentLogType === 'password') {
            headers = ['תאריך', 'שעה', 'טלפון', 'סטטוס', 'שלוחה'];
        } else {
            headers = ['תאריך', 'שעה', 'שם', 'טלפון', 'סוג זיהוי', 'מספר זיהוי', 'שלוחה'];
        }

        let html = `<table class="report-table"><thead><tr>`;
        headers.forEach(h => html += `<th>${h}</th>`);
        html += `</tr></thead><tbody>`;

        data.forEach(row => {
            html += `<tr>`;
            if (this.currentLogType === 'password') {
                const isOk = row.status === 'OK';
                const statusText = isOk ? 'כניסה אושרה' : 'סיסמא שגויה';
                const statusClass = isOk ? 'status-badge success' : 'status-badge error';
                const statusIcon = isOk ? '<i class="fas fa-check"></i>' : '<i class="fas fa-times"></i>';
                
                html += `<td>${row.date}</td>`;
                html += `<td>${row.time}</td>`;
                html += `<td>${row.phone}</td>`;
                html += `<td><span class="${statusClass}">${statusIcon} ${statusText}</span></td>`;
                html += `<td>${row.path}</td>`;
            } else {
                html += `<td>${row['תאריך'] || '-'}</td>`;
                html += `<td>${row['שעה'] || '-'}</td>`;
                html += `<td><strong>${row['שם'] || ''}</strong></td>`;
                html += `<td>${row['טלפון'] || ''}</td>`;
                html += `<td>${row['סוג זיהוי'] || ''}</td>`;
                html += `<td>${row['מספר זיהוי'] || ''}</td>`;
                html += `<td>${row['שלוחה'] || ''}</td>`;
            }
            html += `</tr>`;
        });

        html += `</tbody></table>`;
        container.innerHTML = html;
        
        // עדכון שורת סטטוס עם כמות מסוננת
        this.updateCountDisplay(data.length);
    },

    updateStatusLine: function(lastUpdate, totalCount) {
        // שומר את המידע בצד אם נצטרך, אבל התצוגה מתעדכנת ב-updateCountDisplay
        this.lastUpdateStr = lastUpdate;
        this.totalCount = totalCount;
    },

    updateCountDisplay: function(shownCount) {
        const status = document.getElementById('logs-status-bar');
        if (!status) return;

        let text = `מציג <strong>${shownCount}</strong> מתוך <strong>${this.totalCount || 0}</strong> רשומות`;
        
        if (this.lastUpdateStr && this.currentLogType === 'password') {
            text += ` <span class="divider">|</span> עדכון קובץ אחרון: ${this.lastUpdateStr}`;
        }
        status.innerHTML = text;
    }
};

// הפיכת הפונקציה לגלובלית כדי שה-HTML יוכל לגשת אליה (עבור ה-onclick)
window.reportsController = reportsController;