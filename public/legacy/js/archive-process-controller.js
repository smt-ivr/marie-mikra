// ======================================================
//  archive-process-controller.js - ניהול תהליך סגירת מבחן
// ======================================================

const archiveProcessController = {

    init: async function() {
        const activeTestFullPath = document.getElementById('active-test-path-input').value;
        const basePath = activeTestFullPath.substring(0, activeTestFullPath.lastIndexOf('/'));
        const archivePath = document.getElementById('previous-tests-path-input').value;
        
        let nextNumber;
        try {
            const archiveDirData = await archiveController.fetchDirectoryData(archivePath);
            const lastNumber = archiveDirData.dirs.reduce((max, dir) => {
                const match = dir.name.match(/^(\d+)/);
                return match ? Math.max(max, parseInt(match[1], 10)) : max;
            }, 0);
            nextNumber = lastNumber + 1;
        } catch (error) {
            alert(`שגיאה בקבלת נתונים מהארכיון: ${error.message}`);
            return;
        }

        const testName = prompt(`המספר הסידורי הבא הוא ${nextNumber}.\nנא הזן שם תיאורי למבחן (לדוגמה: פרשת-וירא):`);
        if (!testName) return;
        
        const newFolderName = `${String(nextNumber).padStart(2, '0')}-${testName}`;
        
        let activeDirContent;
        try {
            activeDirContent = await archiveController.fetchDirectoryData(basePath);
        } catch(e) {
             alert("שגיאה: לא ניתן היה לקרוא את תוכן תיקיית המבחן הפעיל.");
             return;
        }

        const filesToMove = ['ExaminationAmericanLogOK.ymgr'];
        const iniToMove = ['ExaminationAmericanMiddle.ini'];
        const iniToCopy = ['ExaminationAmericanLogOK.ini'];
        const questionDirs = activeDirContent.dirs.filter(d => /^\d{3}$/.test(d.name) && d.name !== '000');
        
        let checkResults = {};
        filesToMove.forEach(f => checkResults[f] = activeDirContent.files.some(file => file.name === f));
        iniToMove.forEach(f => checkResults[f] = activeDirContent.ini.some(file => file.name === f));
        iniToCopy.forEach(f => checkResults[f] = activeDirContent.ini.some(file => file.name === f));
        checkResults['question_dirs'] = { found: questionDirs.length > 0, count: questionDirs.length, dirs: questionDirs };

        this.showConfirmationModal(newFolderName, checkResults, async () => {
            const newPath = `${archivePath}/${newFolderName}`;
            const operations = [];
            iniToCopy.forEach(f => {
                if (checkResults[f]) operations.push({ type: 'copy', name: f });
            });
            filesToMove.forEach(f => {
                if (checkResults[f]) operations.push({ type: 'move', name: f });
            });
            iniToMove.forEach(f => {
                 if (checkResults[f]) operations.push({ type: 'move', name: f });
            });
            questionDirs.forEach(d => {
                operations.push({ type: 'move', name: d.name, what: d.what });
            });

            this.showProgressModal(newFolderName, operations);

            try {
                // 1. יצירת התיקייה
                const createResult = await this.createDirectory(newPath);
                this.updateProgress('create_dir', createResult.success, createResult.message);
                if (!createResult.success) throw new Error("יצירת התיקייה נכשלה. התהליך נעצר.");

                // 2. חסימת המבחן (תוספת חדשה)
                const blockResult = await this.blockActiveTest();
                const blockMsg = blockResult.success ? 'פקודת חסימת מבחן נשלח בהצלחה' : blockResult.message;
                this.updateProgress('block_test', blockResult.success, blockMsg);

                // 3. ביצוע הפעולות
                for (const op of operations) {
                    const whatPath = op.what || `${basePath}/${op.name}`;
                    const result = await this.fileAction(op.type, whatPath, newPath);
                    this.updateProgress(`${op.type}-${op.name}`, result.success, result.message);
                }
                
                // 4. עדכון כותרת להצלחה
                const modalTitle = document.getElementById('progress-modal-title');
                if(modalTitle) modalTitle.innerHTML = `<i class="fas fa-check-circle"></i> הארכוב הושלם בהצלחה`;

                document.getElementById('progress-modal-close-btn').disabled = false;
                // רענון התצוגה הראשית
                testsController.init(true);

            } catch (error) {
                this.updateProgress('error', false, error.message);
                 document.getElementById('progress-modal-close-btn').disabled = false;
            }
        });
    },

    createDirectory: async function(path) {
        try {
            const token = auth.getToken();
            const apiUrl = `${auth.API_BASE}/UpdateExtension?token=${token}&path=${encodeURIComponent(path)}`;
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`שגיאת רשת: ${response.status}`);
            const result = await response.json();
            return { success: result.responseStatus === 'OK', message: result.message || 'בוצע' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    },

    // פונקציה חדשה לחסימת המבחן
    blockActiveTest: async function() {
        try {
            const token = auth.getToken();
            // שליחת בקשה ספציפית כפי שהתבקש
            const apiUrl = `${auth.API_BASE}/UpdateExtension?token=${token}&path=ivr2:/1/1&enter_foldar_end_time=2019-07-09-18-52-30`;
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`שגיאת רשת: ${response.status}`);
            const result = await response.json();
            return { success: result.responseStatus === 'OK', message: result.message || 'בוצע' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    },

    fileAction: async function(action, what, target) {
        try {
            const token = auth.getToken();
            const apiUrl = `${auth.API_BASE}/FileAction?token=${token}&action=${action}&what=${encodeURIComponent(what)}&target=${encodeURIComponent(target)}`;
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`שגיאת רשת: ${response.status}`);
            const result = await response.json();
            const report = result.reports && result.reports[0] ? result.reports[0] : {};
            return { success: result.success && report.success, message: result.message === 'ok' ? 'בוצע' : result.message };
        } catch (error) {
            return { success: false, message: error.message };
        }
    },

    showConfirmationModal: function(folderName, checks, onConfirm) {
        const oldModal = document.getElementById('archive-confirm-modal');
        if (oldModal) oldModal.remove();

        const getStatus = (found) => found ? '<span style="color: green;">✓ נמצא</span>' : '<span style="color: red;">✗ לא נמצא!</span>';
        const qdCheck = checks['question_dirs'];
        let qdHtml = `<li>תיקיות שאלות: ${getStatus(qdCheck.found)}</li>`;
        if (qdCheck.found) {
            const dirList = qdCheck.dirs.map(d => d.name).join(', ');
            qdHtml += `<ul style="font-size: 0.9em; color: #555;"><li>${dirList}</li></ul>`;
        }

        const modalHtml = `
            <div id="archive-confirm-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 3000;">
                <div class="modal-container" style="width: 500px;">
                    <div class="modal-header"><h2><i class="fas fa-archive"></i> אישור סגירת מבחן</h2></div>
                    <div class="modal-body">
                        תיקייה חדשה בשם <strong>${folderName}</strong> תיווצר בארכיון. האם להמשיך?
                        <div style="max-height: 250px; overflow-y: auto; border: 1px solid #ddd; padding: 10px 15px; background: #f9f9f9; border-radius: 4px; margin-top: 15px;">
                            <p><strong>יועתק (יישאר גם במקור):</strong></p>
                            <ul><li>ExaminationAmericanLogOK.ini: ${getStatus(checks['ExaminationAmericanLogOK.ini'])}</li></ul>
                            <p><strong>יועברו (יימחקו מהמקור):</strong></p>
                            <ul>
                                <li>ExaminationAmericanLogOK.ymgr: ${getStatus(checks['ExaminationAmericanLogOK.ymgr'])}</li>
                                <li>ExaminationAmericanMiddle.ini: ${getStatus(checks['ExaminationAmericanMiddle.ini'])}</li>
                                ${qdHtml}
                            </ul>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button id="confirm-archive-btn" class="button button-success"><i class="fas fa-check"></i> אשר וסגור מבחן</button>
                        <button id="cancel-archive-btn" class="button button-danger"><i class="fas fa-times"></i> ביטול</button>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modalElement = document.getElementById('archive-confirm-modal');
        document.getElementById('confirm-archive-btn').addEventListener('click', () => { onConfirm(); modalElement.remove(); });
        document.getElementById('cancel-archive-btn').addEventListener('click', () => modalElement.remove());
    },
    
    showProgressModal: function(folderName, operations) {
        const oldModal = document.getElementById('archive-progress-modal');
        if (oldModal) oldModal.remove();

        const copyOps = operations.filter(op => op.type === 'copy');
        const moveOps = operations.filter(op => op.type === 'move');
        
        const generateListItems = (ops) => ops.map(op => `<li id="progress-${op.type}-${op.name}"><i class="fas fa-clock"></i> <strong>${op.name}</strong>: <span>ממתין...</span></li>`).join('');

        const modalHtml = `
            <div id="archive-progress-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 4000;">
                <div class="modal-container" style="width: 650px;">
                    <div class="modal-header"><h2 id="progress-modal-title"><i class="fas fa-cogs"></i> מבצע סגירת מבחן...</h2></div>
                    <div class="modal-body" style="max-height: 600px; overflow-y: auto;">
                        <p>מעביר לארכיון לתיקייה: <strong>${folderName}</strong></p>
                        <ul id="progress-list" style="list-style-type: none; padding: 0; font-size: 0.95em;">
                           <li id="progress-create_dir"><i class="fas fa-spinner fa-spin"></i> <strong>יצירת תיקייה ראשית</strong>: <span>מבצע...</span></li>
                           <li id="progress-block_test"><i class="fas fa-ban"></i> <strong>חסימת מבחן</strong>: <span>ממתין...</span></li>
                        </ul>
                        ${copyOps.length > 0 ? `<h4><i class="fas fa-copy"></i> פעולות העתקה</h4><ul class="progress-sublist">${generateListItems(copyOps)}</ul>` : ''}
                        ${moveOps.length > 0 ? `<h4><i class="fas fa-cut"></i> פעולות העברה</h4><ul class="progress-sublist">${generateListItems(moveOps)}</ul>` : ''}
                         <li id="progress-error" style="color: red; font-weight: bold; margin-top: 10px; display: none;"></li>
                    </div>
                    <div class="modal-footer">
                        <button id="progress-modal-close-btn" class="button button-primary" disabled>סגור</button>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        const modalElement = document.getElementById('archive-progress-modal');
        document.getElementById('progress-modal-close-btn').addEventListener('click', () => modalElement.remove());
    },
    
    updateProgress: function(id, success, message) {
        let item = document.getElementById(`progress-${id}`);
        const icon = success ? '<i class="fas fa-check-circle" style="color: green;"></i>' : '<i class="fas fa-times-circle" style="color: red;"></i>';
        
        if (id === 'error') {
            item = document.getElementById('progress-error');
            item.style.display = 'block';
            item.innerHTML = `${icon} <strong>שגיאה קריטית:</strong> ${message}`;
            const modalTitle = document.getElementById('progress-modal-title');
            if(modalTitle) modalTitle.innerHTML = `<i class="fas fa-exclamation-triangle"></i> הארכוב נכשל`;
            return;
        }

        if (item) {
             const name = item.querySelector('strong').textContent;
             const statusMessage = success ? message : `נכשל (${message})`; // שינוי קטן כדי לאפשר הודעה מותאמת אישית בהצלחה
             // אם לא הועברה הודעה ספציפית בהצלחה, השתמש ב'בוצע' כברירת מחדל (שומר על תאימות לאחור)
             const finalMsg = success && message === 'בוצע' ? 'בוצע' : statusMessage;
             
             item.innerHTML = `${icon} <strong>${name}</strong>: <span style="color: ${success ? 'green' : 'red'};">${finalMsg}</span>`;
        }
    }
};