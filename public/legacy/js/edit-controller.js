// ======================================================
//  edit-controller.js - גרסה 3.3 (Full Reset Fix)
//  תיקונים: איפוס מלא כולל קובץ INI פנימי, באג חיפוש, מודל
// ======================================================

const editController = {
    // אלמנטים
    modalOverlay: null,
    
    // נתונים
    currentFilePath: null,
    currentFolderPath: null,
    originalLines: [], 
    selectedLines: new Set(), // זיכרון לשמירת הבחירות גם בסינון
    
    // מודאל אזהרה
    activeInterval: null,

    init: async function(filePath) {
        this.currentFilePath = filePath;
        this.currentFolderPath = filePath.substring(0, filePath.lastIndexOf('/'));

        if (!document.getElementById('edit-controller-overlay')) {
            this.injectStyles();
            this.injectHtml();
            this.bindEvents();
        } else {
            this.modalOverlay = document.getElementById('edit-controller-overlay');
        }

        this.resetState(); 
        this.showMainModal();
        this.loadContent();
    },

    // --- איפוס מצב ---
    resetState: function() {
        const searchInput = document.getElementById('edit-search-input');
        const deleteBtn = document.getElementById('edit-delete-btn');
        const badge = document.getElementById('selected-count-badge');
        const selectAll = document.getElementById('edit-select-all');

        // איפוס הזיכרון
        this.selectedLines = new Set();

        if (searchInput) searchInput.value = '';
        if (deleteBtn) {
            deleteBtn.disabled = true;
            deleteBtn.innerHTML = `<i class="fas fa-trash-alt"></i> מחק מסומנים`;
        }
        if (badge) {
            badge.textContent = '0';
            badge.classList.add('hidden');
        }
        if (selectAll) selectAll.checked = false;
        
        document.getElementById('edit-table-container').innerHTML = '';
    },

    // --- שלב 1: טעינה ועיבוד נתונים ---

    loadContent: async function() {
        const container = document.getElementById('edit-table-container');
        container.innerHTML = `<div id="loading"><i class="fas fa-spinner fa-spin"></i> טוען נתונים מהשרת...</div>`;
        
        try {
            const content = await this.fetchFileContent(this.currentFilePath);
            this.originalLines = content.split(/\r?\n/).filter(line => line.trim() !== '');
            
            this.renderTable(this.originalLines);
            this.updateCounter(this.originalLines.length);

        } catch (error) {
            container.innerHTML = `<p class="error-message"><i class="fas fa-exclamation-triangle"></i> שגיאה בטעינה: ${error.message}</p>`;
        }
    },

    fetchFileContent: async function(path) {
        const token = auth.getToken();
        const apiUrl = `${auth.API_BASE}/GetTextFile?token=${token}&what=${encodeURIComponent(path)}&_t=${new Date().getTime()}`;
        const res = await fetch(apiUrl);
        const json = await res.json();
        if (json.responseStatus !== 'OK') return ""; 
        return json.contents;
    },

    // --- שלב 2: תצוגה וחיפוש ---

    renderTable: function(lines) {
        const container = document.getElementById('edit-table-container');
        
        if (!lines || lines.length === 0) {
            container.innerHTML = `<div class="info-message">לא נמצאו רשומות להצגה.</div>`;
            return;
        }

        let html = `
            <table class="editor-table">
                <thead>
                    <tr>
                        <th style="width: 40px;"><input type="checkbox" id="edit-select-all"></th>
                        <th>שם התלמיד</th>
                        <th>טלפון</th>
                        <th>ציון</th>
                        <th>כיתה</th>
                        <th>תאריך</th>
                        <th>שעה</th>
                    </tr>
                </thead>
                <tbody>
        `;

        lines.forEach((line) => {
            const params = new URLSearchParams(line.replace(/%/g, '&').replace(/#/g, '='));
            const encodedLine = encodeURIComponent(line);
            
            // בדיקה האם השורה שמורה בזיכרון כ"מסומנת"
            const isChecked = this.selectedLines.has(line);
            const checkedAttr = isChecked ? 'checked' : '';
            const rowClass = isChecked ? 'selected-row' : '';

            html += `
                <tr class="data-row ${rowClass}">
                    <td class="checkbox-cell" onclick="event.stopPropagation()">
                        <input type="checkbox" class="row-checkbox" ${checkedAttr} 
                               data-line-content="${encodedLine}" 
                               data-name="${params.get('ValName') || 'ללא שם'}">
                    </td>
                    <td>${params.get('ValName') || 'ללא שם'}</td>
                    <td>${params.get('Phone') || ''}</td>
                    <td>${params.get('QuestionScoreTotal') || ''}</td>
                    <td>${params.get('School') || ''}</td>
                    <td dir="ltr">${params.get('Date') || ''}</td>
                    <td dir="ltr">${params.get('Time') || ''}</td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        container.innerHTML = html;

        this.setupTableEvents();
        this.updateSelectionState(); // עדכון הכפתור לפי הזיכרון
    },

    setupTableEvents: function() {
        const selectAll = document.getElementById('edit-select-all');
        const checkboxes = document.querySelectorAll('.row-checkbox');
        
        // אירוע בחר הכל (עובד על מה שמוצג כרגע)
        if(selectAll) {
            selectAll.addEventListener('change', (e) => {
                checkboxes.forEach(cb => {
                    cb.checked = e.target.checked;
                    this.updateMemory(cb); // עדכון הזיכרון
                    this.toggleRowHighlight(cb);
                });
                this.updateSelectionState();
            });
        }

        // לחיצה על שורה
        document.querySelectorAll('.data-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.type === 'checkbox') return;
                const checkbox = row.querySelector('.row-checkbox');
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            });
        });

        // שינוי צ'קבוקס בודד
        checkboxes.forEach(cb => {
            cb.addEventListener('change', () => {
                this.updateMemory(cb); // עדכון הזיכרון
                this.toggleRowHighlight(cb);
                this.updateSelectionState();
            });
        });
    },

    updateMemory: function(checkbox) {
        const content = decodeURIComponent(checkbox.dataset.lineContent);
        if (checkbox.checked) {
            this.selectedLines.add(content);
        } else {
            this.selectedLines.delete(content);
        }
    },

    toggleRowHighlight: function(checkbox) {
        const row = checkbox.closest('tr');
        if (checkbox.checked) row.classList.add('selected-row');
        else row.classList.remove('selected-row');
    },

    filterTable: function(searchTerm) {
        const term = searchTerm.toLowerCase().trim();
        
        if (!term) {
            this.renderTable(this.originalLines);
            return;
        }

        const filteredLines = this.originalLines.filter(line => {
            let cleanLine = line.replace(/[%#]/g, ' '); 
            try {
                cleanLine = decodeURIComponent(cleanLine);
            } catch (e) {}
            return cleanLine.toLowerCase().includes(term);
        });

        this.renderTable(filteredLines);
    },

    updateSelectionState: function() {
        const count = this.selectedLines.size;
        const btn = document.getElementById('edit-delete-btn');
        const countSpan = document.getElementById('selected-count-badge');
        
        if (count > 0) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fas fa-trash-alt"></i> מחק ${count} מסומנים`;
            if (countSpan) {
                countSpan.textContent = count;
                countSpan.classList.remove('hidden');
            }
        } else {
            btn.disabled = true;
            btn.innerHTML = `<i class="fas fa-trash-alt"></i> מחק מסומנים`;
            if (countSpan) countSpan.classList.add('hidden');
        }
    },
    
    updateCounter: function(count) {
        const el = document.getElementById('total-records-count');
        if (el) el.textContent = count;
    },

    // --- שלב 3: תהליך המחיקה ---

    startDeletion: async function() {
        if (this.selectedLines.size === 0) return;

        const linesToDelete = Array.from(this.selectedLines);
        
        const namesToDelete = linesToDelete.map(line => {
            const params = new URLSearchParams(line.replace(/%/g, '&').replace(/#/g, '='));
            return params.get('ValName') || 'ללא שם';
        });

        const btn = document.getElementById('edit-delete-btn');
        const originalHtml = btn.innerHTML;
        
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> בודק שיחות פעילות...`;
        btn.disabled = true;

        try {
            const hasActiveCalls = await this.checkActiveCalls();
            this.showWarningModal(linesToDelete, namesToDelete, hasActiveCalls);
        } catch (e) {
            alert("שגיאה בבדיקת מצב מערכת: " + e.message);
            this.showWarningModal(linesToDelete, namesToDelete, false);
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    },

    checkActiveCalls: async function() {
        const token = auth.getToken();
        const url = `${auth.API_BASE}/GetIncomingCalls?token=${token}`;
        
        const res = await fetch(url);
        const json = await res.json();
        
        if (!json.calls || !Array.isArray(json.calls)) return false;

        let myFolderPath = this.currentFolderPath.replace('ivr2:', '').trim();
        myFolderPath = myFolderPath.replace(/^\/+|\/+$/g, '');

        return json.calls.some(call => {
            if (!call.path) return false;
            let callPath = call.path.toString().trim();
            return callPath.includes(myFolderPath);
        });
    },

    // --- שלב 4: מודאל אזהרה ---

    showWarningModal: function(linesToDelete, namesToDelete, hasActiveCalls) {
        const modal = document.getElementById('safe-delete-modal');
        const container = modal.querySelector('.modal-container');
        const title = document.getElementById('safe-modal-title');
        const content = document.getElementById('safe-modal-content');
        const confirmBtn = document.getElementById('safe-confirm-btn');

        modal.style.display = 'flex'; 
        
        let html = '';
        const namesList = namesToDelete.map(name => `<li>${name}</li>`).join('');

        container.classList.remove('danger-pulse');
        
        if (hasActiveCalls) {
            container.classList.add('danger-pulse');
            title.innerHTML = `<i class="fas fa-radiation-alt fa-spin" style="color:red"></i> עצור! יש תלמידים במבחן!`;
            html += `
                <div class="alert-box danger">
                    <strong>זיהינו פעילות בשלוחת המבחן כעת!</strong><br>
                    יש תלמידים שנמצאים כרגע בתוך השלוחה הזו.<br>
                    מחיקת המבחנים יכול לגרום לאובדן הנתונים שלהם.
                </div>
            `;
            
            let timeLeft = 15;
            confirmBtn.disabled = true;
            confirmBtn.className = 'button button-danger';
            confirmBtn.textContent = `המתן ${timeLeft} שניות`;
            
            if (this.activeInterval) clearInterval(this.activeInterval);
            this.activeInterval = setInterval(() => {
                timeLeft--;
                if (timeLeft <= 0) {
                    clearInterval(this.activeInterval);
                    confirmBtn.disabled = false;
                    confirmBtn.innerHTML = `אני מבין ומחליט לקחת סיכון ולמחוק בכל זאת`;
                } else {
                    confirmBtn.textContent = `המתן ${timeLeft} שניות`;
                }
            }, 1000);

        } else {
            if (this.activeInterval) clearInterval(this.activeInterval);
            title.innerHTML = `אישור מחיקת מבחנים`;
            confirmBtn.className = 'button button-success';
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = `כן, מחק נתונים`;
        }

        html += `
            <p>אתה עומד למחוק את המבחנים של התלמידים הבאים:</p>
            <ul class="names-list">${namesList}</ul>
            <div class="alert-box warning">
                <i class="fas fa-exclamation-circle"></i> שים לב:
                <ul>
                    <li>הפעולה תמחק גם את <strong>היסטוריית התשובות הפנימית</strong>.</li>
                    <li>התלמיד יוכל <strong>להתחיל את המבחן מחדש</strong>.</li>
                </ul>
            </div>
        `;

        content.innerHTML = html;

        confirmBtn.onclick = () => {
            if (this.activeInterval) clearInterval(this.activeInterval);
            this.executeDelete(linesToDelete);
        };
    },

    // --- שלב 5: ביצוע המחיקה והניקוי ---

    executeDelete: async function(linesToDelete) {
        document.getElementById('safe-delete-modal').style.display = 'none';
        
        const container = document.getElementById('edit-table-container');
        container.innerHTML = `<div id="loading"><i class="fas fa-spinner fa-spin"></i> מעבד נתונים ומנקה רשומות...</div>`;

        try {
            // 1. ניקוי הקובץ הפנימי (INI) - התיקון הקריטי
            await this.cleanInternalRecords(linesToDelete);

            // 2. מחיקה מהדוח הראשי
            const currentContent = await this.fetchFileContent(this.currentFilePath);
            const serverLines = currentContent.split(/\r?\n/);
            const contentToDeleteSet = new Set(linesToDelete.map(l => l.trim()));

            const newLines = serverLines.filter(line => {
                if (!line || line.trim() === '') return false;
                return !contentToDeleteSet.has(line.trim());
            });

            let newContent = newLines.join('\r\n');
            if (newContent.length > 0) newContent += '\r\n'; 

            const token = auth.getToken();
            const uploadRes = await fetch(`${auth.API_BASE}/UploadTextFile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ token, what: this.currentFilePath, contents: newContent })
            });
            
            const json = await uploadRes.json();
            if (json.responseStatus !== 'OK') throw new Error(json.message);

            alert('המחיקה בוצעה בהצלחה!');
            
            this.resetState();
            this.loadContent();

        } catch (error) {
            alert('שגיאה בתהליך המחיקה: ' + error.message);
            this.loadContent();
        }
    },

    // --- פונקציה חדשה לניקוי קובץ ה-INI הפנימי ---
    cleanInternalRecords: async function(linesToDelete) {
        // איסוף מזהים (תעודות זהות/טלפונים) למחיקה
        const idsToRemove = new Set();
        
        linesToDelete.forEach(line => {
             const params = new URLSearchParams(line.replace(/%/g, '&').replace(/#/g, '='));
             // מנסה למצוא לפי סדר עדיפות: Id -> EnterId -> Phone
             const id = params.get('Id') || params.get('EnterId') || params.get('Phone');
             if(id) idsToRemove.add(id);
        });
        
        if (idsToRemove.size === 0) return; // לא נמצאו מזהים, אין מה לעשות

        const iniPath = this.currentFolderPath + '/ExaminationAmericanMiddle.ini';
        
        try {
            // טעינת קובץ ה-INI
            const content = await this.fetchFileContent(iniPath);
            if (!content) return; // הקובץ לא קיים, מדלגים
            
            const lines = content.split(/\r?\n/);
            const originalCount = lines.length;
            
            // סינון השורות
            const newLines = lines.filter(line => {
                if (!line.trim()) return false;
                
                // בדיקה האם השורה שייכת לאחד המזהים שנמחקו
                // הפורמט בקובץ הוא: list_all_information-ID-...
                const match = line.match(/^list_all_information-([^-]+)-/);
                if (match && match[1] && idsToRemove.has(match[1])) {
                    // זו שורה של תלמיד מחוק - נשמיט אותה
                    return false; 
                }
                return true; // שומרים את השורה
            });
            
            // אם לא היה שינוי, לא צריך לשמור סתם
            if (newLines.length === originalCount) return;
            
            // שמירה חזרה לשרת
             let newContent = newLines.join('\r\n');
             if (newLines.length > 0) newContent += '\r\n';
             
             const token = auth.getToken();
             await fetch(`${auth.API_BASE}/UploadTextFile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ token, what: iniPath, contents: newContent })
            });
            
            console.log(`נוקו רשומות פנימיות עבור ${idsToRemove.size} תלמידים.`);

        } catch (e) {
            console.error("Warning: Failed to clean internal INI records", e);
            // אנחנו לא עוצרים את המחיקה הראשית אם זה נכשל, אבל כדאי לדעת
        }
    },

    // --- עזרים והזרקות ---
    hideMainModal: function() {
        if(this.modalOverlay) this.modalOverlay.classList.remove('visible');
        this.resetState();
        if(typeof testsController !== 'undefined') testsController.init(true);
    },
    
    showMainModal: function() {
        if(this.modalOverlay) this.modalOverlay.classList.add('visible');
    },

    bindEvents: function() {
        this.modalOverlay.querySelector('.close-btn').addEventListener('click', () => this.hideMainModal());
        document.getElementById('edit-close-footer-btn').addEventListener('click', () => this.hideMainModal());
        
        const searchInput = document.getElementById('edit-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.filterTable(e.target.value));
        }
        
        const mainDelBtn = document.getElementById('edit-delete-btn');
        if (mainDelBtn) {
            mainDelBtn.addEventListener('click', () => this.startDeletion());
        }

        document.getElementById('safe-cancel-btn').addEventListener('click', () => {
             if (this.activeInterval) clearInterval(this.activeInterval);
             document.getElementById('safe-delete-modal').style.display = 'none';
        });
    },

    injectHtml: function() {
        const mainModal = `
            <div id="edit-controller-overlay">
                <div class="modal-container large" style="max-width: 1000px; height: 85vh; display: flex; flex-direction: column;">
                    
                    <div class="modal-header edit-mode-header">
                        <h2><i class="fas fa-edit"></i> מחיקת מבחני תלמידים</h2>
                        <span class="close-btn">&times;</span>
                    </div>

                    <div class="edit-controls-bar">
                        <div class="instruction-text">
                            <i class="fas fa-info-circle"></i> למחיקת מבחני תלמידים ואפשור מבחן חוזר, נא בחרו את המבחנים הרצויים ולחצו על כפתור המחיקה.
                        </div>
                        <div class="controls-row">
                            <div class="search-box">
                                <i class="fas fa-search"></i>
                                <input type="text" id="edit-search-input" placeholder="חיפוש...">
                            </div>
                            <div class="stats-box">
                                סה"כ נבחנים: <strong id="total-records-count">0</strong>
                            </div>
                        </div>
                    </div>

                    <div id="edit-table-container" class="table-container-scroll"></div>

                    <div class="modal-footer edit-footer">
                        <div class="footer-right">
                             <button id="edit-delete-btn" class="button button-danger" disabled>
                                <i class="fas fa-trash-alt"></i> מחק מסומנים
                                <span id="selected-count-badge" class="badge hidden">0</span>
                            </button>
                        </div>
                        <button id="edit-close-footer-btn" class="button button-archive">סיום וחזרה</button>
                    </div>
                </div>
            </div>

            <div id="safe-delete-modal" class="modal-overlay" style="display:none; z-index:9999;">
                <div class="modal-container warning-modal">
                    <div class="modal-header">
                        <h2 id="safe-modal-title"></h2>
                    </div>
                    <div id="safe-modal-content" class="modal-body warning-content"></div>
                    <div class="modal-footer centered-footer">
                        <button id="safe-confirm-btn" class="button"></button>
                        <button id="safe-cancel-btn" class="button button-archive">ביטול</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', mainModal);
        this.modalOverlay = document.getElementById('edit-controller-overlay');
    },

    injectStyles: function() {
        const style = document.createElement('style');
        style.innerHTML = `
            /* תצוגה ראשית */
            #edit-controller-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 2000; display: none; justify-content: center; align-items: center; }
            #edit-controller-overlay.visible { display: flex; }
            
            .edit-mode-header { background: #fff3cd; border-bottom: 2px solid #ffecb5; color: #856404; }
            .edit-controls-bar { padding: 15px; background: #fcfcfc; border-bottom: 1px solid #eee; }
            .instruction-text { margin-bottom: 10px; color: #666; font-size: 0.95em; }
            .controls-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
            .search-box { position: relative; flex: 1; max-width: 400px; }
            .search-box i { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: #999; }
            .search-box input { width: 100%; padding: 8px 35px 8px 10px; border: 1px solid #ddd; border-radius: 4px; }
            
            .table-container-scroll { flex: 1; overflow-y: auto; position: relative; }
            .editor-table { width: 100%; border-collapse: collapse; }
            .editor-table th { position: sticky; top: 0; background: #f8f9fa; padding: 10px; text-align: right; border-bottom: 2px solid #ddd; z-index: 5; }
            .editor-table td { padding: 8px 10px; border-bottom: 1px solid #eee; cursor: pointer; }
            .editor-table tr:hover { background-color: #f1f8ff; }
            .selected-row { background-color: #e8f0fe !important; }
            
            .edit-footer { display: flex; justify-content: space-between; border-top: 1px solid #eee; padding: 15px; background: #fff; }
            .badge { background: rgba(255,255,255,0.3); padding: 2px 6px; border-radius: 10px; font-size: 0.8em; margin-right: 5px; }
            
            /* מודאל אזהרה - תיקון מיקום וסטייל */
            #safe-delete-modal { 
                position: fixed; 
                top: 0; 
                left: 0; 
                width: 100%; 
                height: 100%; 
                background: rgba(0,0,0,0.5); 
                z-index: 9999; 
                display: none; 
                justify-content: center; 
                align-items: center; 
            }
            
            .warning-modal { width: 500px; max-width: 95%; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 5px 20px rgba(0,0,0,0.3); }
            .warning-content { text-align: center; font-size: 1.05em; padding: 10px 0; }
            .names-list { list-style: none; padding: 0; margin: 15px 0; max-height: 120px; overflow-y: auto; background: #f9f9f9; border: 1px solid #eee; text-align: right; }
            .names-list li { padding: 6px 10px; border-bottom: 1px solid #eee; }
            .alert-box { padding: 12px; border-radius: 5px; margin: 10px 0; text-align: right; font-size: 0.95em; }
            .alert-box.danger { background: #ffebeb; color: #721c24; border: 1px solid #f5c6cb; }
            .alert-box.warning { background: #fff3cd; color: #856404; border: 1px solid #ffeeba; }
            
            .danger-pulse { border: 3px solid red; animation: pulse 1.5s infinite; }
            .centered-footer { justify-content: center; gap: 10px; display: flex; margin-top: 15px; }
            
            @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.7); } 70% { box-shadow: 0 0 0 15px rgba(220, 53, 69, 0); } 100% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0); } }
        `;
        document.head.appendChild(style);
    }
};