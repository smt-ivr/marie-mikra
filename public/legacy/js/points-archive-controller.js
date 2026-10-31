const pointsArchiveController = {
    // רכיבי ה-DOM
    viewContent: document.getElementById('points-view'), // ה-view של כל לשונית הנקודות
    basePath: 'ivr2:/Points', // נתיב השורש של דוחות הנקודות

    init: function() {
        this.showExplorer();
    },

    showExplorer: async function() {
        this.viewContent.querySelector('#report-header').classList.add('hidden');
        const reportContainer = this.viewContent.querySelector('#report-container');
        reportContainer.innerHTML = `<div id="loading"><i class="fas fa-spinner fa-spin"></i> טוען דוחות קודמים...</div>`;

        const viewActions = this.viewContent.querySelector('.view-actions');
        viewActions.innerHTML = `
            <button id="back-to-active-points-btn" class="button button-success"><i class="fas fa-home"></i> חזור לדוח הפעיל</button>
        `;
        document.getElementById('back-to-active-points-btn').addEventListener('click', () => {
            pointsController.init(true);
        });

        try {
            const data = await this.fetchDirectoryData(this.basePath);
            const filteredDirs = data.dirs.filter(dir => dir.name !== 'Split');
            this.renderContent(filteredDirs, reportContainer);
        } catch (error) {
            reportContainer.innerHTML = `<p class="error-message"><i class="fas fa-exclamation-triangle"></i> ${error.message}</p>`;
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

    renderContent: function(dirs = [], containerEl) {
        if (dirs.length === 0) {
            containerEl.innerHTML = `<p class="info-message"><i class="fas fa-info-circle"></i> לא נמצאו דוחות ניקוד בארכיון.</p>`;
            return;
        }

        let html = '<div class="browser-grid">';
        dirs.forEach(dir => {
            // *** השינוי כאן: אנו שומרים רק את הנתיב לתיקייה ***
            html += this.createItemHtml(dir.name, dir.what, 'DIR');
        });
        html += '</div>';

        containerEl.innerHTML = html;

        containerEl.querySelector('.browser-grid').addEventListener('click', (e) => {
            const target = e.target.closest('[data-path]');
            if (!target) return;

            // *** השינוי כאן: אנו מעבירים את נתיב התיקייה לפונקציה ***
            const folderPath = target.dataset.path;
            const title = `דוח נקודות: ${target.querySelector('.item-name').textContent}`;
            
            pointsController.displayArchivedReport(folderPath, title);
        });
    },

    createItemHtml: function(name, path, type) {
        const icon = 'fa-folder-open';
        return `
            <div class="browser-item" data-path="${path}" data-type="${type}">
                <i class="fas ${icon} browser-icon"></i>
                <span class="item-name">${name}</span>
            </div>
        `;
    }
};