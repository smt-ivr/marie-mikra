// ========================================================
//  migration.js - מנוע שדרוג הגדרות מגרסה ישנה (V1 -> V2)
// ========================================================

const migrationController = {
    // דגל ייחודי וקבוע שאינו נמחק באיפוס הגדרות
    MIGRATION_FLAG: 'migration_v2_permanent_complete',
    
    // מיפוי בין מפתחות ההגדרות בגרסה הישנה והחדשה
    KEY_MAP: {
        'ymgrViewer_systemNumber': 'username',
        'ymgrViewer_password': 'password',
        'ymgrViewer_ymgrPath': 'active_test_path',
        'ymgrViewer_pointsPath': 'points_report_path',
        'ymgrViewer_browsePath': 'previous_tests_path'
    },

    // מיפוי שמות תצוגה להגדרות
    DISPLAY_NAMES: {
        'username': 'מספר מערכת',
        'password': 'סיסמה',
        'active_test_path': 'נתיב מבחן פעיל',
        'points_report_path': 'נתיב דוח נקודות',
        'previous_tests_path': 'נתיב דפדוף מבחנים'
    },

    // פונקציית אתחול ראשית
    init: function() {
        // אם השדרוג כבר בוצע, הפסק את הריצה
        if (localStorage.getItem(this.MIGRATION_FLAG) === 'true') {
            return;
        }

        // קרא את ההגדרות הישנות מהאחסון המקומי
        const oldSettings = this.getOldSettings();

        // אם לא נמצאו הגדרות ישנות, סמן שהשדרוג הושלם וסיים
        if (Object.keys(oldSettings).length === 0) {
            localStorage.setItem(this.MIGRATION_FLAG, 'true');
            return;
        }

        // אם נמצאו הגדרות, הצג את חלון השדרוג
        this.showMigrationModal(oldSettings);
    },

    // קריאת ההגדרות הישנות
    getOldSettings: function() {
        const settings = {};
        for (const oldKey in this.KEY_MAP) {
            const oldValue = localStorage.getItem(oldKey);
            // הוסף לרשימה רק אם הערך קיים והמפתח החדש עדיין לא קיים
            if (oldValue && !localStorage.getItem(this.KEY_MAP[oldKey])) {
                settings[this.KEY_MAP[oldKey]] = oldValue;
            }
        }
        return settings;
    },

    // הצגת החלון המודאלי
    showMigrationModal: function(settings) {
        // יצירת רשימת ההגדרות להצגה
        let settingsListHtml = '<ul>';
        for (const newKey in settings) {
            const displayName = this.DISPLAY_NAMES[newKey] || newKey;
            const displayValue = newKey === 'password' ? '********' : settings[newKey];
            settingsListHtml += `<li><strong>${displayName}:</strong> <span>${displayValue}</span></li>`;
        }
        settingsListHtml += '</ul>';

        // יצירת האלמנטים של המודאל
        const modalHtml = `
            <div id="migration-modal-overlay">
                <div class="migration-modal-container">
                    <div class="migration-modal-header">
                        <h2>ברוכים הבאים לגרסה החדשה!</h2>
                    </div>
                    <div class="migration-modal-body">
                        <p>זיהינו הגדרות מהגרסה הקודמת של "מארי מקרא".</p>
                        <p>האם ברצונך לייבא אותן באופן אוטומטי?</p>
                        <div class="settings-preview">${settingsListHtml}</div>
                    </div>
                    <div class="migration-modal-footer">
                        <button id="confirm-migration-btn" class="button button-success">
                            <i class="fas fa-check"></i> כן, אשר וייבא
                        </button>
                    </div>
                </div>
            </div>`;
        
        // הוספת העיצוב וה-HTML לדף
        this.injectCss();
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // הוספת מאזין אירוע לכפתור האישור
        document.getElementById('confirm-migration-btn').addEventListener('click', () => {
            this.performMigration(settings);
        });
    },

    // ביצוע השדרוג בפועל
    performMigration: function(settings) {
        for (const newKey in settings) {
            localStorage.setItem(newKey, settings[newKey]);
        }
        
        // סמן שהשדרוג בוצע
        localStorage.setItem(this.MIGRATION_FLAG, 'true');
        
        // הסתר את המודאל ורענן את הדף
        document.getElementById('migration-modal-overlay').remove();
        location.reload();
    },

    // הזרקת CSS עבור המודאל
    injectCss: function() {
        const css = `
            #migration-modal-overlay {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background-color: rgba(0,0,0,0.6); z-index: 9999;
                display: flex; justify-content: center; align-items: center;
                font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            }
            .migration-modal-container {
                background-color: #fff; border-radius: 8px; width: 90%; max-width: 500px;
                box-shadow: 0 5px 20px rgba(0,0,0,0.25); text-align: center;
            }
            .migration-modal-header { padding: 20px; border-bottom: 1px solid #eee; }
            .migration-modal-header h2 { margin: 0; font-size: 1.5rem; color: #333; }
            .migration-modal-body { padding: 25px; line-height: 1.6; }
            .migration-modal-body p { margin: 0 0 15px; font-size: 1.1rem; }
            .settings-preview { text-align: right; border: 1px solid #ddd; border-radius: 5px; padding: 15px; background-color: #f9f9f9; }
            .settings-preview ul { list-style: none; padding: 0; margin: 0; }
            .settings-preview li { margin-bottom: 8px; font-size: 0.95rem; }
            .settings-preview li span { direction: ltr; text-align: left; display: inline-block; }
            .migration-modal-footer { padding: 20px; background-color: #f7f7f7; border-top: 1px solid #eee; }
            #confirm-migration-btn { width: 100%; font-size: 1.1rem; padding: 12px; }
        `;
        const style = document.createElement('style');
        style.type = 'text/css';
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
    }
};

// הפעל את בקר השדרוג מיד עם טעינת הסקריפט
migrationController.init();