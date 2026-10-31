// ======================================================
//  tests-controller.js - ניהול תצוגת מבחן (פעיל או ארכיון)
// ======================================================

const testsController = {
    viewContent: document.getElementById('tests-view-content'),
    activeTestPathInput: document.getElementById('active-test-path-input'),
    
    initialized: false,
    currentReportData: [],

    init: function(forceRefresh = false) {
        if (!this.initialized || forceRefresh) {
            this.initialized = true;
            this.showActiveTestView();
        }
    },
    
    buildTestView: function() {
        this.viewContent.innerHTML = `
            <div class="view-actions">
            </div>
            <div id="report-header" class="hidden">
                <div id="report-stats"></div>
                <h2 id="report-title"></h2>
                <div id="report-actions">
                    <button id="show-questions-btn-report" class="button button-info"><i class="fas fa-list-ol"></i> הצג שאלות</button>
                    <button id="archive-test-btn" class="button button-archive"><i class="fas fa-archive"></i> סגירת מבחן</button>
                    <button id="edit-test-btn" class="button button-settings"><i class="fas fa-edit"></i> ערוך קובץ</button>
                    <div class="dropdown">
                        <button class="button button-success"><i class="fas fa-download"></i> יצוא קובץ</button>
                        <div class="dropdown-content">
                            <a href="#" id="export-excel-btn"><i class="fas fa-file-excel"></i> Excel</a>
                            <a href="#" id="export-word-btn"><i class="fas fa-file-word"></i> Word</a>
                        </div>
                    </div>
                </div>
            </div>
            <div id="report-container"></div>
            
            <div id="status-change-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5); z-index: 9999; justify-content: center; align-items: center;">
                <div class="modal-container" style="background: white; padding: 0; border-radius: 8px; max-width: 500px; width: 90%; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden;">
                    <div class="modal-header" style="padding: 15px 20px; background-color: #f8f9fa; border-bottom: 1px solid #dee2e6; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; font-size: 1.25rem;"><i class="fas fa-exclamation-circle" style="color: #ffc107;"></i> שינוי סטטוס ידני</h3>
                        <span id="close-status-modal" style="cursor: pointer; font-size: 1.5rem;">&times;</span>
                    </div>
                    <div class="modal-body" style="padding: 20px; line-height: 1.6;">
                        <p style="margin-bottom: 5px;"><strong>המנגנון עובד בצורה אוטומטית:</strong></p>
                        <p style="margin: 0;">כשסוגרים את המבחן דרך הממשק הוא נועל את המבחן אוטומטית,</p>
                        <p style="margin: 0;">וכשמקליטים שאלות הוא פותח את המבחן אוטומטית.</p>
                        
                        <p id="status-modal-question" style="margin: 15px 0; font-weight: bold;"></p>
                        
                        <div style="background-color: #e2e3e5; padding: 10px; border-radius: 5px; font-size: 0.9em; color: #383d41;">
                            <i class="fas fa-info-circle"></i> שימו לב: המנגנון כאן לא קשור בכלל לזמנים של המבחן. מדובר בחסימה טכנית של שלוחת המבחן בלבד לצורך מניעת דוחות שגויים.
                        </div>
                    </div>
                    <div class="modal-footer" style="padding: 15px 20px; background-color: #f8f9fa; border-top: 1px solid #dee2e6; display: flex; justify-content: flex-end; gap: 10px;">
                        <button id="cancel-status-change" class="button button-danger">ביטול</button>
                        <button id="confirm-status-change" class="button button-success">אישור וביצוע</button>
                    </div>
                </div>
            </div>
        `;
        
        // Modal Event Listeners
        const modal = document.getElementById('status-change-modal');
        document.getElementById('close-status-modal').onclick = () => modal.style.display = 'none';
        document.getElementById('cancel-status-change').onclick = () => modal.style.display = 'none';

       // הוספת ספינר לכפתור סגירת מבחן
        const archiveBtn = document.getElementById('archive-test-btn');
        archiveBtn.addEventListener('click', async () => {
            // שמירת התוכן המקורי (האייקון והטקסט)
            const originalContent = archiveBtn.innerHTML;
            
            // שינוי לספינר ונטרול הכפתור
            archiveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> סגירת מבחן';
            archiveBtn.disabled = true;

            try {
                // המתנה לטעינת התהליך
                await archiveProcessController.init();
            } catch (error) {
                console.error("Error starting archive process:", error);
                alert("אירעה שגיאה בטעינת תהליך הארכיון");
            } finally {
                // החזרת הכפתור למצב המקורי (רק אם הוא עדיין קיים בדף)
                if (document.body.contains(archiveBtn)) {
                    archiveBtn.innerHTML = originalContent;
                    archiveBtn.disabled = false;
                }
            }
        });
        
        document.getElementById('edit-test-btn').addEventListener('click', () => {
            const path = testsController.activeTestPathInput.value;
            editController.init(path);
        });

        app.setupExportButtons(
            { 
                excel: document.getElementById('export-excel-btn'), 
                word: document.getElementById('export-word-btn') 
            },
            () => document.getElementById('report-container'),
            () => document.getElementById('report-title'),
            () => this.currentReportData
        );
    },
    
    showActiveTestView: async function() {
        this.buildTestView();
        
        const viewActions = this.viewContent.querySelector('.view-actions');
        
        // עדכון: הוספת כפתור ייבוא שאלות
        viewActions.innerHTML = `
            <button id="past-tests-btn" class="button button-browse"><i class="fas fa-history"></i> מבחנים קודמים</button>
            <button id="show-questions-main-btn" class="button button-info"><i class="fas fa-list-ol"></i> הצג שאלות מבחן</button>
            <button id="import-questions-btn" class="button" style="background-color: #4b5563; color: white;"><i class="fas fa-file-import"></i> ייבוא שאלות</button>
            
            <div id="test-status-container" style="display: none; margin-right: 10px; align-items: center; gap: 6px; background-color: #f1f3f5; padding: 1px 8px; border-radius: 15px; border: 1px solid #ced4da; font-size: 0.8rem; height: auto; width: fit-content;">
                <span id="test-status-text" style="font-weight: 600;"></span>
                <button id="test-status-toggle-btn" class="button" title="שינוי סטטוס ידני" style="padding: 0; font-size: 1em; height: 26px; width: 26px; min-height: unset; line-height: 26px; border-radius: 50%; margin: 0; display: flex; align-items: center; justify-content: center;"></button>
            </div>
        `;
        document.getElementById('past-tests-btn').addEventListener('click', () => archiveController.init());
        
        document.getElementById('show-questions-main-btn').addEventListener('click', () => {
            const path = this.activeTestPathInput.value;
            const title = "מבחן פעיל";
            questionsController.displayTestQuestions(path, title);
        });

        // האזנה לכפתור ייבוא השאלות החדש
        document.getElementById('import-questions-btn').addEventListener('click', () => {
            if(typeof importQuestionsController !== 'undefined') {
                importQuestionsController.init(this.activeTestPathInput.value);
            } else {
                alert('מודול הייבוא חסר. אנא ודא שהוספת את הסקריפט import-questions-controller.js לקובץ הראשי.');
            }
        });
        
        document.getElementById('show-questions-btn-report').style.display = 'none';

        // ביצוע בדיקת הסטטוס
        this.checkTestStatus();

        const reportHeader = document.getElementById('report-header');
        const reportContainer = document.getElementById('report-container');
        const reportTitle = document.getElementById('report-title');
        const reportStatsEl = document.getElementById('report-stats');
        
        try {
            const data = await app.fetchData(this.activeTestPathInput.value, 'דוח מבחן פעיל', reportHeader, reportContainer, reportTitle);
            if (data) {
                this.currentReportData = data;
                app.createReportTable(data, reportContainer, 'tests');
                reportStatsEl.innerHTML = `סה"כ נבחנים: <strong>${data.length}</strong>`;
            } else {
                 reportStatsEl.innerHTML = '';
            }
        } catch (error) {
            reportStatsEl.innerHTML = '';
            if (error.message === 'Invalid path') {
                reportContainer.innerHTML = `<p class="info-message"><i class="fas fa-info-circle"></i> אין כעת מבחן פעיל.</p>`;
            } else {
                reportContainer.innerHTML = `<p class="error-message"><i class="fas fa-exclamation-triangle"></i> שגיאה בטעינת הנתונים: ${error.message}</p>`;
            }
        }
    },

    // פונקציה לבדיקת סטטוס המבחן
    checkTestStatus: async function() {
        const container = document.getElementById('test-status-container');
        const statusText = document.getElementById('test-status-text');
        const toggleBtn = document.getElementById('test-status-toggle-btn');
        
        if (!statusText || !toggleBtn || !container) return;
        
        try {
            const token = auth.getToken();
            const response = await fetch(`${auth.API_BASE}/GetTextFile?token=${token}&what=ivr2:/1/1/ext.ini`);
            if (!response.ok) throw new Error('Network response was not ok');
            const text = await response.text();
            
            const match = text.match(/enter_foldar_end_time=(.*)/);
            let isBlocked = false;
            
            if (match && match[1]) {
                const value = match[1].trim();
                const dateParts = value.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/);
                
                if (dateParts) {
                    const date = new Date(dateParts[1], dateParts[2] - 1, dateParts[3], dateParts[4], dateParts[5], dateParts[6]);
                    if (date < new Date()) {
                        isBlocked = true;
                    }
                }
            }
            
            // הצגת הקונטיינר רק לאחר שיש תשובה
            container.style.display = 'inline-flex';

            // עיצוב משותף וקומפקטי לכפתור האייקון
            const btnStyle = 'padding: 0; font-size: 1em; height: 26px; width: 26px; min-height: unset; line-height: 26px; border-radius: 50%; margin: 0; display: inline-flex; align-items: center; justify-content: center;';

            if (isBlocked) {
                statusText.innerHTML = '<span style="color: #dc3545;"><i class="fas fa-lock"></i> המבחן חסום</span>';
                // כפתור ירוק עם מנעול פתוח (לפתיחה)
                toggleBtn.innerHTML = '<i class="fas fa-lock-open"></i>';
                toggleBtn.className = 'button button-success';
                toggleBtn.style.cssText = btnStyle;
                toggleBtn.onclick = () => this.openStatusModal('open');
            } else {
                statusText.innerHTML = '<span style="color: #28a745;"><i class="fas fa-lock-open"></i> המבחן פתוח</span>';
                // כפתור אדום עם מנעול סגור (לחסימה)
                toggleBtn.innerHTML = '<i class="fas fa-lock"></i>';
                toggleBtn.className = 'button button-danger';
                toggleBtn.style.cssText = btnStyle;
                toggleBtn.onclick = () => this.openStatusModal('block');
            }
            
        } catch (error) {
            console.error('Error checking status:', error);
            container.style.display = 'none'; // הסתרה במקרה של שגיאה
        }
    },

    openStatusModal: function(action) {
        const modal = document.getElementById('status-change-modal');
        const questionText = document.getElementById('status-modal-question');
        const confirmBtn = document.getElementById('confirm-status-change');
        
        if (action === 'open') {
            questionText.innerHTML = 'האם אתם בטוחים שברצונכם <span style="color: #28a745;">לפתוח</span> את המבחן באופן ידני?';
        } else {
            questionText.innerHTML = 'האם אתם בטוחים שברצונכם <span style="color: #dc3545;">לחסום</span> את המבחן באופן ידני?';
        }
        
        modal.style.display = 'flex';
        
        // הסרת האזנות קודמות כדי למנוע כפילויות
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        
        newConfirmBtn.addEventListener('click', async () => {
            modal.style.display = 'none';
            await this.toggleTestStatus(action);
        });
    },

    // פונקציה לשינוי הסטטוס
    toggleTestStatus: async function(action) {
        const value = action === 'block' ? '2019-07-09-18-52-30' : 'no';
        const token = auth.getToken();
        const apiUrl = `${auth.API_BASE}/UpdateExtension?token=${token}&path=ivr2:/1/1&enter_foldar_end_time=${value}`;
        
        const toggleBtn = document.getElementById('test-status-toggle-btn');
        const originalContent = toggleBtn.innerHTML;
        
        // אינדיקציה לטעינה באייקון בלבד
        toggleBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        toggleBtn.disabled = true;

        try {
            const response = await fetch(apiUrl);
            const result = await response.json();
            
            if (result.responseStatus === 'OK') {
                await this.checkTestStatus();
            } else {
                alert('שגיאה: ' + (result.message || 'לא ידועה'));
                toggleBtn.innerHTML = originalContent;
            }
        } catch (error) {
            alert('שגיאת תקשורת');
            toggleBtn.innerHTML = originalContent;
        } finally {
            toggleBtn.disabled = false;
        }
    },
    
    displayArchivedReport: async function(path, title) {
        this.buildTestView();
        
        const viewActions = this.viewContent.querySelector('.view-actions');
        viewActions.classList.add('archive-actions');
        viewActions.innerHTML = `
            <div class="archive-nav-buttons">
                <button id="back-to-active-btn" class="button button-success"><i class="fas fa-home"></i> חזור למבחן הפעיל</button>
                <button id="back-to-explorer-btn" class="button button-browse"><i class="fas fa-arrow-left"></i> חזור לסייר</button>
            </div>
        `;
        document.getElementById('back-to-active-btn').addEventListener('click', () => this.init(true));
        document.getElementById('back-to-explorer-btn').addEventListener('click', () => archiveController.showExplorer());

        document.getElementById('show-questions-btn-report').addEventListener('click', () => {
             questionsController.displayTestQuestions(path, title);
        });

        document.getElementById('archive-test-btn').style.display = 'none';
        document.getElementById('edit-test-btn').style.display = 'none';
        document.getElementById('show-questions-btn-report').style.display = 'inline-flex';

        const reportHeader = document.getElementById('report-header');
        const reportContainer = document.getElementById('report-container');
        const reportTitle = document.getElementById('report-title');
        const reportStatsEl = document.getElementById('report-stats');

        try {
            const data = await app.fetchData(path, title, reportHeader, reportContainer, reportTitle);
            if (data) {
                this.currentReportData = data;
                app.createReportTable(data, reportContainer, 'tests');
                reportStatsEl.innerHTML = `סה"כ נבחנים: <strong>${data.length}</strong>`;
            } else {
                reportStatsEl.innerHTML = '';
            }
        } catch (error) {
             reportStatsEl.innerHTML = '';
             reportContainer.innerHTML = `<p class="error-message"><i class="fas fa-exclamation-triangle"></i> שגיאה בטעינת הנתונים: ${error.message}</p>`;
        }
    }
};