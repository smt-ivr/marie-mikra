// ======================================================
//  tzintuk-tasks-controller.js - (גרסה חדשה - 4.1)
//  תיקון קריטי למתג הפעלה/כיבוי (שליחת אובייקט מלא)
//  תיקון קריטי לשמירת טופס (שמירה על סטטוס active)
//  מודאל פרטים משודרג לפי דוגמת השרת
//  עדכון v4.1: הוספת עמודות ריצה (הבאה/אחרונה) ותיקון תצוגת "כל יום"
// ======================================================

const tzintukTasksController = {
    container: null,
    isInitialized: false,
    tasks: [], // ישמור את רשימת המשימות
    daysMap: ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"],

    init: function(container) {
        this.container = container;
        // טען רק אם זו הפעם הראשונה
        if (!this.isInitialized || this.container.innerHTML.trim() === '') {
            this.isInitialized = true;
            this.injectModalHtml(); // הזרק את המודאל לדף
            this.loadTasksView();
        }
    },

    // ========= טעינת התצוגה הראשית =========
    loadTasksView: async function() {
        this.container.innerHTML = `<div id="loading"><i class="fas fa-spinner fa-spin"></i> טוען משימות...</div>`;
        
        try {
            // 1. קבל רשימת משימות בסיסית
            const tasksResult = await tzintukController.apiCall('GetTasks');
            
            // 2. עבור כל משימה, הבא את הנתונים המלאים שלה (כדי לקבל שעה וימים)
            const tasksDataPromises = (tasksResult.tasks || []).map(task => 
                tzintukController.apiCall('GetTasksData', { TaskId: task.id })
            );
            
            this.tasks = await Promise.all(tasksDataPromises);
            
            this.renderTasksTable();
        } catch (error) {
            this.container.innerHTML = `<p class="error-message"><i class="fas fa-exclamation-triangle"></i> ${error.message}</p>`;
        }
    },

    // ========= ★ פונקציה ששונתה ★ =========
    renderTasksTable: function() {
        if (this.tasks.length === 0) {
            this.container.innerHTML = `<p class="info-message" style="padding: 1rem;">לא נמצאו משימות מתוזמנות.</p>`;
            return;
        }

        let tableHtml = `
            <div id="tasks-table-container">
                <table class="report-table" id="tasks-table">
                    <thead>
                        <tr>
                            <th>מזהה</th>
                            <th>תיאור</th>
                            <th>סוג משימה</th>
                            <th>סטטוס ריצה</th>
                            <th>שעת ריצה</th>
                            <th>ימי ריצה</th>
                            <th>ריצה הבאה</th> <th>ריצה אחרונה</th> <th>הפעלה/כיבוי</th>
                            <th>פעולות</th>
                        </tr>
                    </thead>
                    <tbody>`;
        
        this.tasks.forEach(task => {
            const status = this.translateStatus(task.status);
            const timeStr = `${String(task.hour || '0').padStart(2, '0')}:${String(task.minute || '0').padStart(2, '0')}`;
            
            // --- שימוש בפונקציה המתוקנת ---
            const daysStr = this.formatDaysForDisplay(task.days_of_week, task.ifAnyDay);
            
            // --- שינוי: החלפת N/A ב"לא מוגדר" ---
            const nextRunDisplay = task.nextRun || 'לא מוגדר';
            const lastRunDisplay = task.lastRun || 'לא מוגדר';
            
            tableHtml += `
                <tr data-task-id="${task.id}">
                    <td>${task.id}</td>
                    <td>${task.description}</td>
                    <td>${this.translateType(task.type)}</td>
                    <td class="status-${task.status}">${status}</td>
                    <td dir="ltr">${timeStr}</td>
                    <td>${daysStr}</td>
                    
                    <td ${task.nextRun ? 'dir="ltr"' : ''}>${nextRunDisplay}</td> 
                    <td ${task.lastRun ? 'dir="ltr"' : ''}>${lastRunDisplay}</td> 

                    <td>
                        <label class="toggle-switch">
                            <input type="checkbox" class="task-toggle-active" data-task-id="${task.id}" ${task.active ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                    </td>
                    <td class="actions-cell">
                        <button class="button button-browse button-small view-details-btn" title="פרטים נוספים"><i class="fas fa-eye"></i></button>
                        <button class="button button-primary button-small edit-task-btn" title="ערוך"><i class="fas fa-edit"></i></button>
                        <button class="button button-info button-small view-log-btn" title="צפה ביומן"><i class="fas fa-history"></i></button>
                    </td>
                </tr>
            `;
        });
        
        tableHtml += `</tbody></table></div>`;
        this.container.innerHTML = tableHtml;
        this.addTableEventListeners();
    },

    addTableEventListeners: function() {
        this.container.querySelectorAll('.view-details-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const taskId = e.target.closest('tr').dataset.taskId;
                this.showDetailsModal(taskId);
            });
        });
        
        this.container.querySelectorAll('.edit-task-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const taskId = e.target.closest('tr').dataset.taskId;
                this.showEditModal(taskId);
            });
        });
        
        this.container.querySelectorAll('.view-log-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const taskId = e.target.closest('tr').dataset.taskId;
                this.showLogModal(taskId);
            });
        });

        this.container.querySelectorAll('.task-toggle-active').forEach(toggle => {
            toggle.addEventListener('change', (e) => {
                const taskId = e.target.dataset.taskId;
                const isActive = e.target.checked;
                this.handleToggleActive(taskId, isActive, e.target);
            });
        });
    },
    
    // ========= הפעלה וכיבוי מהיר (תיקון קריטי v4.0) =========
    handleToggleActive: async function(taskId, isActive, toggleElement) {
        toggleElement.disabled = true;
        try {
            // 1. שלוף את כל נתוני המשימה הקיימים מהמטמון (tasks)
            //    אנו משתמשים ב-tasks ולא ב-API כדי לחסוך קריאה, כי כבר יש לנו את הכל
            const details = this.tasks.find(t => t.id == taskId);
            if (!details) {
                throw new Error("לא נמצאו פרטי המשימה המלאים.");
            }

            // 2. צור אובייקט פרמטרים מלא
            const params = {
                TaskId: taskId,
                description: details.description,
                hour: details.hour,
                minute: details.minute,
                year: details.year,
                day: details.day,
                month: details.month,
                mailInEnd: details.sendMailInEnd ? 1 : 0,
                mailInError: details.sendMailInError ? 1 : 0,
                ifAnyDay: details.ifAnyDay ? 1 : 0,
                days: this.formatDaysForApi(details.days_of_week, details.ifAnyDay),
                
                // 3. שנה *רק* את הסטטוס הפעיל
                active: isActive ? 1 : 0
            };

            // 4. שלח את האובייקט המלא לעדכון
            await tzintukController.apiCall('UpdateTask', params);
            
            // 5. עדכן את הנתונים הפנימיים
            details.active = isActive;
            
            // 6. *** תיקון רענון ***
            // טען מחדש את הטבלה כדי להציג נתונים מעודכנים מהשרת (כמו nextRun)
            await this.loadTasksView();

        } catch (error) {
            alert(`שגיאה בעדכון סטטוס המשימה: ${error.message}`);
            // 7. החזר את המתג למצב הקודם במקרה של שגיאה
            toggleElement.checked = !isActive;
        } finally {
            // המתג יופעל מחדש אוטומטית בעת טעינת הטבלה
        }
    },

    // ========= חלון עריכה נקי =========
    showEditModal: async function(taskId) {
        const modal = document.getElementById('tasks-edit-modal-overlay');
        const form = document.getElementById('task-modal-form');
        form.reset(); // איפוס הטופס
        modal.dataset.taskId = taskId;
        
        try {
            // הצג טעינה בתוך המודאל
            modal.querySelector('.modal-body').classList.add('loading');
            modal.classList.add('visible');
            
            const details = this.tasks.find(t => t.id == taskId);
            if (!details) {
                 throw new Error("לא נמצאו פרטי המשימה המלאים.");
            }
            
            // מילוי הטופס
            document.getElementById('task-modal-title').innerHTML = `<i class="fas fa-edit"></i> עריכת משימה: ${details.description}`;
            document.getElementById('task-description').value = details.description;
            
            // המרת שעה ודקה לפורמט HH:mm
            const timeStr = `${String(details.hour || '0').padStart(2, '0')}:${String(details.minute || '0').padStart(2, '0')}`;
            document.getElementById('task-time').value = timeStr;
            
            document.getElementById('task-mailInEnd').checked = details.sendMailInEnd;
            document.getElementById('task-mailInError').checked = details.sendMailInError;

            // טיפול בימים
            const days = details.days_of_week ? details.days_of_week.split(',') : [];
            
            // --- שינוי לוגיקה קטן בחישוב ifAnyDay ---
            let ifAnyDay;
            if (details.ifAnyDay !== undefined && details.ifAnyDay !== null) {
                ifAnyDay = details.ifAnyDay; // השתמש בערך הקיים אם יש
            } else {
                // אם אין ערך, חשב לפי המצב הישן
                ifAnyDay = (days.length === 0 || days.length === 7);
            }
            
            document.getElementById('task-ifAnyDay').checked = ifAnyDay;
            document.querySelectorAll('.day-picker-container input').forEach(input => {
                input.checked = !ifAnyDay && days.includes(input.value);
                input.disabled = ifAnyDay;
            });
            document.querySelector('.day-picker-container').style.opacity = ifAnyDay ? 0.5 : 1;

            modal.querySelector('.modal-body').classList.remove('loading');

        } catch (error) {
            alert(`שגיאה בטעינת נתוני המשימה: ${error.message}`);
            this.hideEditModal();
        }
    },

    hideEditModal: function() {
        document.getElementById('tasks-edit-modal-overlay').classList.remove('visible');
    },

    handleFormSubmit: async function() {
        const saveBtn = document.getElementById('task-modal-save-btn');
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> שומר...';

        const taskId = document.getElementById('tasks-edit-modal-overlay').dataset.taskId;
        
        // *** תיקון קריטי v4.0 ***
        // קבל את הסטטוס "פעיל" הנוכחי מהמטמון
        const currentTask = this.tasks.find(t => t.id == taskId);
        const currentActiveStatus = currentTask ? currentTask.active : 1; // ברירת מחדל ל-1 (פעיל)
        
        // המרת שדה הזמן חזרה לשעה ודקה
        const timeValue = document.getElementById('task-time').value;
        const [hour, minute] = timeValue.split(':');

        // איסוף נתונים
        const params = {
            TaskId: taskId,
            description: document.getElementById('task-description').value,
            hour: parseInt(hour, 10),
            minute: parseInt(minute, 10),
            mailInEnd: document.getElementById('task-mailInEnd').checked ? 1 : 0,
            mailInError: document.getElementById('task-mailInError').checked ? 1 : 0,
            ifAnyDay: document.getElementById('task-ifAnyDay').checked ? 1 : 0,
            active: currentActiveStatus, // הוספת הסטטוס הפעיל הקיים
        };
        
        // איסוף ימים
        if (params.ifAnyDay == 0) {
            const daysObj = {};
            document.querySelectorAll('.day-picker-container input').forEach(input => {
                daysObj[input.value] = input.checked ? 1 : 0;
            });
            params.days = JSON.stringify(daysObj);
        }

        try {
            await tzintukController.apiCall('UpdateTask', params);
            alert('המשימה עודכנה בהצלחה!');
            this.hideEditModal();
            
            // *** תיקון רענון ***
            await this.loadTasksView(); // טען מחדש את כל הרשימה

        } catch (error) {
            alert(`שגיאה בשמירת המשימה: ${error.message}`);
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-save"></i> שמור שינויים';
        }
    },
    
    // ========= חלון פרטים (חדש v4.0) =========
    showDetailsModal: async function(taskId) {
        const modal = document.getElementById('tasks-details-modal-overlay');
        const body = modal.querySelector('.modal-body');
        const task = this.tasks.find(t => t.id == taskId);
        
        modal.querySelector('#task-details-modal-title').textContent = `פרטי משימה: ${task.description}`;
        body.innerHTML = `<div id="loading"><i class="fas fa-spinner fa-spin"></i> טוען פרטים...</div>`;
        modal.classList.add('visible');

        try {
            // אנו משתמשים ב-task (מהמטמון) שכבר מכיל את כל הנתונים
            const details = task;
            const actionData = JSON.parse(details.action_data || '{}');
            const timeStr = `${String(details.hour || '0').padStart(2, '0')}:${String(details.minute || '0').padStart(2, '0')}`;
            
            // --- שימוש בפונקציה המתוקנת ---
            const daysStr = this.formatDaysForDisplay(details.days_of_week, details.ifAnyDay);

            let actionHtml = '';
            switch(details.type) {
                case 'RunTzintuk':
                    actionHtml = `
                        <div class="details-item"><strong>זיהוי יוצא:</strong> <span dir="ltr">${actionData.FROM || 'N/A'}</span></div>
                        <div class="details-item"><strong>מזהה רשימה:</strong> <span>${actionData.LIST || 'N/A'}</span></div>
                        <div class="details-item"><strong>סוג רשימה:</strong> <span>${this.translateListType(actionData.MODE)} (${actionData.MODE || 'N/A'})</span></div>
                    `;
                    break;
                case 'SendSMS':
                    actionHtml = `
                        <div class="details-item"><strong>זיהוי יוצא:</strong> <span dir="ltr">${actionData.FROM || 'N/A'}</span></div>
                        <div class="details-item"><strong>מזהה רשימת תפוצה:</strong> <span>${actionData.LIST || 'N/A'}</span></div>
                        <div class="details-item full"><strong>תוכן ההודעה:</strong> <pre>${actionData.MESSAGE || 'N/A'}</pre></div>
                    `;
                    break;
                case 'MoveOnFile':
                     actionHtml = `
                        <div class="details-item"><strong>תיקיית מקור:</strong> <span dir="ltr">${actionData.FOLDER || 'N/A'}</span></div>
                        <div class="details-item"><strong>תיקיית יעד:</strong> <span dir="ltr">${actionData.TARGET || 'N/A'}</span></div>
                        <div class="details-item"><strong>סוג קובץ:</strong> <span>${actionData.TYPE || 'N/A'}</span></div>
                    `;
                    break;
                default:
                    actionHtml = `<div class="details-item full"><strong>מידע גולמי:</strong> <pre>${JSON.stringify(actionData, null, 2)}</pre></div>`;
            }

            body.innerHTML = `
                <h4>פרטים כלליים</h4>
                <div class="details-list">
                    <div class="details-item"><strong>מזהה:</strong> <span>${details.id}</span></div>
                    <div class="details-item"><strong>סוג:</strong> <span>${this.translateType(details.type)}</span></div>
                    <div class="details-item"><strong>סטטוס ריצה:</strong> <span class="status-${details.status}">${this.translateStatus(details.status)}</span></div>
                    <div class="details-item"><strong>פעילה:</strong> <span>${details.active ? 'כן' : 'לא'}</span></div>
                    <div class="details-item"><strong>שעת ריצה:</strong> <span dir="ltr">${timeStr}</span></div>
                    <div class="details-item"><strong>ימי ריצה:</strong> <span>${daysStr}</span></div>
                    <div class="details-item"><strong>ריצה הבאה:</strong> <span dir="ltr">${details.nextRun || 'לא מוגדר'}</span></div>
                    <div class="details-item"><strong>ריצה אחרונה:</strong> <span dir="ltr">${details.lastRun || 'לא מוגדר'}</span></div>
                    <div class="details-item"><strong>נוצר בתאריך:</strong> <span dir="ltr">${details.createTs}</span></div>
                    <div class="details-item"><strong>עודכן לאחרונה:</strong> <span dir="ltr">${details.updateTs}</span></div>
                    <div class="details-item"><strong>נוצר מ-IP:</strong> <span dir="ltr">${details.createBy || 'לא ידוע'}</span></div>
                    <div class="details-item"><strong>מונע ריצה בשבת:</strong> <span>${details.check_is_kodesh ? 'כן' : 'לא'}</span></div>
                    <div class="details-item"><strong>שליחת מייל בסיום:</strong> <span>${details.sendMailInEnd ? 'כן' : 'לא'}</span></div>
                    <div class="details-item"><strong>שליחת מייל בשגיאה:</strong> <span>${details.sendMailInError ? 'כן' : 'לא'}</span></div>
                </div>
                <h4>פרטי ${this.translateType(details.type)}</h4>
                <div class="details-list">
                    ${actionHtml}
                </div>
            `;
        } catch (error) {
            body.innerHTML = `<p class="error-message">${error.message}</p>`;
        }
    },
    
    hideDetailsModal: function() {
        document.getElementById('tasks-details-modal-overlay').classList.remove('visible');
    },

    // ========= חלון יומן ריצה =========
    showLogModal: async function(taskId) {
        const modal = document.getElementById('tasks-log-modal-overlay');
        const body = modal.querySelector('.modal-body');
        const task = this.tasks.find(t => t.id == taskId);
        
        modal.querySelector('#task-log-modal-title').textContent = `יומן ריצה: ${task.description}`;
        body.innerHTML = `<div id="loading"><i class="fas fa-spinner fa-spin"></i> טוען יומן ריצה...</div>`;
        modal.classList.add('visible');

        try {
            const logResult = await tzintukController.apiCall('GetTasksLogs', { TaskId: taskId });
            const logs = logResult.logs || [];
            
            if (logs.length === 0) {
                body.innerHTML = `<p class="info-message">לא נמצאו רישומי יומן עבור משימה זו.</p>`;
                return;
            }

            let tableHtml = '<table class="report-table"><thead><tr><th>מזהה ריצה</th><th>זמן</th><th>הצלחה</th><th>פירוט</th></tr></thead><tbody>';
            logs.forEach(log => {
                const successText = log.succeeded ? 'הצלחה' : 'כישלון';
                const successClass = log.succeeded ? 'correct-answer' : 'wrong-answer';
                tableHtml += `
                    <tr>
                        <td>${log.id}</td>
                        <td dir="ltr">${log.ts}</td>
                        <td class="${successClass}">${successText}</td>
                        <td class="log-error-message">${log.error_message || ''}</td>
                    </tr>
                `;
            });
            tableHtml += '</tbody></table>';
            body.innerHTML = tableHtml;

        } catch (error) {
            body.innerHTML = `<p class="error-message">${error.message}</p>`;
        }
    },

    hideLogModal: function() {
        document.getElementById('tasks-log-modal-overlay').classList.remove('visible');
    },

    // ========= הזרקת HTML למודאלים =========
    injectModalHtml: function() {
        // מזרק רק פעם אחת
        if (document.getElementById('tasks-edit-modal-overlay')) return;

        const daysHtml = this.daysMap.map((day, index) => `
            <div class="day-toggle">
                <input type="checkbox" id="task-day-${index}" value="${index}">
                <label for="task-day-${index}">${day}</label>
            </div>
        `).join('');

        // --- מודאל עריכה ---
        const editModalHtml = `
            <div id="tasks-edit-modal-overlay" class="tasks-modal-overlay-class">
                <div class="modal-container" style="max-width: 550px;">
                    <div class="modal-header">
                        <h2 id="task-modal-title"><i class="fas fa-edit"></i> עריכת משימה</h2>
                        <span class="close-btn" title="סגירה">&times;</span>
                    </div>
                    <form id="task-modal-form">
                        <div class="modal-body">
                            <div class="form-group">
                                <label for="task-description">תיאור המשימה</label>
                                <input type="text" id="task-description" required>
                            </div>
                            
                            <div class="form-group">
                                <label for="task-time">שעת ריצה</label>
                                <input type="time" id="task-time" class="form-control" required style="direction: ltr;">
                            </div>
                            
                            <div class="form-group">
                                <label>ימים לריצה</label>
                                <div class="day-picker-container">${daysHtml}</div>
                                <div class="form-group-inline" style="margin-top: 10px;">
                                    <input type="checkbox" id="task-ifAnyDay">
                                    <label for="task-ifAnyDay">בחר את כל הימים</label>
                                </div>
                            </div>
                            
                            <div class="form-grid">
                                <div class="form-group-inline">
                                    <input type="checkbox" id="task-mailInEnd">
                                    <label for="task-mailInEnd">מייל בכל הצלחה</label>
                                </div>
                                <div class="form-group-inline">
                                    <input type="checkbox" id="task-mailInError">
                                    <label for="task-mailInError">מייל בכל כישלון</label>
                                </div>
                            </div>

                        </div>
                        <div class="modal-footer">
                            <button type="submit" id="task-modal-save-btn" class="button button-success"><i class="fas fa-save"></i> שמור שינויים</button>
                        </div>
                    </form>
                </div>
            </div>`;
        
        // --- מודאל יומן ---כ
        const logModalHtml = `
            <div id="tasks-log-modal-overlay" class="tasks-modal-overlay-class">
                <div class="modal-container large">
                     <div class="modal-header">
                        <h2 id="task-log-modal-title"><i class="fas fa-history"></i> יומן ריצה</h2>
                        <span class="close-btn" title="סגירה">&times;</span>
                    </div>
                    <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
                    </div>
                </div>
            </div>
        `;
        
        // --- מודאל פרטים (חדש) ---
        const detailsModalHtml = `
            <div id="tasks-details-modal-overlay" class="tasks-modal-overlay-class">
                <div class="modal-container" style="max-width: 650px;">
                     <div class="modal-header">
                        <h2 id="task-details-modal-title"><i class="fas fa-info-circle"></i> פרטי משימה</h2>
                        <span class="close-btn" title="סגירה">&times;</span>
                    </div>
                    <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', editModalHtml);
        document.body.insertAdjacentHTML('beforeend', logModalHtml);
        document.body.insertAdjacentHTML('beforeend', detailsModalHtml);
        
        // הוספת מאזינים למודאלים
        document.getElementById('tasks-edit-modal-overlay').querySelector('.close-btn').addEventListener('click', () => this.hideEditModal());
        document.getElementById('task-modal-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleFormSubmit();
        });
        
        document.getElementById('tasks-log-modal-overlay').querySelector('.close-btn').addEventListener('click', () => this.hideLogModal());
        document.getElementById('tasks-details-modal-overlay').querySelector('.close-btn').addEventListener('click', () => this.hideDetailsModal());

        // מאזין ל-ifAnyDay כדי להשבית/להפעיל את בורר הימים
        document.getElementById('task-ifAnyDay').addEventListener('change', (e) => {
            document.querySelector('.day-picker-container').style.opacity = e.target.checked ? 0.5 : 1;
            document.querySelectorAll('.day-picker-container input').forEach(input => input.disabled = e.target.checked);
        });
    },


    // ========= פונקציות עזר ותרגום =========
    translateStatus: (status) => {
        const statuses = {
            'PENDING': 'ממתין',
            'RUNNING': 'בתהליך ריצה',
            'DONE': 'הסתיים',
            'ERROR': 'שגיאה',
            'NOT_ACTIVE': 'לא פעיל',
        };
        return statuses[status] || status;
    },
    
    translateType: (type) => {
        const types = {
            'RunTzintuk': 'צינתוק',
            'SendSMS': 'שליחת SMS',
            'MoveOnFile': 'העברת קובץ'
        };
        return types[type] || type;
    },
    
    translateListType: (type) => {
        const types = {
            'tzl': 'צינתוקים חינמיים',
            'tpl': 'רשימת תפוצה'
        };
        // התיקון מהדוגמה שלך: MODE יכול להיות tzl
        return types[type] || type || 'לא מוגדר';
    },

    // ========= ★ פונקציה ששונתה ★ =========
    formatDaysForDisplay: function(daysString, ifAnyDay) {
        // שכפול לוגיקה מחלון העריכה להתמודדות עם ערכים חסרים
        const days = daysString ? daysString.split(',') : [];
        
        // חישוב ברירת מחדל אם ifAnyDay חסר
        // ירוץ אם: (הימים ריקים *וגם* ifAnyDay הוא לא 0 מפורש) או (יש 7 ימים)
        let calculatedIfAnyDay = (days.length === 0 && (ifAnyDay === undefined || ifAnyDay === null || ifAnyDay === 1)) || days.length === 7;
        
        // תן עדיפות לערך ifAnyDay שהגיע מהשרת, אם הוא קיים
        const effectiveIfAnyDay = (ifAnyDay !== undefined && ifAnyDay !== null) ? ifAnyDay : calculatedIfAnyDay;

        if (effectiveIfAnyDay) return "כל יום";

        // אם זה לא "כל יום", אבל עדיין אין ימים (למשל ifAnyDay: 0 ו-days: null)
        if (days.length === 0) return "לא מוגדר";
        
        // מיון הימים לפי סדר השבוע
        const sortedDays = days.map(Number).sort((a, b) => a - b);
        return sortedDays.map(d => this.daysMap[d]).join(', ');
    },
    
    formatDaysForApi: function(daysString, ifAnyDay) {
        // אם זה 'כל יום' (ifAnyDay=1), ה-API מצפה ל-null או לא לשלוח את השדה
        if (ifAnyDay) return null;
        
        const days = daysString ? daysString.split(',') : [];
        const daysObj = {};
        for (let i = 0; i < 7; i++) {
            daysObj[i] = days.includes(String(i)) ? 1 : 0;
        }
        return JSON.stringify(daysObj);
    }
};