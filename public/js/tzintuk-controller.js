// ======================================================
//  tzintuk-controller.js - (גרסה 4 - בקר ראשי)
//  מנהל רק את המעבר בין הלשוניות וטוען את הבקרים
// ======================================================

const tzintukController = {
    view: document.getElementById('tzintuk-view'),
    initialized: false,

    init: function(forceRefresh = false) {
        if (!this.initialized || forceRefresh) {
            this.initialized = true;
            this.renderLayout();
            this.addEventListeners();
            this.switchTab('tasks'); // פתח את תצוגת המשימות כברירת מחדל
        }
    },

    renderLayout: function() {
        this.view.innerHTML = `
            <div class="tzintuk-view-container">
                <nav class="tzintuk-nav">
                    <button class="tzintuk-nav-button" data-tab="tasks">ניהול משימות</button>
                    <button class="tzintuk-nav-button" data-tab="list">ניהול רשימת צינתוקים</button>
                </nav>

                <div id="tzintuk-tasks-content" class="tzintuk-tab-content">
                    </div>

                <div id="tzintuk-list-content" class="tzintuk-tab-content">
                    </div>
            </div>
        `;
    },

    addEventListeners: function() {
        this.view.querySelectorAll('.tzintuk-nav-button').forEach(button => {
            button.addEventListener('click', () => this.switchTab(button.dataset.tab));
        });
    },

    switchTab: function(tabId) {
        // עדכון כפתורים
        this.view.querySelectorAll('.tzintuk-nav-button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });
        // עדכון תצוגה
        this.view.querySelectorAll('.tzintuk-tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `tzintuk-${tabId}-content`);
        });

        // טען את התוכן המתאים
        const contentArea = document.getElementById(`tzintuk-${tabId}-content`);
        
        if (tabId === 'tasks') {
            // טעינת בקר המשימות החדש
            if (typeof tzintukTasksController !== 'undefined') {
                tzintukTasksController.init(contentArea);
            } else {
                contentArea.innerHTML = '<p class="error-message">שגיאה: הקובץ tzintuk-tasks-controller.js לא נטען.</p>';
            }
        } else if (tabId === 'list') {
            // טעינת בקר הרשימה (הלוגיקה הישנה)
             if (typeof tzintukListController !== 'undefined') {
                tzintukListController.init(contentArea);
            } else {
                contentArea.innerHTML = '<p class="error-message">שגיאה: הקובץ tzintuk-list-controller.js לא נטען.</p>';
            }
        }
    },

    // פונקציית עזר כללית לקריאות API
    // הבקרים הפנימיים ישתמשו בפונקציה זו
    apiCall: async function(endpoint, params = {}, method = 'GET') {
        const token = auth.getToken();
        if (!token) throw new Error("לא נמצא טוקן.");
        
        params.token = token;
        const queryString = new URLSearchParams(params).toString();
        const apiUrl = `${auth.API_BASE}/${endpoint}?${queryString}`;
        
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`שגיאת רשת (${response.status})`);
        
        const result = await response.json();
        if (result.responseStatus !== 'OK') {
            // תרגום שגיאה נפוצה
            if (result.message && result.message.includes('TaskId Not found')) {
                throw new Error('משימה לא נמצאה (ייתכן שנמחקה).');
            }
            throw new Error(result.message || 'השרת החזיר שגיאה');
        }
        return result;
    }
};