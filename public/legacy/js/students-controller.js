// ======================================================
//  students-controller.js - ניהול לשונית התלמידים (גרסה 3.2 - עדכון פריסה + mtime)
// ======================================================

const studentsController = {
    view: document.getElementById('students-view'),
    initialized: false,
    studentsData: [], // מערך שיחזיק את כל התלמידים כאובייקטים
    tableHeaders: [], // מערך שיחזיק את הכותרות מהקובץ

    STUDENTS_INI_FILE_PATH: 'ivr2:/EnterID/ListAllInformation.ini',

    init: function(forceRefresh = false) {
        if (!this.initialized || forceRefresh) {
            this.initialized = true;
            this.fetchAndDisplayStudents();
        }
    },

    // פונקציה חדשה לקריאת נתוני תיקייה (כדי להשיג mtime)
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

    fetchAndDisplayStudents: async function() {
        this.view.innerHTML = `<div id="loading"><i class="fas fa-spinner fa-spin"></i> טוען רשימת תלמידים...</div>`;
        
        try {
            // 1. קבל את נתוני התיקייה כדי למצוא את זמן העדכון
            const parentDir = this.STUDENTS_INI_FILE_PATH.substring(0, this.STUDENTS_INI_FILE_PATH.lastIndexOf('/'));
            const fileName = this.STUDENTS_INI_FILE_PATH.split('/').pop();
            
            let fileMTime = 'לא ידוע';
            try {
                const dirData = await this.fetchDirectoryData(parentDir);
                const fileInfo = dirData.ini.find(f => f.name === fileName);
                if (fileInfo && fileInfo.mtime) {
                    fileMTime = fileInfo.mtime;
                }
            } catch (dirError) {
                console.error("שגיאה בקבלת נתוני תיקייה (mtime):", dirError.message);
                // המערכת תמשיך לרוץ גם אם לא הצליחה להשיג את זמן העדכון
            }

            // 2. קבל את תוכן הקובץ
            const fileContent = await pointsController.fetchFileContent(this.STUDENTS_INI_FILE_PATH, false);
            if (fileContent === null) {
                this.view.innerHTML = `<p class="info-message"><i class="fas fa-info-circle"></i> לא נמצא קובץ תלמידים.</p>`;
                return;
            }

            // 3. עבד והצג
            this.parseStudents(fileContent);
            this.renderStudentsView(fileMTime); // העבר את זמן העדכון לתצוגה

        } catch (error) {
            this.view.innerHTML = `<p class="error-message"><i class="fas fa-exclamation-triangle"></i> שגיאה בטעינת הנתונים: ${error.message}</p>`;
        }
    },

    parseStudents: function(content) {
        this.studentsData = [];
        const lines = content.split('\n');
        
        if (lines.length > 0) {
            this.tableHeaders = lines[0].trim().split(',').slice(0, 6);
        } else {
            this.tableHeaders = ['קוד', 'סטטוס', 'שם', 'משפחה', 'הערה', 'כיתה'];
        }
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const parts = line.split(',');
            if (parts.length > 0 && parts[0]) {
                this.studentsData.push({
                    id: parts[0],
                    status: parts[1] || '1',
                    firstName: parts[2] || '',
                    lastName: parts[3] || '',
                    note: parts[4] || '',
                    class: parts[5] || ''
                });
            }
        }
    },

    // --- הפונקציה עודכנה לקבל fileMTime ---
    renderStudentsView: function(fileMTime = 'לא ידוע') {
        const totalStudents = this.studentsData.length;
        const activeStudents = this.studentsData.filter(s => s.status === '1').length;

        const headersHtml = `
            <th><input type="checkbox" id="students-select-all" title="בחר הכל"></th>
            <th>${this.tableHeaders[0] || 'קוד'}</th>
            <th>${this.tableHeaders[2] || 'שם'}</th>
            <th>${this.tableHeaders[3] || 'משפחה'}</th>
            <th>${this.tableHeaders[5] || 'כיתה'}</th>
            <th>${this.tableHeaders[4] || 'הערה'}</th>
            <th>סטטוס</th>
            <th>פעולות</th>
        `;

        // --- שינוי בסידור הכפתורים והחיפוש ---
        let tableHtml = `
            <div class="view-actions has-search">
                <div class="actions-right">
                    <button id="add-student-btn" class="button button-success"><i class="fas fa-user-plus"></i> הוסף תלמיד חדש</button>
                    <div class="search-wrapper">
                        <input type="text" id="students-search-input" placeholder="חיפוש...">
                        <i class="fas fa-search"></i>
                    </div>
                    <button id="delete-selected-btn" class="button button-danger" style="display: none;"><i class="fas fa-trash"></i> מחק מסומנים</button>
                    <button id="activate-selected-btn" class="button button-success" style="display: none;"><i class="fas fa-user-check"></i> הפעל מסומנים</button>
                    <button id="deactivate-selected-btn" class="button button-archive" style="display: none;"><i class="fas fa-user-slash"></i> השבת מסומנים</button>
                </div>
                <div class="actions-left">
                     <div id="students-summary" class="students-summary-text">
                        סה"כ: <strong>${totalStudents}</strong> | פעילים: <strong>${activeStudents}</strong> | עדכון אחרון: <strong>${fileMTime}</strong>
                    </div>
                </div>
            </div>
            <div id="students-table-container">
                <table class="report-table" id="students-table">
                    <thead>
                        <tr>${headersHtml}</tr>
                    </thead>
                    <tbody>${this.studentsData.map(student => this.createStudentRow(student)).join('')}</tbody>
                </table>
            </div>
        `;
        this.view.innerHTML = tableHtml;
        this.addEventListeners();
    },

    createStudentRow: function(student) {
        const isActive = student.status === '1';
        const statusText = isActive ? 'פעיל' : 'מושבת';
        const statusClass = isActive ? 'correct-answer' : 'wrong-answer';
        const toggleButtonText = isActive ? 'השבת' : 'הפעל';
        const toggleButtonIcon = isActive ? 'fa-user-slash' : 'fa-user-check';
        const toggleButtonClass = isActive ? 'button-archive' : 'button-success';

        return `
            <tr data-student-id="${student.id}">
                <td><input type="checkbox" class="student-checkbox" data-student-id="${student.id}"></td>
                <td>${student.id}</td>
                <td>${student.firstName}</td>
                <td>${student.lastName}</td>
                <td>${student.class}</td>
                <td>${student.note}</td>
                <td class="${statusClass}">${statusText}</td>
                <td class="actions-cell">
                    <button class="button button-primary manage-points-btn edit-student-btn"><i class="fas fa-edit"></i> ערוך</button>
                    <button class="button ${toggleButtonClass} manage-points-btn toggle-status-btn"><i class="fas ${toggleButtonIcon}"></i> ${toggleButtonText}</button>
                    <button class="button button-danger manage-points-btn delete-student-btn"><i class="fas fa-trash"></i> מחק</button>
                </td>
            </tr>
        `;
    },

    addEventListeners: function() {
        // כפתורים ראשיים
        document.getElementById('add-student-btn').addEventListener('click', () => this.showEditModal());
        document.getElementById('delete-selected-btn').addEventListener('click', () => this.deleteSelected());
        document.getElementById('activate-selected-btn').addEventListener('click', () => this.activateSelected());
        document.getElementById('deactivate-selected-btn').addEventListener('click', () => this.deactivateSelected());

        // חיפוש
        document.getElementById('students-search-input').addEventListener('input', (e) => this.filterTable(e.target.value));
        
        // תיבות סימון
        document.getElementById('students-select-all').addEventListener('change', (e) => this.toggleSelectAll(e.target.checked));
        this.view.addEventListener('change', (e) => {
            if (e.target.classList.contains('student-checkbox')) {
                this.updateMultiActionButtons();
            }
        });

        // כפתורי שורה
        this.view.querySelectorAll('.edit-student-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.showEditModal(e.target.closest('tr').dataset.studentId));
        });
        
        this.view.querySelectorAll('.delete-student-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.deleteStudent(e.target.closest('tr').dataset.studentId));
        });

        this.view.querySelectorAll('.toggle-status-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.toggleStudentStatus(e.target.closest('tr').dataset.studentId));
        });
    },
    
    // --- פונקציות לפעולות מרובות ---

    toggleSelectAll: function(isChecked) {
        this.view.querySelectorAll('.student-checkbox').forEach(checkbox => {
            if (checkbox.closest('tr').style.display !== 'none') {
                checkbox.checked = isChecked;
            }
        });
        this.updateMultiActionButtons();
    },

    updateMultiActionButtons: function() {
        const selectedCount = this.view.querySelectorAll('.student-checkbox:checked').length;
        const deleteBtn = document.getElementById('delete-selected-btn');
        const activateBtn = document.getElementById('activate-selected-btn');
        const deactivateBtn = document.getElementById('deactivate-selected-btn');

        if (selectedCount > 0) {
            deleteBtn.style.display = 'inline-flex';
            activateBtn.style.display = 'inline-flex';
            deactivateBtn.style.display = 'inline-flex';
            
            deleteBtn.innerHTML = `<i class="fas fa-trash"></i> מחק ${selectedCount} מסומנים`;
            activateBtn.innerHTML = `<i class="fas fa-user-check"></i> הפעל ${selectedCount} מסומנים`;
            deactivateBtn.innerHTML = `<i class="fas fa-user-slash"></i> השבת ${selectedCount} מסומנים`;
        } else {
            deleteBtn.style.display = 'none';
            activateBtn.style.display = 'none';
            deactivateBtn.style.display = 'none';
        }
    },
    
    getSelectedStudentIds: function() {
        const ids = [];
        this.view.querySelectorAll('.student-checkbox:checked').forEach(checkbox => {
            ids.push(checkbox.dataset.studentId);
        });
        return ids;
    },

    deleteSelected: function() {
        const idsToDelete = this.getSelectedStudentIds();
        if (idsToDelete.length === 0) return;
        
        if (confirm(`האם אתה בטוח שברצונך למחוק לצמיתות ${idsToDelete.length} תלמידים מסומנים?`)) {
            this.studentsData = this.studentsData.filter(s => !idsToDelete.includes(s.id));
            this.saveChangesToServer();
        }
    },

    activateSelected: function() {
        const idsToActivate = this.getSelectedStudentIds();
        if (idsToActivate.length === 0) return;

        if (confirm(`האם אתה בטוח שברצונך להפעיל ${idsToActivate.length} תלמידים מסומנים?`)) {
            this.studentsData.forEach(student => {
                if (idsToActivate.includes(student.id)) {
                    student.status = '1';
                }
            });
            this.saveChangesToServer();
        }
    },
    
    deactivateSelected: function() {
        const idsToDeactivate = this.getSelectedStudentIds();
        if (idsToDeactivate.length === 0) return;

        if (confirm(`האם אתה בטוח שברצונך להשבית ${idsToDeactivate.length} תלמידים מסומנים?`)) {
            this.studentsData.forEach(student => {
                if (idsToDeactivate.includes(student.id)) {
                    student.status = '0';
                }
            });
            this.saveChangesToServer();
        }
    },

    // --- סוף פונקציות לפעולות מרובות ---

    showEditModal: function(studentId = null) {
        const isNew = studentId === null;
        const student = isNew ? { id: '', firstName: '', lastName: '', note: '', class: '', status: '1' } : this.studentsData.find(s => s.id === studentId);
        
        const modalHtml = `
            <div id="student-edit-modal-overlay">
                <div class="modal-container">
                    <div class="modal-header">
                        <h2><i class="fas fa-user-edit"></i> ${isNew ? 'הוספת תלמיד חדש' : 'עריכת פרטי תלמיד'}</h2>
                        <span class="close-btn" title="סגירה">&times;</span>
                    </div>
                    <div class="modal-body">
                        <form id="student-form">
                            <div class="form-group">
                                <label for="student-id">${this.tableHeaders[0] || 'קוד'}</label>
                                <input type="number" id="student-id" value="${student.id}" required>
                            </div>
                            <div class="form-group">
                                <label for="student-firstName">${this.tableHeaders[2] || 'שם פרטי'}</label>
                                <input type="text" id="student-firstName" value="${student.firstName}" required>
                            </div>
                            <div class="form-group">
                                <label for="student-lastName">${this.tableHeaders[3] || 'שם משפחה'}</label>
                                <input type="text" id="student-lastName" value="${student.lastName}">
                            </div>
                            <div class="form-group">
                                <label for="student-class">${this.tableHeaders[5] || 'כיתה'}</label>
                                <input type="text" id="student-class" value="${student.class}" required>
                            </div>
                            <div class="form-group">
                                <label for="student-note">${this.tableHeaders[4] || 'הערה'}</label>
                                <input type="text" id="student-note" value="${student.note}">
                            </div>
                             <div class="form-group">
                                <label>סטטוס</label>
                                <select id="student-status" class="form-control">
                                    <option value="1" ${student.status === '1' ? 'selected' : ''}>פעיל</option>
                                    <option value="0" ${student.status !== '1' ? 'selected' : ''}>מושבת</option>
                                </select>
                            </div>
                            <div id="id-change-warning" class="info-message" style="display: none; font-size: 0.9em; padding: 10px;">
                                <i class="fas fa-exclamation-triangle"></i> <strong>שים לב:</strong> שינוי קוד התלמיד אינו מעביר את הנקודות שצבר לקוד החדש.<br>לצורך העברת הנקודות, יש לפנות ל-S.M.T.
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="submit" form="student-form" class="button button-success"><i class="fas fa-save"></i> שמור שינויים</button>
                    </div>
                </div>
            </div>
        `;
        
        if (document.getElementById('student-edit-modal-overlay')) {
            document.getElementById('student-edit-modal-overlay').remove();
        }
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const overlay = document.getElementById('student-edit-modal-overlay');
        overlay.classList.add('visible');
        
        overlay.querySelector('.close-btn').addEventListener('click', () => overlay.remove());
        
        if (!isNew) {
            document.getElementById('student-id').addEventListener('input', (e) => {
                const warning = document.getElementById('id-change-warning');
                warning.style.display = (e.target.value !== studentId) ? 'block' : 'none';
            });
        }
        
        document.getElementById('student-form').addEventListener('submit', (e) => {
            e.preventDefault();
            if (this.saveStudent(studentId)) {
                overlay.remove();
            }
        });
    },
    
    saveStudent: function(originalId) {
        const isNew = originalId === null;
        const newId = document.getElementById('student-id').value;

        if (!newId) {
            alert('שגיאה: חובה להזין קוד תלמיד.');
            return false;
        }

        const isDuplicate = this.studentsData.some(student => {
            if (!isNew && student.id === originalId) {
                return false;
            }
            return student.id === newId;
        });

        if (isDuplicate) {
            alert(`שגיאה: קוד התלמיד "${newId}" כבר קיים במערכת. יש לבחור קוד ייחודי.`);
            return false;
        }
        
        if (!isNew && newId !== originalId) {
            if (!confirm("שים לב, שינוי קוד התלמיד אינו מעביר את הנקודות שצבר לקוד החדש.\nלצורך העברת הנקודות, יש לפנות ל-S.M.T.\n\nהאם להמשיך בשמירה?")) {
                return false;
            }
        }

        const updatedStudent = {
            id: newId,
            firstName: document.getElementById('student-firstName').value,
            lastName: document.getElementById('student-lastName').value,
            class: document.getElementById('student-class').value,
            note: document.getElementById('student-note').value,
            status: document.getElementById('student-status').value
        };

        if (isNew) {
            this.studentsData.push(updatedStudent);
        } else {
            const index = this.studentsData.findIndex(s => s.id === originalId);
            if (index !== -1) {
                this.studentsData[index] = updatedStudent;
            }
        }
        
        this.saveChangesToServer();
        return true;
    },

    deleteStudent: function(studentId) {
        const student = this.studentsData.find(s => s.id === studentId);
        if (!student) return;
        
        const fullName = `${student.firstName} ${student.lastName}`.trim();
        if (confirm(`האם אתה בטוח שברצונך למחוק לצמיתות את התלמיד "${fullName}" (קוד: ${student.id})?`)) {
            this.studentsData = this.studentsData.filter(s => s.id !== studentId);
            this.saveChangesToServer();
        }
    },
    
    toggleStudentStatus: function(studentId) {
        const index = this.studentsData.findIndex(s => s.id === studentId);
        if (index !== -1) {
            this.studentsData[index].status = this.studentsData[index].status === '1' ? '0' : '1';
            this.saveChangesToServer();
        }
    },

    saveChangesToServer: async function() {
        const headerLine = this.tableHeaders.join(',');
        const newContentLines = [headerLine];
        this.studentsData.forEach(s => {
            const line = [s.id, s.status, s.firstName, s.lastName, s.note, s.class].join(',');
            newContentLines.push(line);
        });

        newContentLines.push('');
        const newContent = newContentLines.join('\n');

        this.view.innerHTML = `<div id="loading"><i class="fas fa-spinner fa-spin"></i> שומר שינויים בשרת...</div>`;

        try {
            const token = auth.getToken();
            const apiUrl = `${auth.API_BASE}/UploadTextFile`;
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ token, what: this.STUDENTS_INI_FILE_PATH, contents: newContent })
            });

            if (!response.ok) throw new Error(`שגיאת רשת (${response.status})`);
            const result = await response.json();
            if (result.responseStatus !== 'OK') {
                 throw new Error(result.message || 'השרת החזיר שגיאה בעת השמירה.');
            }
            
            this.fetchAndDisplayStudents();

        } catch (error) {
            alert(`שגיאה קריטית בשמירת הקובץ: ${error.message}`);
            this.renderStudentsView();
        }
    },
    
    filterTable: function(searchTerm) {
        const table = document.getElementById('students-table');
        if (!table) return;
        const rows = table.querySelectorAll('tbody tr');
        const term = searchTerm.toLowerCase();

        rows.forEach(row => {
            const rowText = row.textContent.toLowerCase();
            row.style.display = rowText.includes(term) ? '' : 'none';
        });

        // בטל סימון "בחר הכל" אם מסננים
        document.getElementById('students-select-all').checked = false;
        // עדכן את כפתורי הפעולה (למקרה שסימונים הוסתרו)
        this.updateMultiActionButtons();
    }
};