// ======================================================
//  announcements-reply-controller.js - ניהול תגובות להודעות (שליחת SMS)
//  (גרסה 4 - תיקון לוג, טוסט, תרגום סטטוסים)
// ======================================================

const announcementsReplyController = {
    // --- הגדרות ---
    TARGET_PHONE_NUMBER: '0587008410', // <-- שנה כאן את מספר הטלפון במידת הצורך
    SMS_REPLY_PREFIX: 'הודעה ממשק מארי מקרא תגובה על הודעה', // מזהה לסינון היומן
    // === שונה: רק אמוג'ים בשורה אחת ===
    EMOJI_LIST: ['👍', '😊', '🙏', '❤️', '🎉', '👏', '✅', '👌'],

    // --- אתחול ---
    init: function() {
        this.injectModalHtml();
        this.addEventListeners();
    },

    // ===================================
    //  #region הזרקת HTML ואירועים
    // ===================================

    injectModalHtml: function() {
        // === שונה: נוסף בורר אמוג'ים ===
        const emojiPickerHtml = this.EMOJI_LIST.map(emoji => 
            `<button class="emoji-btn">${emoji}</button>`
        ).join('');

        const replyModalHtml = `
            <div id="announcement-reply-modal" class="reply-modal-overlay">
                <div class="modal-container" style="max-width: 500px;">
                    <div class="modal-header">
                        <h2 id="reply-modal-title"><i class="fas fa-reply"></i> שליחת תגובה</h2>
                        <span class="close-btn" title="סגירה">&times;</span>
                    </div>
                    <div class="modal-body">
                        <p id="reply-modal-desc">התגובה תישלח למנהל המערכת.</p>
                        
                        <div id="reply-emoji-picker" class="emoji-picker-container">
                            ${emojiPickerHtml}
                        </div>
                        
                        <textarea id="reply-modal-textarea" placeholder="הקלד את תגובתך כאן..."></textarea>
                    </div>
                    <div class="modal-footer">
                        <button id="reply-modal-send-btn" class="button button-success"><i class="fas fa-paper-plane"></i> שלח תגובה</button>
                    </div>
                </div>
            </div>`;

        const logModalHtml = `
            <div id="announcement-log-modal" class="reply-modal-overlay">
                <div class="modal-container large">
                    <div class="modal-header">
                        <h2><i class="fas fa-history"></i> יומן תגובות שנשלחו</h2>
                        <span class="close-btn" title="סגירה">&times;</span>
                    </div>
                    <div id="reply-log-container" class="modal-body" style="max-height: 70vh; overflow-y: auto;">
                        <div id="loading"><i class="fas fa-spinner fa-spin"></i> טוען יומן...</div>
                    </div>
                </div>
            </div>`;
        
        document.body.insertAdjacentHTML('beforeend', replyModalHtml);
        document.body.insertAdjacentHTML('beforeend', logModalHtml);
    },

    addEventListeners: function() {
        // מאזינים לסגירת המודאלים
        document.getElementById('announcement-reply-modal').querySelector('.close-btn').addEventListener('click', () => this.hideReplyModal());
        document.getElementById('announcement-log-modal').querySelector('.close-btn').addEventListener('click', () => this.hideLogModal());

        // מאזין לכפתור השליחה
        document.getElementById('reply-modal-send-btn').addEventListener('click', () => this.sendReply());

        // === נוסף: מאזין לבורר האמוג'ים ===
        document.getElementById('reply-emoji-picker').addEventListener('click', (e) => {
            if (e.target.classList.contains('emoji-btn')) {
                const textarea = document.getElementById('reply-modal-textarea');
                const emoji = e.target.textContent;
                // הוסף רווח אם התיבה לא ריקה
                const prefix = textarea.value.length > 0 ? ' ' : '';
                textarea.value += prefix + emoji;
                textarea.focus();
            }
        });
    },

    // ===================================
    //  #region לוגיקת שליחת תגובה (SMS)
    // ===================================

    showReplyModal: function(messageId, messageTitle) {
        const modal = document.getElementById('announcement-reply-modal');
        modal.querySelector('#reply-modal-title').innerHTML = `<i class="fas fa-reply"></i> תגובה להודעה #${messageId}`;
        
        // === שונה: שימוש ב-textContent כדי למנוע בעיות HTML בכותרת ===
        const descEl = modal.querySelector('#reply-modal-desc');
        descEl.textContent = `נושא: ${messageTitle || 'ללא נושא'}`; 

        modal.querySelector('#reply-modal-textarea').value = '';
        
        // שמירת הנתונים על המודאל עצמו
        modal.dataset.messageId = messageId;
        modal.dataset.messageTitle = messageTitle;
        
        modal.classList.add('visible');
        setTimeout(() => modal.querySelector('#reply-modal-textarea').focus(), 100);
    },

    hideReplyModal: function() {
        // שחזור כפתור למקרה שנסגר לפני סיום האנימציה
        const sendBtn = document.getElementById('reply-modal-send-btn');
        sendBtn.disabled = false;
        sendBtn.classList.remove('button-success-temp');
        sendBtn.classList.add('button-success');
        sendBtn.innerHTML = `<i class="fas fa-paper-plane"></i> שלח תגובה`;
        
        document.getElementById('announcement-reply-modal').classList.remove('visible');
    },

    sendReply: async function() {
        const modal = document.getElementById('announcement-reply-modal');
        const sendBtn = document.getElementById('reply-modal-send-btn');
        const textarea = document.getElementById('reply-modal-textarea');

        const messageId = modal.dataset.messageId;
        const messageTitle = modal.dataset.messageTitle || 'ללא נושא';
        const userText = textarea.value.trim();

        if (userText === '') {
            textarea.focus();
            return;
        }

        // === שונה: פורמט ההודעה החדש ללא סוגריים ונקודתיים ===
        const fullMessage = `${this.SMS_REPLY_PREFIX} מספר ${messageId} נושא ${messageTitle} תוכן ההודעה \n${userText}`;

        const originalBtnHtml = sendBtn.innerHTML;
        sendBtn.disabled = true;
        sendBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> שולח...`;

        try {
            const result = await this.apiSendSms(fullMessage, this.TARGET_PHONE_NUMBER);
            if (result.responseStatus === 'OK' && result.sendCount > 0) {
                
                // === שונה: שימוש ב-Toast במקום alert ===
                if (typeof app !== 'undefined' && app.showToastMessage) {
                    app.showToastMessage('התגובה נשלחה בהצלחה!');
                }
                this.hideReplyModal(); // סגור חלון מיידית
                
            } else {
                 throw new Error(result.errors ? JSON.stringify(result.errors) : (result.message || 'שגיאה בשליחת ה-SMS.'));
            }
        } catch (error) {
            alert(`שגיאה בשליחת התגובה: ${error.message}`);
            sendBtn.disabled = false; // החזר כפתור רק במקרה של שגיאה
            sendBtn.innerHTML = originalBtnHtml;
        }
    },

    apiSendSms: async function(message, phone) {
        const token = auth.getToken();
        if (!token) throw new Error("לא נמצא טוקן.");

        const params = new URLSearchParams({
            token: token,
            from: '', // ישתמש בברירת המחדל של המערכת
            message: message,
            phones: phone
        });

        const apiUrl = `${auth.API_BASE}/SendSms?${params.toString()}`;
        
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`שגיאת רשת (${response.status})`);
        return await response.json();
    },

    // ===================================
    //  #region לוגיקת יומן תגובות
    // ===================================

    showLogModal: async function() {
        const modal = document.getElementById('announcement-log-modal');
        const container = document.getElementById('reply-log-container');
        container.innerHTML = `<div id="loading"><i class="fas fa-spinner fa-spin"></i> טוען יומן...</div>`;
        modal.classList.add('visible');

        try {
            const result = await this.apiGetLog();
            if (result.responseStatus !== 'OK') throw new Error(result.message || 'שגיאה בקבלת היומן');
            
            this.renderLog(result.rows || []);
        } catch (error) {
            container.innerHTML = `<p class="error-message">${error.message}</p>`;
        }
    },

    hideLogModal: function() {
        document.getElementById('announcement-log-modal').classList.remove('visible');
    },

    apiGetLog: async function() {
        const token = auth.getToken();
        if (!token) throw new Error("לא נמצא טוקן.");
        
        const params = new URLSearchParams({ token: token, limit: 100 }); // הגבלה ל-100 אחרונים
        const apiUrl = `${auth.API_BASE}/GetSmsOutLog?${params.toString()}`;
        
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`שגיאת רשת (${response.status})`);
        return await response.json();
    },

    // === נוסף: פונקציית תרגום סטטוסים ===
    translateDeliveryStatus: function(status) {
        const translations = {
            'DELIVRD': 'נמסר',
            'ESME_ROK': 'הועבר לשליחה',
            'EXPIRED': 'פג תוקף',
            'ESME_RINVDSTADR': 'יעד לא תקין',
            'ESME_RINVMSGLEN': 'אורך שגוי',
            'ESME_RMSGQFUL': 'תור מלא',
            'ESME_RINVNUMDESTS': 'יעד לא חוקי',
            'null': 'ממתין לדיווח',
            '': 'ממתין לדיווח'
        };
        // טיפול ב-null כטקסט "null"
        if (status === null || status === 'null') {
            return translations['null'];
        }
        return translations[status] || status || translations[''];
    },

    renderLog: function(logs) {
        const container = document.getElementById('reply-log-container');

        // === שונה: שימוש ב-log.Message לסינון ===
        const filteredLogs = logs.filter(log => 
            log.Message && log.Message.startsWith(this.SMS_REPLY_PREFIX)
        );

        if (filteredLogs.length === 0) {
            container.innerHTML = `<p class="info-message">לא נמצאו תגובות שנשלחו מהממשק.</p>`;
            return;
        }

        // === שונה: הוסרה עמודת "נשלח אל" ===
        let tableHtml = '<table class="report-table reply-log-table"><thead><tr>' +
            '<th>תאריך ושעה</th>' +
            '<th>תוכן התגובה</th>' +
            '<th>סטטוס מסירה</th>' +
            '</tr></thead><tbody>';

        filteredLogs.forEach(log => {
            // === שונה: שימוש ב-log.Message ועדכון המפריד ===
            const userContent = log.Message.split('תוכן ההודעה \n')[1] || log.Message;
            // === שונה: הוספת תרגום סטטוס ===
            const statusText = this.translateDeliveryStatus(log.DeliveryReport);
            
            // === שונה: הוסרה עמודת "נשלח אל" ===
            tableHtml += `
                <tr>
                    <td style="direction: ltr; text-align: right;">${log.Time}</td>
                    <td class="log-message-content">${userContent.replace(/\n/g, '<br>')}</td>
                    <td>${statusText}</td>
                </tr>`;
        });

        tableHtml += '</tbody></table>';
        container.innerHTML = tableHtml;
    }
};

// אתחול מיידי של הבקר
announcementsReplyController.init();