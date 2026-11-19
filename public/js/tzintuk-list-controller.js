// ======================================================
//  tzintuk-list-controller.js - (גרסה מתוקנת)
//  מודאל מוזרק, פוקוס אוטומטי ושימוש ב-alert
// ======================================================

const tzintukListController = {
    container: null,
    isInitialized: false,
    TZINTUKIM_LIST_ID: '2', // ניתן לשינוי
    runTzintukModal: null, // יחזיק את אלמנט המודאל

    init: function(container) {
        this.container = container;
        // טען רק אם זו הפעם הראשונה
        if (!this.isInitialized || this.container.innerHTML.trim() === '') {
            this.isInitialized = true;
            this.injectRunModalHtml(); // הזרק את ה-HTML של המודאל פעם אחת
            this.loadListView();
        }
    },

    // --- הוספה: פונקציה להזרקת המודאל ---
    injectRunModalHtml: function() {
        // הזרק רק אם המודאל עדיין לא קיים בדף
        if (document.getElementById('tzintuk-run-modal-overlay')) return;

        // שימוש במבנה הסטנדרטי של הפרויקט (modal-container, form-group וכו')
        const modalHtml = `
            <div id="tzintuk-run-modal-overlay" class="tasks-modal-overlay-class">
                <div class="modal-container" style="max-width: 450px;">
                    <div class="modal-header">
                        <h2><i class="fas fa-play-circle"></i> הפעלת צינתוק</h2>
                        <span class="close-btn" title="סגירה">&times;</span>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="modal-list-id">מזהה רשימת צינתוקים:</label>
                            <input type="text" id="modal-list-id" class="form-control">
                        </div>
                        
                        <div class="form-group">
                            <label for="modal-timeout">זמן צלצול (1-16 שניות):</label>
                            <input type="number" id="modal-timeout" class="form-control" value="16" min="1" max="16">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button id="modal-cancel-run" class="button button-archive">ביטול</button>
                        <button id="modal-confirm-run" class="button button-success">אשר והפעל כעת</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // שמירת רכיבים ומאזינים
        this.runTzintukModal = document.getElementById('tzintuk-run-modal-overlay');
        this.runTzintukModal.querySelector('.close-btn').addEventListener('click', () => this.hideRunTzintukModal());
        this.runTzintukModal.querySelector('#modal-cancel-run').addEventListener('click', () => this.hideRunTzintukModal());
        
        // מאזין לכפתור האישור
        this.runTzintukModal.querySelector('#modal-confirm-run').addEventListener('click', () => {
            const listId = this.runTzintukModal.querySelector('#modal-list-id').value;
            const timeout = this.runTzintukModal.querySelector('#modal-timeout').value;
            
            if (!listId || !timeout) {
                alert('חובה למלא מזהה רשימה וזמן צלצול.');
                return;
            }
            if (timeout < 1 || timeout > 16) {
                alert('זמן הצלצול חייב להיות בין 1 ל-16 שניות.');
                return;
            }
            this.executeRunTzintuk(listId, timeout);
        });
    },

    // --- הוספה: פונקציה להסתרת המודאל ---
    hideRunTzintukModal: function() {
        if (this.runTzintukModal) {
            this.runTzintukModal.classList.remove('visible');
        }
    },


    loadListView: function() {
        // --- שינוי: עיצוב מחדש של כפתור ההפעלה ---
        this.container.innerHTML = `
            <div class="view-actions">
                <div id="tzintuk-summary" class="students-summary-text">טוען נתונים...</div>
                <button id="manual-run-tzintuk-btn" class="button">
                    <i class="fas fa-play-circle"></i> הפעלת צינתוק
                </button>
            </div>
            <div class="tzintuk-list-container">
                <div class="tzintuk-section" id="subscribers-section">
                    <h3><i class="fas fa-users"></i> רשימת מספרים</h3>
                    <div id="subscribers-container"><div id="loading"><i class="fas fa-spinner fa-spin"></i> טוען רשימה...</div></div>
                </div>
                <div class="tzintuk-section" id="log-section">
                    <h3><i class="fas fa-history"></i> יומן פעולות</h3>
                    <div id="log-container"><div id="loading"><i class="fas fa-spinner fa-spin"></i> טוען יומן...</div></div>
                </div>
            </div>`;
        
        // --- שינוי: מאזין לכפתור החדש ---
        this.container.querySelector('#manual-run-tzintuk-btn').addEventListener('click', () => this.showRunTzintukModal());
        
        this.fetchListData();
    },

    fetchListData: async function() {
        try {
            const summaryEl = this.container.querySelector('#tzintuk-summary');
            if (summaryEl && !summaryEl.innerHTML.includes('סה"כ ברשימה')) {
                summaryEl.innerHTML = 'טוען נתונים...';
            }

            const listResult = await tzintukController.apiCall('TzintukimListManagement', { action: 'getlistEnteres', TzintukimList: this.TZINTUKIM_LIST_ID });
            const logResult = await tzintukController.apiCall('TzintukimListManagement', { action: 'getLogList', TzintukimList: this.TZINTUKIM_LIST_ID });

            this.renderSummary(listResult);
            this.renderSubscribers(listResult.enteres || []);
            this.renderLog(logResult.events || []);
        } catch (error) {
            this.container.innerHTML = `<p class="error-message"><i class="fas fa-exclamation-triangle"></i> ${error.message}</p>`;
        }
    },

    renderSummary: function(data) {
        const summaryEl = this.container.querySelector('#tzintuk-summary');
        if (summaryEl) {
            summaryEl.innerHTML = `
                סה"כ ברשימה: <strong>${data.countSubscribers || 0}</strong> |
                פעילים: <strong style="color: var(--color-success);">${data.countsActive || 0}</strong> |
                חסומים: <strong style="color: var(--color-danger);">${data.countsBlocked || 0}</strong>
            `;
        }
    },

    renderSubscribers: function(subscribers) {
        const container = this.container.querySelector('#subscribers-container');
        if (!subscribers || subscribers.length === 0) {
            container.innerHTML = `<p class="info-message">אין מספרים ברשימה.</p>`;
            return;
        }

        let tableHtml = '<table class="report-table"><thead><tr><th>מספר טלפון</th><th>שם</th><th>סטטוס</th></tr></thead><tbody>';
        subscribers.forEach(sub => {
            const statusText = sub.active ? 'פעיל' : 'חסום';
            const statusClass = sub.active ? 'correct-answer' : 'wrong-answer';
            tableHtml += `
                <tr>
                    <td>${sub.phone}</td>
                    <td>${sub.name || ''}</td>
                    <td class="${statusClass}">${statusText}</td>
                </tr>
            `;
        });
        tableHtml += '</tbody></table>';
        container.innerHTML = tableHtml;
    },

    renderLog: function(events) {
        const container = this.container.querySelector('#log-container');
        if (!events || events.length === 0) {
            container.innerHTML = `<p class="info-message">אין אירועים ביומן.</p>`;
            return;
        }

        const getLogTypeInfo = (type) => {
            const types = {
                'AddToListTzintuk': { text: 'הוספה לרשימה', class: 'log-type-add' },
                'RunTzintuk': { text: 'הפעלת צינתוק', class: 'log-type-run' },
                'RemovingToListTzintuk': { text: 'הסרה מהרשימה', class: 'log-type-remove' },
                'AdminRemovingToListTzintuk': { text: 'הסרת מנהל', class: 'log-type-remove' },
                'ResetToListTzintuk': { text: 'איפוס רשימה', class: 'log-type-other' }
            };
            return types[type] || { text: type, class: 'log-type-other' };
        };
        
        const reversedEvents = events.slice().reverse();

        let tableHtml = '<table class="report-table"><thead><tr><th>תאריך</th><th>שעה</th><th>סוג פעולה</th><th>טלפון</th></tr></thead><tbody>';
        reversedEvents.forEach(event => {
            const typeInfo = getLogTypeInfo(event.TypeOperation);
            tableHtml += `
                <tr>
                    <td style="direction: ltr; text-align: right;">${event.Date}</td>
                    <td>${event.Time}</td>
                    <td class="log-type ${typeInfo.class}">${typeInfo.text}</td>
                    <td>${event.PhoneAction || event.Phone}</td>
                </tr>
            `;
        });
        tableHtml += '</tbody></table>';
        container.innerHTML = tableHtml;
    },

    // ======================================================
    //  פונקציות להפעלת צינתוק
    // ======================================================

    /**
     * --- שינוי: הפונקציה רק מציגה את המודאל ונותנת פוקוס ---
     */
    showRunTzintukModal: function() {
        if (!this.runTzintukModal) {
            console.error('Run Tzintuk Modal not initialized!');
            return;
        }
        
        // איפוס ערכי ברירת מחדל
        this.runTzintukModal.querySelector('#modal-list-id').value = this.TZINTUKIM_LIST_ID;
        this.runTzintukModal.querySelector('#modal-timeout').value = "16";
        
        // הצג את המודאל
        this.runTzintukModal.classList.add('visible');
        
        // --- הוספה: פוקוס אוטומטי על כפתור האישור ---
        setTimeout(() => {
            this.runTzintukModal.querySelector('#modal-confirm-run').focus();
        }, 100); // השהייה קטנה כדי לוודא שהמודאל גלוי
    },

    /**
     * מבצע את קריאת ה-API להפעלת הצינתוק ומציג התראה
     */
    executeRunTzintuk: async function(listId, timeout) {
        // --- שינוי: תופס את הכפתור החדש ---
        const runBtn = this.container.querySelector('#manual-run-tzintuk-btn');
        const originalBtnHtml = runBtn.innerHTML;
        
        // --- הוספה: סגירת המודאל מיד ---
        this.hideRunTzintukModal();
        
        try {
            const payload = {
                TzintukTimeOut: timeout,
                phones: `tzl:${listId}`
            };

            runBtn.disabled = true;
            runBtn.innerHTML = 'מפעיל... <i class="fas fa-spinner fa-spin"></i>';

            const result = await tzintukController.apiCall('RunTzintuk', payload);

            if (result.responseStatus === 'OK') {
                // --- שימוש ב-ALERT כפי שביקשת ---
                alert(`הצינתוק הופעל בהצלחה!
סטטוס: ${result.responseStatus}
מזהה קמפיין: ${result.campaignId}
סה"כ שיחות: ${result.callsCount}
עלות: ${result.biling}`);
                
                this.fetchListData(); 
            } else {
                throw new Error(result.message || JSON.stringify(result.errors) || 'שגיאה לא ידועה מהשרת');
            }
        } catch (error) {
            // --- שימוש ב-ALERT כפי שביקשת ---
            alert(`שגיאה בהפעלת הצינתוק: ${error.message}`);
        } finally {
            runBtn.disabled = false;
            runBtn.innerHTML = originalBtnHtml;
        }
    }
};