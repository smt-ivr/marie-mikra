// ==================================================
//  script.js - בקר ראשי ופונקציות משותפות
// ==================================================

const app = {
    toastTimer: null, // משתנה לניהול הטיימר של הטוסט
    USE_OLD_ANNOUNCEMENTS: false, // שנה ל-true כדי להחזיר את מערכת ההודעות הישנה

    // אתחול כללי
    init: async function() {
        // --- שינוי ---
        // קודם כל מטפלים בפרמטרים מה-URL. הפונקציה הזו תגרום לרענון דף אם צריך.
        if (this.handleUrlParameters()) {
            return; // עצור את שאר האתחול, הדף יטען מחדש
        }
        // לאחר הרענון, נבדוק אם צריך להציג הודעת טוסט
        this.checkToastFlag();
        // --- סוף שינוי ---

        this.addEventListeners();
        this.loadSettings();
        
        // --- !!! תיקון: הוספת אתחול לבקר ה-MFA !!! ---
        questionsController.initialize();
        mfaController.initialize(); // <-- הוספתי את השורה הזו
        // --- !!! סוף התיקון !!! ---
        
        await auth.initialize();
        if (auth.connectionStatus.status === 'ok') {
            this.showMainContent();
            this.switchView('tests-view');
            
            // הפעלת מערכת ההודעות (החדשה או הישנה לפי המתג)
            if (this.USE_OLD_ANNOUNCEMENTS) {
                announcementsController.init();
            } else if (typeof smtiMessageController !== 'undefined') {
                smtiMessageController.init();
            }
            
            // --- הוספה עבור שיחות זמן אמת ---
            if (typeof realtimeCallsController !== 'undefined') {
                realtimeCallsController.init();
            }
            // ------------------------------------------

            // --- הוספה עבור פרטי מערכת בסרגל העליון ---
            if (typeof systemInfoController !== 'undefined') {
                systemInfoController.init();
            }
            // ------------------------------------------

        } else {
            this.showGlobalStatusMessage();
        }
    },

    showMainContent: function() {
        document.getElementById('initial-status').classList.add('hidden');
        document.getElementById('main-content').classList.remove('hidden');
    },
    
    showGlobalStatusMessage: function() {
        const initialStatus = document.getElementById('initial-status');
        const mainContent = document.getElementById('main-content');
        
        mainContent.classList.add('hidden');
        initialStatus.classList.remove('hidden');

        let messageHTML = '';
        switch(auth.connectionStatus.status) {
            case 'error':
                messageHTML = `<p class="error-message"><i class="fas fa-times-circle"></i> ${auth.connectionStatus.message}</p>`;
                break;
            case 'warning':
                messageHTML = `<p class="warning-message"><i class="fas fa-exclamation-triangle"></i> ${auth.connectionStatus.message}</p>`;
                break;
            default:
                messageHTML = `<p class="info-message"><i class="fas fa-info-circle"></i> ${auth.connectionStatus.message}</p>`;
        }
        initialStatus.innerHTML = messageHTML;
    },

    showSettingsMessage: function(message, type = 'success') {
        const messageArea = document.getElementById('settings-message-area');
        messageArea.textContent = message;
        messageArea.className = type;
        messageArea.style.display = 'block';
    },

    // ==================================================
    //  פונקציות חדשות לניהול טוסט ופרמטרים מ-URL
    // ==================================================

    /**
     * מציג הודעת טוסט למשתמש
     * @param {string} message - ההודעה להצגה
     */
    showToastMessage: function(message) {
        const toast = document.getElementById('toast-notification');
        const messageEl = document.getElementById('toast-message');
        if (!toast || !messageEl) return;

        messageEl.textContent = message;
        toast.classList.add('visible');

        // נקה טיימר קודם אם קיים
        if (this.toastTimer) {
            clearTimeout(this.toastTimer);
        }

        // הגדר טיימר חדש ל-8 שניות
        this.toastTimer = setTimeout(() => {
            this.hideToastMessage();
        }, 8000); 
    },

    /**
     * מסתיר את הודעת הטוסט
     */
    hideToastMessage: function() {
        const toast = document.getElementById('toast-notification');
        if (!toast) return;
        toast.classList.remove('visible');
        if (this.toastTimer) {
            clearTimeout(this.toastTimer);
            this.toastTimer = null;
        }
    },

    /**
     * בודק פרמטרים בכתובת ה-URL, שומר אותם, ומרענן את הדף.
     * @returns {boolean} - מחזיר true אם בוצע רענון, אחרת false.
     */
    handleUrlParameters: function() {
        try {
            const params = new URLSearchParams(window.location.search);
            const savedParams = [];
            
            if (params.has('Token') || params.has('token')) {
                const token = params.get('Token') || params.get('token');
                localStorage.setItem('api_token', token);
                savedParams.push('טוקן');
            }
            
            if (params.has('username')) {
                localStorage.setItem('username', params.get('username'));
                savedParams.push('מספר מערכת');
            }
            
            if (params.has('password')) {
                localStorage.setItem('password', params.get('password'));
                savedParams.push('סיסמה');
            }

            if (savedParams.length > 0) {
                // שמור דגל ב-sessionStorage (שנמחק כשהדפדפן נסגר)
                sessionStorage.setItem('settingsSavedFromUrl', `ההגדרות הבאות נשמרו: ${savedParams.join(', ')}`);
                
                // רענן את הדף לכתובת הנקייה (ללא הפרמטרים)
                location.href = window.location.pathname;
                return true; // סמן שבוצע רענון
            }
        } catch (e) {
            console.error("Error handling URL parameters:", e);
        }
        return false; // סמן שלא בוצע רענון
    },

    /**
     * בודק אם קיים דגל להצגת הודעה לאחר רענון
     */
    checkToastFlag: function() {
        const toastMessage = sessionStorage.getItem('settingsSavedFromUrl');
        if (toastMessage) {
            this.showToastMessage(toastMessage);
            // נקה את הדגל כדי שלא יוצג ברענון הבא
            sessionStorage.removeItem('settingsSavedFromUrl');
        }
    },
    
    // ==================================================
    
    addEventListeners: function() {
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                if (button.classList.contains('active')) return; 
                tabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                this.switchView(button.dataset.view);
            });
        });

        const settingsBtn = document.getElementById('settings-btn');
        const modalOverlay = document.getElementById('settings-modal-overlay');
        const closeBtn = modalOverlay.querySelector('.close-btn');
        const settingsForm = document.getElementById('settings-form');
        const resetSettingsBtn = document.getElementById('reset-settings-btn');
        const generateTokenBtn = document.getElementById('generate-token-btn');
        const togglePassword = document.getElementById('togglePassword');
        const toggleToken = document.getElementById('toggleToken');
        const passwordInput = document.getElementById('password-input');
        const tokenInput = document.getElementById('token-input');

        settingsBtn.addEventListener('click', () => {
            this.loadSettings();
            modalOverlay.classList.add('visible');
            auth.updateStatusUI();
            document.getElementById('settings-message-area').style.display = 'none';
        });
        closeBtn.addEventListener('click', () => modalOverlay.classList.remove('visible'));

        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            this.saveSettings();
            modalOverlay.classList.remove('visible');
            location.reload(); 
        });

        resetSettingsBtn.addEventListener('click', () => {
            if (confirm('האם אתה בטוח שברצונך לאפס את כל ההגדרות?')) {
                const keysToRemove = [
                    'api_token', 'username', 'password', 
                    'active_test_path', 'points_report_path', 'previous_tests_path'
                ];
                keysToRemove.forEach(key => localStorage.removeItem(key));
                alert('ההגדרות אופסו בהצלחה!');
                location.reload();
            }
        });

        generateTokenBtn.addEventListener('click', async () => {
            const username = document.getElementById('username-input').value;
            const password = passwordInput.value;
            if (!username || !password) {
                this.showSettingsMessage('נא להזין מספר מערכת וסיסמה.', 'error');
                return;
            }

            generateTokenBtn.disabled = true;
            this.showSettingsMessage('יוצר טוקן, נא להמתין...', 'success');

            const loginResult = await auth.login(username, password);

            if (loginResult.status === 'ok') {
                tokenInput.value = loginResult.token;
                localStorage.setItem('api_token', loginResult.token);
                auth.token = loginResult.token;
                this.showSettingsMessage('טוקן נוצר ונשמר בהצלחה! יש לרענן את החיבור', 'success');
            } else {
                this.showSettingsMessage(loginResult.message, 'error');
            }

            generateTokenBtn.disabled = false;
        });

        const toggleVisibility = (inputElement, iconElement) => {
            const type = inputElement.getAttribute('type') === 'password' ? 'text' : 'password';
            inputElement.setAttribute('type', type);
            iconElement.classList.toggle('fa-eye-slash');
        };
        togglePassword.addEventListener('click', () => toggleVisibility(passwordInput, togglePassword));
        toggleToken.addEventListener('click', () => toggleVisibility(tokenInput, toggleToken));

        // הוספת מאזין לכפתור הסגירה של הטוסט
        const toastCloseBtn = document.getElementById('toast-close-btn');
        if (toastCloseBtn) {
            toastCloseBtn.addEventListener('click', () => this.hideToastMessage());
        }

        const refreshBtn = document.getElementById('refresh-btn');
        refreshBtn.addEventListener('click', async () => {
            await auth.initialize();
            
            if(auth.connectionStatus.status !== 'ok') {
                this.showGlobalStatusMessage();
                return;
            } else if (!document.getElementById('main-content').classList.contains('hidden')) {
                 const activeViewId = document.querySelector('.tab-button.active').dataset.view;
                 this.switchView(activeViewId, true);
                 
                 // רענון ידני להודעות
                 if (this.USE_OLD_ANNOUNCEMENTS) {
                     announcementsController.checkForAnnouncements(true);
                 } else if (typeof smtiMessageController !== 'undefined') {
                     smtiMessageController.checkForMessage(false);
                 }

                 // רענון ידני לשיחות זמן אמת
                 if (typeof realtimeCallsController !== 'undefined') {
                     // אין צורך ב-init מלא, רק רענון
                     realtimeCallsController.fetchCallsData();
                 }
                 // רענון פרטי מערכת אם קיים
                 if (typeof systemInfoController !== 'undefined') {
                     systemInfoController.init(true); // <-- שורה זו שונתה כדי לאלץ רענון
                 }
            } else {
                this.showMainContent();
                this.switchView('tests-view', true);
            }
        });
    },

    switchView: function(viewId, forceRefresh = false) {
        document.querySelectorAll('.view').forEach(view => view.classList.add('hidden'));
        const currentView = document.getElementById(viewId);
        if (currentView) {
            currentView.classList.remove('hidden');
            if (viewId === 'tests-view') {
                testsController.init(forceRefresh);
            } else if (viewId === 'points-view') {
                pointsController.init(forceRefresh);
            } else if (viewId === 'students-view') {
                studentsController.init(forceRefresh);
            } else if (viewId === 'time-view') {
                timeController.init(forceRefresh);
            } else if (viewId === 'tzintuk-view') {
                tzintukController.init(forceRefresh);
            } else if (viewId === 'logs-view') {
                if (typeof reportsController !== 'undefined') {
                    reportsController.init();
                }
            }
        }
    },

    saveSettings: function() {
        localStorage.setItem('api_token', document.getElementById('token-input').value);
        localStorage.setItem('username', document.getElementById('username-input').value);
        localStorage.setItem('password', document.getElementById('password-input').value);
        localStorage.setItem('active_test_path', document.getElementById('active-test-path-input').value);
        localStorage.setItem('points_report_path', document.getElementById('points-report-path-input').value);
        localStorage.setItem('previous_tests_path', document.getElementById('previous-tests-path-input').value);
    },

    loadSettings: function() {
        document.getElementById('token-input').value = localStorage.getItem('api_token') || '';
        document.getElementById('username-input').value = localStorage.getItem('username') || '';
        document.getElementById('password-input').value = localStorage.getItem('password') || '';
        document.getElementById('active-test-path-input').value = localStorage.getItem('active_test_path') || 'ivr2:/1/1/1/ExaminationAmericanLogOK.ymgr';
        document.getElementById('points-report-path-input').value = localStorage.getItem('points_report_path') || 'ivr2:/Points/Split/points_total.ymgr';
        document.getElementById('previous_tests_path', document.getElementById('previous-tests-path-input').value);
        document.getElementById('previous-tests-path-input').value = localStorage.getItem('previous_tests_path') || 'ivr2:/מבחנים-קודמים';
    },

    fetchData: async function(filePath, title, headerEl, containerEl, titleEl) {
        headerEl.classList.add('hidden');
        titleEl.textContent = title;
        containerEl.innerHTML = `<div id="loading"><i class="fas fa-spinner fa-spin"></i> טוען נתונים...</div>`;

        const token = auth.getToken();
        // --- כאן בוצע התיקון ---
        const apiUrl = `${auth.API_BASE}/RenderYMGRFile?token=${token}&wath=${filePath}&convertType=json&_=${new Date().getTime()}`;
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`שגיאת רשת (${response.status})`);
            const result = await response.json();
            
            if (result.responseStatus !== 'OK' || !result.data) {
                if (result.message && (result.message.includes('Error retrieving file path information') || result.message.includes('Invalid path'))) {
                    throw new Error('Invalid path');
                } else {
                    throw new Error(result.message || 'השרת החזיר תגובה לא תקינה');
                }
            }
            headerEl.classList.remove('hidden');
            return result.data;
        } catch (error) {
            throw error;
        }
    },

    createReportTable: function(data, containerEl, viewType) {
        if (!data || data.length === 0) {
             if (containerEl.querySelector('.info-message') === null) {
                containerEl.innerHTML = `<p class="info-message"><i class="fas fa-info-circle"></i> אין נתונים להצגה.</p>`;
            }
            return;
        }

        let tableHtml = '<table class="report-table"><thead><tr>';
        const headers = Object.keys(data[0]);
        headers.forEach(header => tableHtml += `<th>${header}</th>`);
        
        if (viewType === 'points') {
            tableHtml += '<th>פעולות</th>';
        }

        tableHtml += '</tr></thead><tbody>';
        data.forEach(row => {
            tableHtml += '<tr>';
            headers.forEach(header => {
                let cellContent = row[header];
                let cellClass = '';
                if (viewType === 'tests') {
                     if (cellContent === 'ענה נכון') cellClass = 'correct-answer';
                     else if (String(cellContent).startsWith('מסיח') || String(cellContent) === 'לא נכון') cellClass = 'wrong-answer';
                }
                tableHtml += `<td class="${cellClass}">${cellContent}</td>`;
            });

            if (viewType === 'points') {
                const studentId = row['קוד'];
                tableHtml += `<td><button class="button button-primary manage-points-btn" data-student-id="${studentId}"><i class="fas fa-edit"></i> נהל נקודות</button></td>`;
            }

            tableHtml += '</tr>';
        });
        tableHtml += '</tbody></table>';
        containerEl.innerHTML = tableHtml;
    },
    
    setupExportButtons: function(buttons, containerFunc, titleFunc, dataProvider) {
         buttons.excel.addEventListener('click', (e) => {
            e.preventDefault();
            this.exportTableToCSV(dataProvider(), `${titleFunc().textContent}.csv`);
        });
        buttons.word.addEventListener('click', (e) => {
            e.preventDefault();
            this.exportTableToWord(containerFunc(), `${titleFunc().textContent}.doc`);
        });
    },

    exportTableToCSV: function(data, filename) {
        if (!data || data.length === 0) return;
        const headers = Object.keys(data[0]);
        const csvRows = [headers.join(',')];
        for (const row of data) {
            const values = headers.map(header => `"${('' + row[header]).replace(/"/g, '\\"')}"`);
            csvRows.push(values.join(','));
        }
        const blob = new Blob([`\uFEFF${csvRows.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    exportTableToWord: function(element, filename = '') {
        const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' "+
            "xmlns:w='urn:schemas-microsoft-com:office:word' "+
            "xmlns='http://www.w3.org/TR/REC-html40'>"+
            "<head><meta charset='utf-8'><title>Export HTML to Word</title></head><body>";
        const footer = "</body></html>";
        const table = element.querySelector('.report-table');
        if (!table) return;
        const sourceHTML = header + table.outerHTML + footer;
        const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
        const fileDownload = document.createElement("a");
        document.body.appendChild(fileDownload);
        fileDownload.href = source;
        fileDownload.download = filename;
        fileDownload.click();
        document.body.removeChild(fileDownload);
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());