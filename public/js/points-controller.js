const pointsController = {
    // רכיבי ה-DOM של הלשונית
    reportHeader: document.querySelector('#points-view #report-header'),
    reportTitle: document.querySelector('#points-view #report-title'),
    reportContainer: document.querySelector('#points-view #report-container'),
    archivePointsBtn: document.querySelector('#points-view #archive-points-btn'),
    previousPointsBtn: document.querySelector('#points-view #previous-points-btn'),
    exportExcelBtn: document.querySelector('#points-view #export-excel-btn'),
    exportWordBtn: document.querySelector('#points-view #export-word-btn'),
    
    // נתיבים לקבצי המקור
    POINTS_INI_FILE_PATH: 'ivr2:/Points/Split/points_total.ini',
    STUDENTS_INI_FILE_PATH: 'ivr2:/EnterID/ListAllInformation.ini',

    currentReportData: [],
    initialized: false,

    init: function(forceRefresh = false) {
        if (!this.initialized) {
            this.addEventListeners();
        }

        if (!this.initialized || forceRefresh) {
            this.initialized = true;
            this.resetToDefaultView();
            this.fetchPointsReportData();
        }
    },
    
    resetToDefaultView: function() {
        const viewActions = document.querySelector('#points-view .view-actions');
        viewActions.innerHTML = `
            <button id="previous-points-btn" class="button button-browse"><i class="fas fa-history"></i> דוחות ניקוד קודמים</button>
            <div class="search-wrapper">
                <i class="fas fa-search"></i>
                <input type="text" id="points-search-input" placeholder="חיפוש...">
            </div>
        `;
        this.previousPointsBtn = document.querySelector('#points-view #previous-points-btn');
        this.previousPointsBtn.addEventListener('click', () => pointsArchiveController.init());
        
        document.getElementById('points-search-input').addEventListener('input', (e) => this.filterTable(e.target.value));
    },

    addEventListeners: function() {
        this.archivePointsBtn.addEventListener('click', () => pointsArchiveProcessController.init());
        
        this.reportContainer.addEventListener('click', (e) => {
            const button = e.target.closest('.manage-points-btn');
            if (button) {
                const studentId = button.dataset.studentId;
                pointsEditController.init(studentId, this.POINTS_INI_FILE_PATH);
            }
        });

        app.setupExportButtons(
            { excel: this.exportExcelBtn, word: this.exportWordBtn },
            () => this.reportContainer,
            () => this.reportTitle,
            () => this.currentReportData
        );
    },

    fetchPointsReportData: async function() {
        this.archivePointsBtn.style.display = 'inline-flex';
        this.reportHeader.classList.add('hidden');
        this.reportTitle.textContent = 'דוח נקודות';
        this.reportContainer.innerHTML = `<div id="loading"><i class="fas fa-spinner fa-spin"></i> טוען נתונים...</div>`;
        
        // --- איתור זמן עדכון ---
        let fileMTime = 'לא ידוע';
        try {
            const parentDir = this.POINTS_INI_FILE_PATH.substring(0, this.POINTS_INI_FILE_PATH.lastIndexOf('/'));
            const fileName = this.POINTS_INI_FILE_PATH.split('/').pop();
            const dirData = await this.fetchDirectoryData(parentDir); // שימוש בפונקציה החדשה
            const fileInfo = dirData.ini.find(f => f.name === fileName); // חיפוש בקבצי ini
            if (fileInfo && fileInfo.mtime) {
                fileMTime = fileInfo.mtime;
            }
        } catch (dirError) {
            console.warn("Could not get mtime for points file:", dirError.message);
        }
        
        try {
            // טעינת שני הקבצים
            const [studentsContent, pointsContent] = await Promise.all([
                this.fetchFileContent(this.STUDENTS_INI_FILE_PATH, true), 
                this.fetchFileContent(this.POINTS_INI_FILE_PATH)
            ]);
            
            if (pointsContent === null) {
                this.reportContainer.innerHTML = `<p class="info-message"><i class="fas fa-info-circle"></i> לא נמצא דוח נקודות פעיל.</p>`;
                return;
            }

            const finalStudentsContent = studentsContent === null ? '' : studentsContent;
            const mergedData = this.parseAndMergeData(finalStudentsContent, pointsContent);
            this.currentReportData = mergedData;

            app.createReportTable(mergedData, this.reportContainer, 'points');
            
            // --- הוספת אלמנט הסטטיסטיקה ---
            let statsEl = this.reportHeader.querySelector('.report-stats');
            if (!statsEl) {
                this.reportHeader.insertAdjacentHTML('afterbegin', '<div class="report-stats"></div>');
                statsEl = this.reportHeader.querySelector('.report-stats');
            }
            statsEl.innerHTML = `סה"כ: <strong>${mergedData.length}</strong> | עדכון אחרון: <strong>${fileMTime}</strong>`;

            this.reportHeader.classList.remove('hidden');

        } catch (error) {
            this.reportHeader.classList.add('hidden');
            this.reportContainer.innerHTML = `<p class="error-message"><i class="fas fa-exclamation-triangle"></i> שגיאה בטעינת הנתונים: ${error.message}</p>`;
        }
    },
    
    parseAndMergeData: function(studentsContent, pointsContent) {
        const studentsMap = new Map();
        if (studentsContent) {
            studentsContent.split('\n').forEach(line => {
                const parts = line.trim().split(',');
                if (parts.length >= 6 && parts[0] && !isNaN(parts[0])) {
                    const id = parts[0];
                    const name = [parts[2], parts[3]].filter(Boolean).join(' ').trim() || "ללא שם";
                    const school = parts[5].trim() || "לא ידוע";
                    studentsMap.set(id, { name, school });
                }
            });
        }

        const mergedData = [];
        pointsContent.split('\n').forEach(line => {
            line = line.trim();
            if (line.startsWith('list_all_information-')) {
                const parts = line.split('=');
                if (parts.length === 2) {
                    const idPart = parts[0].split('-')[1];
                    const points = parseInt(parts[1], 10);

                    if (idPart && !isNaN(points)) {
                        const studentInfo = studentsMap.get(idPart);
                        mergedData.push({
                            'קוד': idPart,
                            'שם': studentInfo ? studentInfo.name : 'אין נתון',
                            'כיתה': studentInfo ? studentInfo.school : 'אין נתון',
                            'סה"כ נקודות': points
                        });
                    }
                }
            }
        });
        
        return mergedData;
    },

    filterTable: function(searchTerm) {
        const table = this.reportContainer.querySelector('.report-table');
        if (!table) return;
        const rows = table.querySelectorAll('tbody tr');
        const term = searchTerm.toLowerCase();

        rows.forEach(row => {
            const nameCell = row.cells[1];
            const idCell = row.cells[0];
            const nameText = nameCell ? nameCell.textContent.toLowerCase() : '';
            const idText = idCell ? idCell.textContent.toLowerCase() : '';

            if (nameText.includes(term) || idText.includes(term)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    },
    
    displayArchivedReport: async function(archiveFolderPath, title) {
        const viewActions = document.querySelector('#points-view .view-actions');
        viewActions.innerHTML = `
            <button id="back-to-active-points-btn" class="button button-success"><i class="fas fa-home"></i> חזור לדוח הפעיל</button>
            <button id="back-to-points-explorer-btn" class="button button-browse"><i class="fas fa-arrow-left"></i> חזור לסייר</button>
        `;
        document.getElementById('back-to-active-points-btn').addEventListener('click', () => this.init(true));
        document.getElementById('back-to-points-explorer-btn').addEventListener('click', () => pointsArchiveController.init());

        this.archivePointsBtn.style.display = 'none';
        this.reportHeader.classList.add('hidden');
        this.reportTitle.textContent = title;
        this.reportContainer.innerHTML = `<div id="loading"><i class="fas fa-spinner fa-spin"></i> טוען דוח מארכיון...</div>`;

        // --- ניקוי הסטטיסטיקה הקודמת ---
        const statsEl = this.reportHeader.querySelector('.report-stats');
        if (statsEl) statsEl.innerHTML = '';
        
        // --- תחילת שינוי: איתור זמן עדכון מארכיון ---
        let fileMTime = 'לא ידוע';
        const pointsIniPath = `${archiveFolderPath}/points_total.ini`;
        const fileName = 'points_total.ini';

        try {
            const dirData = await this.fetchDirectoryData(archiveFolderPath);
            const fileInfo = dirData.ini.find(f => f.name === fileName);
            if (fileInfo && fileInfo.mtime) {
                fileMTime = fileInfo.mtime;
            }
        } catch (dirError) {
            console.warn(`Could not get mtime for archived points file ${archiveFolderPath}:`, dirError.message);
        }
        // --- סוף שינוי ---

        try {
            const [studentsContent, pointsContent] = await Promise.all([
                this.fetchFileContent(this.STUDENTS_INI_FILE_PATH, true),
                this.fetchFileContent(pointsIniPath) // שימוש בנתיב שכבר הוגדר
            ]);
            
            if (pointsContent === null) {
                this.reportContainer.innerHTML = `<p class="info-message"><i class="fas fa-info-circle"></i> לא נמצא קובץ נקודות בארכיון זה.</p>`;
                return;
            }

            const finalStudentsContent = studentsContent === null ? '' : studentsContent;
            
            const mergedData = this.parseAndMergeData(finalStudentsContent, pointsContent);
            this.currentReportData = mergedData;

            app.createReportTable(mergedData, this.reportContainer, 'points-archive');
            
            // --- הוספת סטטיסטיקה + זמן עדכון לדוח ארכיון ---
            let archiveStatsEl = this.reportHeader.querySelector('.report-stats');
            if (!archiveStatsEl) {
                this.reportHeader.insertAdjacentHTML('afterbegin', '<div class="report-stats"></div>');
                archiveStatsEl = this.reportHeader.querySelector('.report-stats');
            }
            archiveStatsEl.innerHTML = `סה"כ: <strong>${mergedData.length}</strong> | עדכון אחרון: <strong>${fileMTime}</strong>`;
            // --- סוף הוספה ---
            
            this.reportHeader.classList.remove('hidden');

        } catch (error) {
            this.reportHeader.classList.add('hidden');
            this.reportContainer.innerHTML = `<p class="error-message"><i class="fas fa-exclamation-triangle"></i> שגיאה בטעינת הדוח מהארכיון: ${error.message}</p>`;
        }
    },

    // פונקציית עזר כללית לקריאת תוכן קובץ עם טיפול בשגיאות - תוקנה!
    fetchFileContent: async function(path, isOptional = false) {
        const token = auth.getToken();
        // --- כאן בוצע התיקון: הוספת פרמטר זמן ---
        const apiUrl = `${auth.API_BASE}/GetTextFile?token=${token}&what=${encodeURIComponent(path)}&_=${new Date().getTime()}`;
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`שגיאת רשת (${response.status})`);
            
            const result = await response.json();
            if (result.responseStatus !== 'OK') {
                const isNotExistError = result.message && (result.message.includes('Error retrieving file path information') || result.message.includes('Invalid path') || result.message.includes('file does not exist'));
                
                if (isNotExistError && isOptional) {
                    console.warn(`קובץ אופציונלי לא נמצא: ${path}`);
                    return null;
                }
                 if (isNotExistError && !isOptional) {
                    return null;
                }
                
                throw new Error(result.message || 'שגיאה כללית בקריאת קובץ');
            }
            return result.contents;
        } catch (error) {
            throw error;
        }
    }
    , 

    // פונקציית עזר לקריאת נתוני תיקייה (נדרש עבור mtime)
    fetchDirectoryData: async function(path) {
        const token = auth.getToken();
        if (!token) throw new Error("לא נמצא טוקן.");

        const apiUrl = `${auth.API_BASE}/GetIVR2Dir?token=${token}&path=${encodeURIComponent(path)}`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`שגיאת רשת (${response.status})`);
        const result = await response.json();
        if (result.responseStatus !== 'OK') throw new Error(result.message || 'שגיאה בקבלת נתונים');
        
        result.ini = result.ini || [];
        result.files = result.files || [];
        result.dirs = result.dirs || [];
        return result;
    }
};