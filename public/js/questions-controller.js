// ======================================================
//  questions-controller.js - ניהול תצוגת שאלות מבחן
// ======================================================

const questionsController = {
    // רכיבי ה-DOM של המודאל
    modalOverlay: null,
    closeBtn: null,
    modalTitle: null,
    modalBody: null,
    
    // אתחול המודול (נקרא פעם אחת בטעינת האפליקציה)
    initialize: function() {
        this.injectModalHtml();
        this.modalOverlay = document.getElementById('questions-modal-overlay');
        this.closeBtn = this.modalOverlay.querySelector('.close-btn');
        this.modalTitle = this.modalOverlay.querySelector('#questions-modal-title');
        this.modalBody = this.modalOverlay.querySelector('.modal-body');

        this.closeBtn.addEventListener('click', () => this.hide());
        
        // הוספת מאזין גלובלי למודאל שיטפל בעצירת קבצים אחרים
        this.modalBody.addEventListener('play', (event) => {
            // ודא שהאירוע מגיע מתגית audio
            if (event.target.tagName === 'AUDIO') {
                const allPlayers = this.modalBody.querySelectorAll('audio');
                allPlayers.forEach(player => {
                    // אם הנגן הוא לא זה שהפעיל את האירוע והוא לא מושהה
                    if (player !== event.target && !player.paused) {
                        player.pause();
                    }
                });
            }
        }, true); // שימוש ב-Capture Phase מבטיח שהאירוע יתפס תמיד
    },

    // פונקציה להצגת המודאל
    show: function() {
        this.modalOverlay.classList.add('visible');
    },

    // פונקציה להסתרת המודאל
    hide: function() {
        // לפני הסתרת המודאל, עצור את כל נגני האודיו
        const allPlayers = this.modalBody.querySelectorAll('audio');
        allPlayers.forEach(player => player.pause());
        this.modalOverlay.classList.remove('visible');
    },

    // הפונקציה המרכזית שמקבלת נתיב למבחן ומציגה את השאלות
    displayTestQuestions: async function(testFilePath, testTitle) {
        this.modalTitle.textContent = `שאלות עבור: ${testTitle}`;
        this.modalBody.innerHTML = `<div id="loading"><i class="fas fa-spinner fa-spin"></i> טוען שאלות...</div>`;
        this.show();

        try {
            const folderPath = testFilePath.substring(0, testFilePath.lastIndexOf('/'));
            const dirContent = await this.fetchDirectoryData(folderPath);

            const questionDirs = dirContent.dirs.filter(dir => {
                return /^\d{3}$/.test(dir.name) && dir.name !== '000';
            }).sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10));

            if (questionDirs.length === 0) {
                throw new Error("לא נמצאו תיקיות שאלות במבחן זה.");
            }

            const questionsData = await Promise.all(questionDirs.map(async (dir) => {
                const questionContent = await this.fetchDirectoryData(dir.what);
                const files = questionContent.files.reduce((acc, file) => {
                    const name = file.name.split('.')[0];
                    acc[name] = file.what;
                    return acc;
                }, {});
                return { name: dir.name, files: files };
            }));
            
            this.renderQuestions(questionsData);

        } catch (error) {
            let errorMessage = error.message;
            if (errorMessage.includes('Invalid path')) {
                errorMessage = "לא נמצאו תיקיות שאלות במבחן זה.";
            }
            this.modalBody.innerHTML = `<p class="error-message"><i class="fas fa-exclamation-triangle"></i> ${errorMessage}</p>`;
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

    renderQuestions: function(questions) {
        let html = '<div class="questions-container">';
        questions.forEach(q => {
            html += `
                <div class="question-card">
                    <h3>שאלה ${parseInt(q.name, 10)}</h3>
                    <div class="audio-item">
                        <span><i class="fas fa-question-circle"></i> שאלה:</span>
                        ${this.createAudioPlayer(q.files.Q)}
                    </div>
                    <div class="audio-item correct-answer">
                        <span><i class="fas fa-check-circle"></i> תשובה נכונה (A):</span>
                        ${this.createAudioPlayer(q.files.A)}
                    </div>
                    ${q.files.B ? `<div class="audio-item distractor"><span><i class="fas fa-times-circle"></i> מסיח 1 (B):</span> ${this.createAudioPlayer(q.files.B)}</div>` : ''}
                    ${q.files.C ? `<div class="audio-item distractor"><span><i class="fas fa-times-circle"></i> מסיח 2 (C):</span> ${this.createAudioPlayer(q.files.C)}</div>` : ''}
                    ${q.files.D ? `<div class="audio-item distractor"><span><i class="fas fa-times-circle"></i> מסיח 3 (D):</span> ${this.createAudioPlayer(q.files.D)}</div>` : ''}
                </div>
            `;
        });
        html += '</div>';
        this.modalBody.innerHTML = html;
    },

    createAudioPlayer: function(filePath) {
        if (!filePath) return '<span class="no-audio">אין קובץ</span>';
        const token = auth.getToken();
        const url = `${auth.API_BASE}/DownloadFile?token=${token}&path=${encodeURIComponent(filePath)}`;
        return `<audio controls src="${url}"></audio>`;
    },
    
    injectModalHtml: function() {
        const modalHtml = `
            <div id="questions-modal-overlay">
                <div class="modal-container large">
                    <div class="modal-header">
                        <h2 id="questions-modal-title"><i class="fas fa-list-ol"></i> שאלות המבחן</h2>
                        <span class="close-btn" title="סגירה">&times;</span>
                    </div>
                    <div class="modal-body">
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
};