// ======================================================
//  archive-controller.js - ניהול סייר מבחני הארכיון
// ======================================================

const archiveController = {
    // רכיבי ה-DOM
    viewContent: document.getElementById('tests-view-content'),
    previousTestsPathInput: document.getElementById('previous-tests-path-input'),
    
    // משתני מצב
    currentPath: null,
    basePath: null, // נתיב השורש של הארכיון

    // אתחול הסייר (נקרא מלחיצה על כפתור)
    init: function() {
        // קורא את הנתיב מההגדרות בכל פעם מחדש
        this.basePath = this.previousTestsPathInput.value;
        this.showExplorer(); // הצג את הסייר
    },

    // החלפת התצוגה למצב סייר
    showExplorer: function() {
        this.viewContent.innerHTML = `
            <div class="view-actions archive-actions">
                 <button id="back-to-active-btn" class="button button-success"><i class="fas fa-home"></i> חזור למבחן הפעיל</button>
                 <h2 id="archive-view-title">מבחנים קודמים</h2>
                 <div style="width: 205px;"></div> </div>
            <div id="archive-breadcrumbs"></div>
            <div id="archive-content"></div>
        `;
        this.addExplorerListeners();
        this.navigateTo(this.basePath);
    },
    
    addExplorerListeners: function() {
        document.getElementById('back-to-active-btn').addEventListener('click', () => testsController.init(true));

        this.viewContent.querySelector('#archive-content').addEventListener('click', (e) => {
            const target = e.target.closest('[data-path]');
            if (!target) return;

            const path = target.dataset.path;
            const type = target.dataset.type;

            // --- כאן נמצא השינוי המרכזי ---
            // אם המשתמש נמצא בסייר הראשי ולוחץ על תיקייה
            if (type === 'DIR' && this.currentPath.toLowerCase() === this.basePath.toLowerCase()) {
                // בנה את הנתיב המלא לקובץ הדוח ופתח אותו ישירות
                const reportPath = `${path}/ExaminationAmericanLogOK.ymgr`;
                this.viewArchivedReport(reportPath);
            } 
            // התנהגות קודמת למקרה שיש תיקיות בתוך תיקיות
            else if (type === 'DIR') {
                this.navigateTo(path);
            } 
            // פתיחת קובץ ymgr בלחיצה ישירה
            else if (type === 'YMGR') {
                this.viewArchivedReport(path);
            }
        });
    },

    navigateTo: async function(path) {
        this.currentPath = path;
        const contentEl = this.viewContent.querySelector('#archive-content');
        contentEl.innerHTML = `<div id="loading"><i class="fas fa-spinner fa-spin"></i> טוען...</div>`;
        
        this.renderBreadcrumbs(path);

        try {
            const data = await this.fetchDirectoryData(path);
            // שונה: לא נציג קבצים, רק תיקיות ברמה הראשית
            const itemsToRender = (path.toLowerCase() === this.basePath.toLowerCase()) ? data.dirs : [...data.dirs, ...data.files];
            await this.renderContent(itemsToRender);
        } catch (error) {
            contentEl.innerHTML = `<p class="error-message"><i class="fas fa-exclamation-triangle"></i> ${error.message}</p>`;
        }
    },
    
    fetchDirectoryData: async function(path) {
        const token = auth.getToken();
        if (!token) throw new Error("לא נמצא טוקן.");
        
        const apiUrl = `${auth.API_BASE}/GetIVR2Dir?token=${token}&path=${encodeURIComponent(path)}`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`שגיאת רשת (${response.status})`);
        const result = await response.json();
        if (result.responseStatus !== 'OK') throw new Error(result.message || 'שגיאה בקבלת נתונים');
        
        return result;
    },

    renderContent: async function(items = []) {
        let html = '<div class="browser-grid">';

        items.forEach(item => {
            const type = item.fileType || 'DIR'; // קבצים מגיעים עם fileType, תיקיות לא תמיד
            const name = item.name;
            const path = item.what;
            html += this.createItemHtml(name, path, type);
        });
        
        html += '</div>';

        if (items.length === 0) {
            html = `<p class="info-message"><i class="fas fa-info-circle"></i> התיקייה ריקה.</p>`;
        }
        
        this.viewContent.querySelector('#archive-content').innerHTML = html;
        
        await this.adjustItemFontSizes();
    },

    adjustItemFontSizes: async function() {
        return new Promise(resolve => {
            requestAnimationFrame(() => {
                const items = this.viewContent.querySelectorAll('.item-name');
                items.forEach(item => {
                    item.style.fontSize = ''; 
                    const initialFontSize = parseFloat(window.getComputedStyle(item).fontSize);
                    const containerWidth = item.clientWidth;
                    let scrollWidth = item.scrollWidth;

                    if (scrollWidth > containerWidth) {
                        const newSize = Math.floor(initialFontSize * (containerWidth / scrollWidth));
                        item.style.fontSize = Math.max(newSize, 9) + 'px'; 
                    }
                });
                resolve();
            });
        });
    },

    createItemHtml: function(name, path, type) {
        const icon = type === 'DIR' ? 'fa-folder' : 'fa-file-alt';
        return `
            <div class="browser-item" data-path="${path}" data-type="${type}">
                <i class="fas ${icon} browser-icon"></i>
                <span class="item-name">${name}</span>
            </div>
        `;
    },

    renderBreadcrumbs: function(fullPath) {
        const breadcrumbsEl = this.viewContent.querySelector('#archive-breadcrumbs');
        if (fullPath.toLowerCase() === this.basePath.toLowerCase()) {
            breadcrumbsEl.innerHTML = ``;
            return;
        }

        const parentPath = fullPath.substring(0, fullPath.lastIndexOf('/'));
        if (parentPath.length >= this.basePath.length) {
             breadcrumbsEl.innerHTML = `<a href="#" onclick="event.preventDefault(); archiveController.navigateTo('${parentPath}')"><i class="fas fa-arrow-left"></i> חזור</a>`;
        } else {
            breadcrumbsEl.innerHTML = '';
        }
    },
    
    viewArchivedReport: function(path) {
        // לוקח את שם התיקייה מהנתיב המלא של הקובץ
        const pathParts = path.split('/');
        const folderName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : 'דוח מארכיון';
        const reportTitleText = `מבחן: ${folderName}`;
        
        testsController.displayArchivedReport(path, reportTitleText);
    }
};