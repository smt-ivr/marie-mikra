// ======================================================
// import-questions-controller.js - ייבוא שאלות ממבחנים קודמים
// ======================================================

const importQuestionsController = {
    activeTestPath: '',
    currentExplorerPath: 'ivr2:/מבחנים-קודמים', 
    basePath: 'ivr2:/מבחנים-קודמים',
    
    // רשימת תיקיות המקור לבחירה
    sourceFolders: [
        { label: 'מבחנים קודמים (ivr2:/מבחנים-קודמים)', path: 'ivr2:/מבחנים-קודמים' },
        { label: 'מבחנים קודמים תשפ"ה (ivr2:/מבחנים-קודמים-תשפה)', path: 'ivr2:/מבחנים-קודמים-תשפה' }
    ],

    init: async function(targetPath) {
        this.activeTestPath = targetPath || 'ivr2:/1/1';
        
        this.createModal();
        
        const sourceSelect = document.getElementById('import-source-select');
        if (sourceSelect) {
            this.basePath = sourceSelect.value;
        }
        this.currentExplorerPath = this.basePath;

        const modal = document.getElementById('import-questions-modal');
        modal.style.display = 'flex';
        
        this.showLoading('בודק את תיקיית המבחן הפעיל...');

        const hasQuestions = await this.checkIfTargetHasQuestions();
        if (hasQuestions) {
            this.hideLoading();
            this.showCustomAlert(
                'לא ניתן לייבא שאלות', 
                'המבחן הפעיל כבר מכיל שאלות קיימות, יש לסגור את המבחן הפעיל לפני ביצוע ייבוא.', 
                'error',
                () => { modal.style.display = 'none'; }
            );
            return;
        }

        this.hideLoading();
        this.loadExplorer(this.currentExplorerPath);
    },

    normalizePath: function(path) {
        return (path || '').replace(/^ivr2:\/?/, 'ivr2:/').replace(/\/+$/, '');
    },

    getActualTargetFolder: function() {
        let path = this.activeTestPath;
        if (path.toLowerCase().includes('.ymgr')) {
            return path.substring(0, path.lastIndexOf('/'));
        }
        return path;
    },

    fetchDirectoryData: async function(path) {
        const token = auth.getToken();
        if (!token) throw new Error("לא נמצא טוקן התחברות.");
        
        const apiUrl = `${auth.API_BASE}/GetIVR2Dir?token=${token}&path=${encodeURIComponent(path)}`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`שגיאת תקשורת מול השרת (${response.status})`);
        const result = await response.json();
        if (result.responseStatus !== 'OK' && result.responseStatus !== 'אישור') {
            throw new Error(result.message || 'שגיאה בקבלת נתונים מהשרת');
        }
        return result;
    },

    fileActionCopy: async function(what, target) {
        const token = auth.getToken();
        if (!token) throw new Error("לא נמצא טוקן התחברות.");
        
        const apiUrl = `${auth.API_BASE}/FileAction?token=${token}&action=copy&what=${encodeURIComponent(what)}&target=${encodeURIComponent(target)}`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`שגיאת רשת בהעתקה (${response.status})`);
        const result = await response.json();
        
        const report = result.reports && result.reports[0] ? result.reports[0] : {};
        if (!(result.success && report.success) && result.message !== 'ok') {
            throw new Error(result.message || 'ההעתקה נכשלה בשרת');
        }
        return result;
    },

    // תיקון: שחרור החסימה בשלוחה ivr2:/1/1 (בהתאם לבדיקת הסטטוס וסגירת המבחן)
    unblockTest: async function() {
        const token = auth.getToken();
        if (!token) throw new Error("לא נמצא טוקן התחברות.");
        
        const blockPath = 'ivr2:/1/1';
        const apiUrl = `${auth.API_BASE}/UpdateExtension?token=${token}&path=${encodeURIComponent(blockPath)}&enter_foldar_end_time=no`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`שגיאת רשת בשחרור המבחן (${response.status})`);
        const result = await response.json();
        
        if (result.responseStatus !== 'OK' && result.responseStatus !== 'אישור') {
            throw new Error(result.message || 'שגיאה בשחרור המבחן בשרת');
        }
        return result;
    },

    checkIfTargetHasQuestions: async function() {
        try {
            const folderPath = this.getActualTargetFolder();
            const dirContent = await this.fetchDirectoryData(folderPath);
            const questionDirs = (dirContent.dirs || []).filter(dir => {
                return /^\d{3}$/.test(dir.name) && dir.name !== '000';
            });
            return questionDirs.length > 0;
        } catch (e) {
            console.error('Error checking target directory:', e);
            return false;
        }
    },

    createModal: function() {
        if (document.getElementById('import-questions-modal')) return;

        const optionsHtml = this.sourceFolders.map(folder => 
            `<option value="${folder.path}">${folder.label}</option>`
        ).join('');

        const modalHTML = `
            <div id="import-questions-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5); z-index: 9999; justify-content: center; align-items: center; direction: rtl;">
                <div class="modal-container" style="background: white; padding: 0; border-radius: 8px; max-width: 600px; width: 90%; height: 80vh; max-height: 700px; display: flex; flex-direction: column; box-shadow: 0 4px 15px rgba(0,0,0,0.15); overflow: hidden; position: relative;">
                    
                    <div class="modal-header" style="padding: 15px 20px; background-color: #f8f9fa; border-bottom: 1px solid #dee2e6; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; font-size: 1.25rem; color: #333;"><i class="fas fa-file-import" style="color: #6f42c1; margin-left: 8px;"></i> ייבוא שאלות ממבחן קודם</h3>
                        <span id="close-import-modal" style="cursor: pointer; font-size: 1.5rem; color: #6c757d; line-height: 1;">&times;</span>
                    </div>

                    <div style="padding: 10px 20px; background-color: #f1f3f5; border-bottom: 1px solid #dee2e6; display: flex; align-items: center; gap: 10px;">
                        <label for="import-source-select" style="font-weight: 600; font-size: 0.9em; color: #333; white-space: nowrap;"><i class="fas fa-folder-open" style="color: #6f42c1;"></i> מקור ייבוא:</label>
                        <select id="import-source-select" style="flex-grow: 1; padding: 6px 10px; border: 1px solid #ced4da; border-radius: 4px; font-size: 0.9em; font-family: inherit; background-color: #fff; cursor: pointer;">
                            ${optionsHtml}
                        </select>
                    </div>
                    
                    <div style="padding: 10px 20px; background-color: #e9ecef; border-bottom: 1px solid #dee2e6; display: flex; align-items: center; gap: 15px;">
                        <button id="import-nav-up" class="button button-browse" style="padding: 4px 12px; font-size: 0.9em; min-height: unset; margin: 0;"><i class="fas fa-level-up-alt"></i> תיקייה למעלה</button>
                        <span id="import-current-path" style="font-size: 0.85em; color: #495057; direction: ltr; flex-grow: 1; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></span>
                    </div>

                    <div id="import-explorer-list" class="modal-body" style="flex-grow: 1; padding: 0; overflow-y: auto; background-color: #fff;">
                    </div>

                    <div id="import-loading-overlay" style="display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(255,255,255,0.95); z-index: 10; flex-direction: column; justify-content: center; align-items: center;">
                        <i id="import-loading-icon" class="fas fa-spinner fa-spin fa-3x" style="color: #6f42c1; margin-bottom: 15px;"></i>
                        <h3 id="import-loading-text" style="color: #333; margin: 0; font-weight: 600;">טוען...</h3>
                    </div>

                    <div id="import-custom-alert" style="display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); z-index: 20; justify-content: center; align-items: center;">
                        <div style="background: white; border-radius: 8px; width: 85%; max-width: 400px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); overflow: hidden;">
                            <div id="import-alert-header" style="padding: 15px 20px; color: white; font-weight: bold; font-size: 1.1rem; display: flex; align-items: center; gap: 10px;">כותרת</div>
                            <div id="import-alert-body" style="padding: 20px; line-height: 1.5; color: #333; font-size: 0.95rem;">תוכן ההודעה</div>
                            <div style="padding: 15px 20px; background-color: #f8f9fa; border-top: 1px solid #dee2e6; display: flex; justify-content: flex-end; gap: 10px;">
                                <button id="import-alert-btn-cancel" class="button button-danger" style="margin: 0; display: none;">ביטול</button>
                                <button id="import-alert-btn-ok" class="button button-success" style="margin: 0;">אישור</button>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        document.getElementById('close-import-modal').addEventListener('click', () => {
            document.getElementById('import-questions-modal').style.display = 'none';
        });

        document.getElementById('import-source-select').addEventListener('change', (e) => {
            this.basePath = e.target.value;
            this.currentExplorerPath = this.basePath;
            this.loadExplorer(this.basePath);
        });

        document.getElementById('import-nav-up').addEventListener('click', () => {
            if (this.normalizePath(this.currentExplorerPath) === this.normalizePath(this.basePath)) return; 
            const parts = this.currentExplorerPath.split('/');
            if (parts.length > 1) {
                parts.pop();
                const parentPath = parts.join('/');
                if (this.normalizePath(parentPath).length < this.normalizePath(this.basePath).length) {
                    this.loadExplorer(this.basePath);
                } else {
                    this.loadExplorer(parentPath);
                }
            } else {
                this.loadExplorer(this.basePath);
            }
        });
    },

    showLoading: function(text) {
        const overlay = document.getElementById('import-loading-overlay');
        const icon = document.getElementById('import-loading-icon');
        const txt = document.getElementById('import-loading-text');
        
        icon.className = "fas fa-spinner fa-spin fa-3x";
        icon.style.color = "#6f42c1";
        txt.style.color = "#333";
        txt.innerText = text;
        
        overlay.style.display = 'flex';
    },

    hideLoading: function() {
        document.getElementById('import-loading-overlay').style.display = 'none';
    },

    showCustomAlert: function(title, message, type = 'info', onOk = null, onCancel = null) {
        const alertBox = document.getElementById('import-custom-alert');
        const header = document.getElementById('import-alert-header');
        const body = document.getElementById('import-alert-body');
        const btnOk = document.getElementById('import-alert-btn-ok');
        const btnCancel = document.getElementById('import-alert-btn-cancel');

        let iconHtml = '';
        if (type === 'error') {
            header.style.backgroundColor = '#dc3545';
            iconHtml = '<i class="fas fa-exclamation-circle"></i> ';
        } else if (type === 'success') {
            header.style.backgroundColor = '#28a745';
            iconHtml = '<i class="fas fa-check-circle"></i> ';
        } else if (type === 'confirm') {
            header.style.backgroundColor = '#6f42c1';
            iconHtml = '<i class="fas fa-question-circle"></i> ';
        } else {
            header.style.backgroundColor = '#17a2b8';
            iconHtml = '<i class="fas fa-info-circle"></i> ';
        }

        header.innerHTML = iconHtml + title;
        body.innerHTML = message;

        if (type === 'confirm') {
            btnCancel.style.display = 'inline-flex';
        } else {
            btnCancel.style.display = 'none';
        }

        btnOk.onclick = () => {
            alertBox.style.display = 'none';
            if (onOk) onOk();
        };

        btnCancel.onclick = () => {
            alertBox.style.display = 'none';
            if (onCancel) onCancel();
        };

        alertBox.style.display = 'flex';
    },

    loadExplorer: async function(path) {
        this.currentExplorerPath = path;
        document.getElementById('import-current-path').innerText = path;
        
        const navUpBtn = document.getElementById('import-nav-up');
        if (this.normalizePath(path) === this.normalizePath(this.basePath)) {
            navUpBtn.disabled = true;
            navUpBtn.style.opacity = '0.5';
        } else {
            navUpBtn.disabled = false;
            navUpBtn.style.opacity = '1';
        }

        const listContainer = document.getElementById('import-explorer-list');
        listContainer.innerHTML = '<div style="text-align: center; padding: 40px; color:#6c757d;"><i class="fas fa-spinner fa-spin fa-2x"></i> מביא נתונים מהארכיון...</div>';

        try {
            const res = await this.fetchDirectoryData(path);
            listContainer.innerHTML = '';

            const folders = (res.dirs || []).sort((a, b) => a.name.localeCompare(b.name));

            if (folders.length === 0) {
                listContainer.innerHTML = '<div style="padding: 30px; text-align: center; color: #6c757d;"><i class="fas fa-folder-open fa-2x" style="margin-bottom: 10px; color: #dee2e6; display: block;"></i> תיקייה זו ריקה ממבחנים.</div>';
                return;
            }

            const gridHTML = document.createElement('div');
            gridHTML.style.cssText = 'display: flex; flex-direction: column;';

            folders.forEach(folder => {
                const item = document.createElement('div');
                item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid #f1f3f5; cursor: pointer; transition: background 0.2s;';
                
                item.onmouseover = () => item.style.backgroundColor = '#f8f9fa';
                item.onmouseout = () => item.style.backgroundColor = 'transparent';
                
                item.innerHTML = `
                    <div class="folder-click-area" style="display: flex; align-items: center; gap: 12px; overflow: hidden; flex-grow: 1;">
                        <i class="fas fa-folder" style="color: #ffc107; font-size: 1.4em;"></i>
                        <span style="font-weight: 500; color: #383d41; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${folder.name}</span>
                    </div>
                    <button class="button button-success select-import-btn" style="padding: 4px 15px; font-size: 0.85em; min-height: unset; margin: 0;"><i class="fas fa-download"></i> בחר</button>
                `;

                item.querySelector('.folder-click-area').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.loadExplorer(folder.what); 
                });

                item.querySelector('.select-import-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.startValidationAndImport(folder.what); 
                });

                gridHTML.appendChild(item);
            });

            listContainer.appendChild(gridHTML);

        } catch (error) {
            listContainer.innerHTML = `<div style="padding: 30px; text-align: center; color: #dc3545;"><i class="fas fa-exclamation-triangle fa-2x" style="margin-bottom: 10px; display: block;"></i> שגיאה בטעינת התיקייה: ${error.message}</div>`;
        }
    },

    startValidationAndImport: async function(sourcePath) {
        this.showLoading('בודק את תקינות המבחן הנבחר...');

        try {
            const dirContent = await this.fetchDirectoryData(sourcePath);

            const qFolders = (dirContent.dirs || [])
                .filter(dir => /^\d{3}$/.test(dir.name) && dir.name !== '000')
                .sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10));

            if (qFolders.length === 0) {
                this.hideLoading();
                this.showCustomAlert('מבחן לא תקין', 'לא נמצאו תיקיות שאלות בתוך המבחן הנבחר.', 'error');
                return;
            }

            if (qFolders[0].name !== '001') {
                this.hideLoading();
                this.showCustomAlert('מבחן לא תקין', `השאלה הראשונה שנמצאה היא ${qFolders[0].name}. המבחן חייב להתחיל ברצף מתיקייה 001.`, 'error');
                return;
            }

            for (let i = 0; i < qFolders.length; i++) {
                let expectedStr = (i + 1).toString().padStart(3, '0');
                if (qFolders[i].name !== expectedStr) {
                    this.hideLoading();
                    this.showCustomAlert('חוסר ברצף שאלות', `נמצא דילוג במספרי השאלות: לאחר שאלה ${(i).toString().padStart(3, '0')} חסרה תיקייה ${expectedStr}.`, 'error');
                    return;
                }

                this.showLoading(`בודק קבצי שמע בשאלה ${expectedStr}...`);
                const qRes = await this.fetchDirectoryData(qFolders[i].what);
                
                const hasQ = (qRes.files || []).some(f => f.name.toLowerCase().startsWith('q.'));
                const hasA = (qRes.files || []).some(f => f.name.toLowerCase().startsWith('a.'));
                
                if (!hasQ || !hasA) {
                    this.hideLoading();
                    this.showCustomAlert('שגיאת קבצים', `בתיקיית השאלה ${expectedStr} חסר קובץ שאלה (Q) או קובץ תשובה נכונה (A).`, 'error');
                    return;
                }
            }

            this.hideLoading();
            
            this.showCustomAlert(
                'אישור ייבוא ופתיחת מבחן', 
                `המבחן תקין לחלוטין! (נמצאו ${qFolders.length} שאלות).<br><br>האם לייבא אותן כעת? <b>בסיום הייבוא המבחן ייפתח אוטומטית.</b>`, 
                'confirm',
                () => {
                    this.executeImport(qFolders);
                }
            );

        } catch (error) {
            this.hideLoading();
            this.showCustomAlert('שגיאה בסריקה', 'אירעה תקלה במהלך סריקת קבצי המבחן: ' + error.message, 'error');
        }
    },

    executeImport: async function(qFolders) {
        this.showLoading('מתחיל בהעתקת השאלות...');
        
        try {
            const targetFolder = this.getActualTargetFolder();

            for (let i = 0; i < qFolders.length; i++) {
                this.showLoading(`מעתיק שאלה ${qFolders[i].name} מתוך ${qFolders.length}...`);
                const src = qFolders[i].what; 
                const dst = `${targetFolder}/${qFolders[i].name}`; 
                await this.fileActionCopy(src, dst);
            }
            
            this.showLoading('פותח את המבחן (משחרר חסימה)...');
            try {
                await this.unblockTest();
            } catch (unblockError) {
                console.warn('הייבוא הצליח אך שחרור המבחן נכשל:', unblockError);
            }
            
            const overlayText = document.getElementById('import-loading-text');
            const overlayIcon = document.getElementById('import-loading-icon');
            overlayText.innerText = 'הייבוא הושלם והמבחן נפתח!';
            overlayText.style.color = '#28a745';
            overlayIcon.className = 'fas fa-check-circle fa-3x';
            overlayIcon.style.color = '#28a745';
            
            setTimeout(() => {
                this.hideLoading();
                document.getElementById('import-questions-modal').style.display = 'none';
                
                if(typeof testsController !== 'undefined') {
                    testsController.init(true);
                }
            }, 2500);

        } catch (error) {
            this.hideLoading();
            this.showCustomAlert('שגיאה בהעתקה', 'התהליך נעצר עקב תקלה: ' + error.message, 'error');
        }
    }
};