const pointsEditController = {
    modalOverlay: null,
    modalTitle: null,
    modalBody: null,
    modalFooter: null, // *** נוסף: ננהל את הכותרת התחתונה ***
    
    // רכיבי DOM פנימיים
    mainView: null,
    successView: null,
    
    currentStudentId: null,
    currentStudentName: '', // *** תוספת: לשמירת שם התלמיד ***
    currentPointsFilePath: null,
    fullFileContent: '',
    
    currentPoints: 0,
    previewPoints: 0,

    init: async function(studentId, pointsFilePath) {
        this.currentStudentId = studentId;
        this.currentPointsFilePath = pointsFilePath;

        if (!this.modalOverlay) {
            this.injectModalHtml();
        }
        
        this.show();
        this.showMainView(); // הצג את המסך הראשי (במקום "טוען")
        this.modalTitle.textContent = `ניהול נקודות`;

        // *** תוספת: הסתרת אזור הפעולות בזמן טעינה ***
        const inputArea = this.mainView.querySelector('#points-input-area');
        if (inputArea) {
            inputArea.style.display = 'none';
        }
        // *** סוף תוספת ***
        
        // *** תיקון לבאג הטעינה: מציג טעינה בתוך הרכיב הנכון ***
        const currentPointsContainer = this.mainView.querySelector('#current-points-container');
        currentPointsContainer.querySelector('.points-label').textContent = 'טוען נתונים...';
        currentPointsContainer.querySelector('#current-points-value').innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 2rem;"></i>';


        try {
            this.fullFileContent = await this.fetchIniFileContent(this.currentPointsFilePath);
            const studentData = await this.parseStudentData(studentId);

            if (!studentData) {
                throw new Error('לא ניתן למצוא את התלמיד בקובץ הנקודות.');
            }
            
            this.currentPoints = studentData.points;
            this.previewPoints = studentData.points;
            this.currentStudentName = studentData.name; // *** תוספת: שמירת שם התלמיד ***
            this.renderEditForm(studentData);

        } catch (error) {
            currentPointsContainer.innerHTML = `<p class="error-message" style="padding: 1rem; margin: 0;">${error.message}</p>`;
        }
    },

    fetchIniFileContent: async function(filePath) {
        const token = auth.getToken();
        if (!token) throw new Error("לא נמצא טוקן.");
        const apiUrl = `${auth.API_BASE}/GetTextFile?token=${token}&what=${encodeURIComponent(filePath)}`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`שגיאת רשת (${response.status})`);
        const result = await response.json();
        if (result.responseStatus !== 'OK') throw new Error(result.message || 'שגיאה בקבלת תוכן קובץ הנקודות');
        return result.contents;
    },

    parseStudentData: async function(studentId) {
        let points = 0;
        const pointsLine = this.fullFileContent.split('\n').find(line => 
            line.trim().startsWith(`list_all_information-${studentId}-points_total=`)
        );
        if (pointsLine) {
            points = parseInt(pointsLine.split('=')[1], 10);
        } else {
             throw new Error("מזהה תלמיד לא נמצא בקובץ הנקודות.");
        }

        let name = 'אין נתון';
        try {
            const studentsContent = await pointsController.fetchFileContent(pointsController.STUDENTS_INI_FILE_PATH);
            const studentsMap = new Map();
            studentsContent.split('\n').forEach(line => {
                const parts = line.trim().split(',');
                if (parts.length >= 3 && parts[0] && !isNaN(parts[0])) {
                    studentsMap.set(parts[0], [parts[2], parts[3]].filter(Boolean).join(' ').trim() || "ללא שם");
                }
            });
            if (studentsMap.has(studentId)) {
                name = studentsMap.get(studentId);
            }
        } catch (e) {
            console.error("שגיאה בקריאת קובץ שמות:", e.message);
        }
        
        return { name, points };
    },
    
    renderEditForm: function(studentData) {
        this.modalTitle.textContent = `ניהול נקודות: ${studentData.name}`;
        
        const currentPointsContainer = this.mainView.querySelector('#current-points-container');
        currentPointsContainer.querySelector('.points-label').textContent = 'ניקוד נוכחי';
        currentPointsContainer.querySelector('#current-points-value').innerHTML = `<i class="fas fa-star"></i> ${this.currentPoints}`;

        this.updateViewMode();

        // *** תוספת: מיקוד אוטומטי בשדה הכמות ***
        const amountInput = document.getElementById('points-change-amount');
        if (amountInput) {
            // השהייה קטנה כדי לוודא שהאלמנט גלוי וניתן למיקוד
            setTimeout(() => amountInput.focus(), 0);
        }
    },
    
    addFormEventListeners: function() {
        // מאזינים יתווספו ב-injectModalHtml שם הכפתורים נוצרים
    },

    // *** פונקציה חדשה: מעדכנת את התצוגה כולה ***
    updateViewMode: function() {
        const inputArea = document.getElementById('points-input-area');
        const pendingArea = document.getElementById('points-pending-changes');
        
        if (this.previewPoints === this.currentPoints) {
            // --- מצב התחלתי (הזנת קלט) ---
            inputArea.style.display = 'flex';
            pendingArea.style.display = 'none';
            document.getElementById('points-change-amount').value = '';
            
            // עדכון כותרת תחתונה (הכפתור הוסר לפי הבקשה)
            this.modalFooter.innerHTML = ``;
            
        } else {
            // --- מצב שינוי ממתין ---
            inputArea.style.display = 'none';
            pendingArea.style.display = 'flex';
            
            const diff = this.previewPoints - this.currentPoints;
            const diffText = diff > 0 ? `+${diff}` : `${diff}`;
            const diffClass = diff > 0 ? 'points-increased' : 'points-decreased';

            document.getElementById('preview-points-value').textContent = this.previewPoints;
            document.getElementById('change-points-value').textContent = `(${diffText} נקודות)`;
            
            document.getElementById('preview-points-value').className = `points-value ${diffClass}`;
            document.getElementById('change-points-value').className = `change-value ${diffClass}`;
            
            // עדכון כותרת תחתונה
            this.modalFooter.innerHTML = `
                <div class="pending-warning-footer">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>השינוי טרם נשמר!</span>
                </div>
                <button id="cancel-change-btn" class="button button-archive"><i class="fas fa-undo"></i> בטל שינוי</button>
                <button id="save-change-btn" class="button button-success"><i class="fas fa-save"></i> שמור שינויים</button>
            `;
            this.modalFooter.querySelector('#cancel-change-btn').addEventListener('click', () => {
                this.previewPoints = this.currentPoints;
                this.updateViewMode();
                
                // *** תוספת: החזרת פוקוס לשדה הכמות ***
                const amountInput = document.getElementById('points-change-amount');
                if (amountInput) {
                    setTimeout(() => amountInput.focus(), 0);
                }
                // *** סוף תוספת ***
            });
            this.modalFooter.querySelector('#save-change-btn').addEventListener('click', () => this.executeSave());
        }
    },

    executeSave: async function() {
        const saveBtn = this.modalFooter.querySelector('#save-change-btn');
        if (saveBtn) {
             saveBtn.disabled = true;
             saveBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> שומר...`;
        }
        
        try {
            const lines = this.fullFileContent.split('\n');
            const linePrefix = `list_all_information-${this.currentStudentId}-points_total=`;
            
            const lineIndex = lines.findIndex(line => line.trim().startsWith(linePrefix));
            if (lineIndex === -1) throw new Error("התלמיד לא נמצא בקובץ המקורי.");

            lines[lineIndex] = `${linePrefix}${this.previewPoints}`;
            const newContent = lines.join('\n');

            await this.uploadNewContent(newContent);
            
            const oldPoints = this.currentPoints;
            const newPoints = this.previewPoints;
            
            // עדכן את הערך הנוכחי בבסיס
            this.currentPoints = newPoints;
            this.fullFileContent = newContent; // שמור את התוכן החדש לשימוש עתידי

            this.showSuccessScreen(this.currentStudentName, oldPoints, newPoints);
            
            // רענן את התצוגה הראשית ברקע
            pointsController.init(true); 

        } catch (error) {
            alert(`שגיאה בעדכון הנקודות: ${error.message}`);
            if (saveBtn) {
                 saveBtn.disabled = false;
                 saveBtn.innerHTML = `<i class="fas fa-save"></i> שמור שינויים`;
            }
        }
    },

    uploadNewContent: async function(content) {
        const token = auth.getToken();
        const apiUrl = `${auth.API_BASE}/UploadTextFile`;
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token, what: this.currentPointsFilePath, contents: content })
        });
        if (!response.ok) throw new Error(`שגיאת רשת (${response.status})`);
        const result = await response.json();
        if (result.responseStatus !== 'OK') throw new Error(result.message || 'השרת החזיר שגיאה בעת השמירה.');
    },

    // --- פונקציות ניהול תצוגה חדשות ---

    showMainView: function() {
        this.mainView.style.display = 'block';
        this.successView.style.display = 'none';
        this.updateViewMode(); // אפס את התצוגה
    },

    showSuccessScreen: function(studentName, oldPoints, newPoints) {
        const diff = newPoints - oldPoints;
        const diffText = diff > 0 ? `(תוספת של ${diff} נקודות)` : `(הפחתה של ${Math.abs(diff)} נקודות)`;
        
        document.getElementById('success-details').innerHTML = 
            `הניקוד של <strong>${studentName}</strong> עודכן מ-<strong>${oldPoints}</strong> ל-<strong>${newPoints}</strong> ${diffText}`;

        this.mainView.style.display = 'none';
        this.successView.style.display = 'block';
        
        // עדכון כותרת תחתונה למסך הצלחה
        this.modalFooter.innerHTML = `
             <button id="success-close-btn" class="button button-primary" style="margin-left: auto;"><i class="fas fa-check"></i> סיום</button>
        `;
        this.modalFooter.querySelector('#success-close-btn').addEventListener('click', () => this.hide());
    },

    show: function() { this.modalOverlay.classList.add('visible'); },
    hide: function() { 
        this.modalOverlay.classList.remove('visible'); 
        // אפס את החלון למצב ההתחלתי בפעם הבאה שייפתח
        setTimeout(() => {
            this.showMainView();
        }, 300); // השהיה קטנה כדי לאפשר לאנימציית הסגירה לסיים
    },

    injectModalHtml: function() {
        const modalHtml = `
            <div id="points-edit-modal-overlay">
                <div class="modal-container" style="max-width: 480px;">
                    <div class="modal-header">
                        <h2 id="points-edit-modal-title"><i class="fas fa-edit"></i> ניהול נקודות</h2>
                        <span class="close-btn" title="סגירה">&times;</span>
                    </div>
                    <div id="points-edit-modal-body" class="modal-body">
                    
                        <div id="points-edit-main">
                            <div id="current-points-container" class="current-points-container">
                                <div class="points-label">ניקוד נוכחי</div>
                                <div id="current-points-value" class="points-value"><i class="fas fa-star"></i> 0</div>
                            </div>
                            
                            <div id="points-input-area" class="points-input-area">
                                <label for="points-change-amount" class="points-input-label">1. בחר כמות לשינוי:</label>
                                <input type="number" id="points-change-amount" placeholder="לדוגמה: 50">
                                <label class="points-input-label">2. בחר פעולה:</label>
                                <div class="points-action-buttons">
                                    <button id="subtract-points-btn" class="button button-danger"><i class="fas fa-minus-circle"></i> הפחת נקודות</button>
                                    <button id="add-points-btn" class="button button-success"><i class="fas fa-plus-circle"></i> הוסף נקודות</button>
                                </div>
                            </div>

                            <div id="points-pending-changes" class="points-pending-changes" style="display: none;">
                                <div class="pending-details">
                                    <div class="pending-box">
                                        <div class="points-label">ניקוד חדש</div>
                                        <div id="preview-points-value" class="points-value">0</div>
                                    </div>
                                    <div class="pending-box">
                                        <div class="points-label">שינוי</div>
                                        <div id="change-points-value" class="change-value">0</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div id="points-edit-success" class="points-edit-success" style="display: none;">
                            <div class="success-icon"><i class="fas fa-check-circle"></i></div>
                            <h2>העדכון הושלם בהצלחה!</h2>
                            <p id="success-details"></p>
                        </div>
                        
                    </div>
                    <div id="points-edit-modal-footer" class="modal-footer">
                        </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        this.modalOverlay = document.getElementById('points-edit-modal-overlay');
        this.modalTitle = document.getElementById('points-edit-modal-title');
        this.modalBody = document.getElementById('points-edit-modal-body');
        this.modalFooter = document.getElementById('points-edit-modal-footer'); // *** איתחול הפוטר ***
        
        this.mainView = document.getElementById('points-edit-main');
        this.successView = document.getElementById('points-edit-success');
        this.pendingView = document.getElementById('points-pending-changes');

        // הוספת מאזינים
        this.modalOverlay.querySelector('.close-btn').addEventListener('click', () => this.hide());
        
        const handleUpdate = (action) => {
            const amountInput = document.getElementById('points-change-amount');
            const amount = parseInt(amountInput.value, 10);
            
            if (isNaN(amount) || amount <= 0) {
                amountInput.classList.add('input-error');
                setTimeout(() => amountInput.classList.remove('input-error'), 500);
                return;
            }
            
            this.previewPoints = (action === 'add') ? this.previewPoints + amount : this.previewPoints - amount;
            this.updateViewMode();
        };

        document.getElementById('add-points-btn').addEventListener('click', () => handleUpdate('add'));
        document.getElementById('subtract-points-btn').addEventListener('click', () => handleUpdate('subtract'));
    }
};