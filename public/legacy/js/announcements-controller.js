// ======================================================
//  announcements-controller.js - ניהול מערכת הודעות
//  (גרסה משודרגת עם שמירה היברידית בשרת ובמקומי + תיקון פריסה)
// ======================================================

const announcementsController = {
    // --- נתיבים ---
    ANNOUNCEMENTS_PATH: 'ivr2:/announcements',
    LOG_BASE_PATH: 'ivr2:/announcements/log', // נתיב היומן בשרת
    READ_ANNOUNCEMENTS_KEY: 'read_announcements', // מפתח לזיכרון המקומי ("קיוקס")

    CHECK_INTERVAL: 120000, // 2 דקות
    
    // --- רכיבי DOM ---
    modalOverlay: null,
    popupOverlay: null,
    announcementButton: null,
    
    // --- משתני מצב ---
    allAnnouncements: [],
    unreadCount: 0,
    intervalId: null,
    userIP: null, // יאחסן את כתובת ה-IP
    readStatusCache: new Map(), // מטמון למניעת בדיקות כפולות

    // ===================================
    //  #region אתחול ובדיקה ראשית
    // ===================================

    // אתחול המודול (נקרא מ-script.js לאחר חיבור תקין)
    init: async function() {
        this.announcementButton = document.getElementById('announcements-btn');
        this.injectModalHtml();
        this.addEventListeners();
        
        // שלב 1: נסה להשיג את כתובת ה-IP של המשתמש
        await this.getUserIP(); 
        
        // שלב 2: התחל בדיקה תקופתית ובדוק בפעם הראשונה
        this.startPeriodicCheck();
        await this.checkForAnnouncements(true); // בדיקה ראשונית
    },

    injectModalHtml: function() {
        const modalHtml = `
            <div id="announcements-modal-overlay">
                <div class="modal-container large">
                    <div class="modal-header">
                        <h2><i class="fas fa-bullhorn"></i> מרכז ההודעות</h2>
                        <span class="close-btn" title="סגירה">&times;</span>
                    </div>
                    <div class="modal-body">
                        
                        <div class="announcements-toolbar" style="display: none;">
                            <button id="mark-all-read-btn" class="button button-success"><i class="fas fa-check-double"></i> סמן הכל כנקרא</button>
                            <div class="filter-switch">
                                <label for="unread-filter-checkbox">הצג הודעות שלא נקראו בלבד</label>
                                <input type="checkbox" id="unread-filter-checkbox">
                            </div>
                        </div>
                        
                        <div id="announcements-list-container"></div>
                    </div>
                </div>
            </div>

            <div id="announcement-popup-overlay">
                 <div class="modal-container" style="max-width: 550px;">
                    <div class="modal-header">
                        <h2 id="popup-title"><i class="fas fa-info-circle"></i> הודעה חדשה מהמערכת</h2>
                         <button id="popup-skip-btn" class="button button-archive">דלג</button>
                    </div>
                    <div id="popup-meta" class="popup-meta-info"></div>
                    <div id="popup-body" class="modal-body"></div>
                    <div class="modal-footer" style="justify-content: space-between;">
                        <button id="popup-reply-btn" class="button button-browse" style="font-size: 1.1rem; padding: 0.6rem 1.2rem;"><i class="fas fa-reply"></i> שלח תשובה</button>
                        <button id="popup-confirm-read-btn" class="button button-success" style="font-size: 1.1rem; padding: 0.6rem 1.5rem;"><i class="fas fa-check"></i> תודה, קראתי</button>
                    </div>
                 </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this.modalOverlay = document.getElementById('announcements-modal-overlay');
        this.popupOverlay = document.getElementById('announcement-popup-overlay');
    },
    
    addEventListeners: function() {
        if(this.announcementButton) {
            this.announcementButton.addEventListener('click', () => this.showMainModal());
        }
        this.modalOverlay.querySelector('.close-btn').addEventListener('click', () => this.hideMainModal());
        
        document.getElementById('mark-all-read-btn').addEventListener('click', () => this.markAllAsRead());
        document.getElementById('unread-filter-checkbox').addEventListener('change', (e) => this.renderAnnouncementsList(e.target.checked));
    
        // כפתור "דלג" סוגר את החלון
        document.getElementById('popup-skip-btn').addEventListener('click', () => this.hidePopup());
        
        // כפתור "קראתי" סוגר ומסמן
        document.getElementById('popup-confirm-read-btn').addEventListener('click', () => {
            const messageId = this.popupOverlay.dataset.messageId;
            if (messageId) {
                this.markAsRead(messageId);
            }
            this.hidePopup();
        });

        // כפתור "הגב" פותח חלון תגובה
        document.getElementById('popup-reply-btn').addEventListener('click', () => {
            const messageId = this.popupOverlay.dataset.messageId;
            const messageTitle = this.popupOverlay.dataset.messageTitle;
            if (messageId && typeof announcementsReplyController !== 'undefined') {
                announcementsReplyController.showReplyModal(messageId, messageTitle); // הצג את מודאל התגובה
            }
        });
    },

    startPeriodicCheck: function() {
        if (this.intervalId) clearInterval(this.intervalId);
        const checkAsync = async () => {
            await this.checkForAnnouncements(false);
        };
        this.intervalId = setInterval(checkAsync, this.CHECK_INTERVAL);
    },

    // ===================================
    //  #region לוגיקת קריאת הודעות
    // ===================================

    checkForAnnouncements: async function(isInitialCheck = false) {
        try {
            const dirData = await this.fetchDirectoryData(this.ANNOUNCEMENTS_PATH);
            
            // שינוי: הכפתור יוצג רק אם טעינת התיקייה הצליחה
            // שימוש ב-visibility במקום display כדי לשמור על המקום בסרגל
            if (this.announcementButton) {
                this.announcementButton.style.visibility = 'visible';
            }

            const messagesMap = new Map();

            // 1. עבור על קבצי INI
            for (const file of dirData.ini) {
                const id = file.name.match(/^(\d{3})\.ini$/)?.[1];
                if (id) {
                    const content = await this.fetchAnnouncementIniContent(file.what);
                    const parsed = this.parseAnnouncementIniContent(id, content, file.mtime);
                    messagesMap.set(id, parsed);
                }
            }

            // 2. עבור על קבצי שמע
            for (const file of dirData.files) {
                const id = file.name.match(/^(\d{3})\.(wav|mp3|ogg)$/)?.[1];
                if (id) {
                    const audioPath = file.what;
                    if (messagesMap.has(id)) {
                        messagesMap.get(id).audioPath = audioPath;
                    } else {
                        messagesMap.set(id, {
                            id, title: `הודעה קולית #${id}`, content: 'הודעה קולית',
                            isRead: false, date: file.mtime, audioPath: audioPath
                        });
                    }
                }
            }
            
            this.allAnnouncements = Array.from(messagesMap.values());
            this.allAnnouncements.sort((a, b) => b.id.localeCompare(a.id));
            
            // עדכן סטטוס
            await this.updateUnreadStatus(); 

            if (isInitialCheck) {
                if (this.unreadCount >= 2) {
                    this._displayMainModal();
                } else if (this.unreadCount === 1) {
                    const latestUnread = this.allAnnouncements.find(msg => !msg.isRead);
                    if (latestUnread) {
                        this.showPopup(latestUnread);
                    }
                }
            }

        } catch (error) {
            console.error("Announcements Error:", error.message);
            // אם הייתה שגיאה כלשהי, הסתר את הכפתור ויזואלית אך שמור על המקום
            if (this.announcementButton) this.announcementButton.style.visibility = 'hidden';
        }
    },

    updateUnreadStatus: async function() {
        let count = 0;
        for (const msg of this.allAnnouncements) {
            msg.isRead = await this.isMessageRead(msg.id);
            if (!msg.isRead) count++;
        }
        this.unreadCount = count;
        this.updateBadge();
    },

    isMessageRead: async function(messageId) {
        if (this.readStatusCache.has(messageId)) {
            return this.readStatusCache.get(messageId);
        }
        if (this.userIP) {
            const serverRead = await this.checkServerLog(messageId, this.userIP);
            if (serverRead) {
                this.readStatusCache.set(messageId, true);
                return true;
            }
        }
        const localRead = this.checkLocalLog(messageId);
        if (localRead) {
            if (this.userIP) {
                this.saveToServerLog(messageId, this.userIP).catch(err => {
                    console.error("Sync error:", err.message);
                });
            }
            this.readStatusCache.set(messageId, true);
            return true;
        }
        this.readStatusCache.set(messageId, false);
        return false;
    },

    // ===================================
    //  #region לוגיקת סימון כ"נקרא"
    // ===================================

    markAsRead: async function(messageId) {
        const serverSave = this.userIP ? this.saveToServerLog(messageId, this.userIP) : Promise.resolve();
        const localSave = this.saveToLocalLog(messageId);
        await Promise.all([serverSave, localSave]);
        
        this.readStatusCache.set(messageId, true);
        await this.updateUnreadStatus();
        this.renderAnnouncementsList(document.getElementById('unread-filter-checkbox').checked);
    },

    markAllAsRead: async function() {
        const localIds = this.getLocalReadIds();
        let changed = false;
        const serverSavePromises = [];

        for (const msg of this.allAnnouncements) {
            if (!msg.isRead) {
                if (this.userIP) {
                    serverSavePromises.push(this.saveToServerLog(msg.id, this.userIP));
                }
                if (!localIds.includes(msg.id)) {
                    localIds.push(msg.id);
                    changed = true;
                }
                this.readStatusCache.set(msg.id, true);
            }
        }
        
        if (changed) {
            this.saveLocalReadIds(localIds);
        }
        
        await Promise.all(serverSavePromises);
        await this.updateUnreadStatus();
        this.renderAnnouncementsList(document.getElementById('unread-filter-checkbox').checked);
    },

    // ===================================
    //  #region פונקציות עזר ו-API
    // ===================================

    getUserIP: async function() {
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            if (!response.ok) throw new Error('Failed to fetch IP');
            const data = await response.json();
            this.userIP = data.ip;
        } catch (error) {
            console.error("Could not get user IP:", error.message);
            this.userIP = null; 
        }
    },
    
    getLogFilePath: function(messageId) {
        return `${this.LOG_BASE_PATH}/${messageId}.ini`;
    },

    checkServerLog: async function(messageId, ip) {
        const filePath = this.getLogFilePath(messageId);
        try {
            const content = await this.apiGetTextFile(filePath);
            const ips = this.parseLogContent(content);
            return ips.includes(ip);
        } catch (error) {
            if (error.message.includes('Invalid path') || error.message.includes('file does not exist')) {
                return false;
            }
            return false;
        }
    },

    saveToServerLog: async function(messageId, ip) {
        if (!ip) return; 
        const filePath = this.getLogFilePath(messageId);
        let currentContent = '';
        try {
            currentContent = await this.apiGetTextFile(filePath);
        } catch (error) { /* Ignore read error */ }

        const ips = this.parseLogContent(currentContent);
        if (ips.includes(ip)) return; 
        ips.push(ip);
        const newContent = this.formatLogContent(ips);

        try {
            await this.apiUploadTextFile(filePath, newContent);
        } catch (error) {
            console.error(`Failed to save server log ${filePath}:`, error.message);
        }
    },
    
    parseLogContent: function(content) {
        if (!content) return [];
        const ips = [];
        const lines = content.split('\n');
        lines.forEach(line => {
            const parts = line.split('=');
            if (parts.length === 2 && parts[0].startsWith('IP_')) {
                ips.push(parts[1].trim());
            }
        });
        return ips;
    },

    formatLogContent: function(ips) {
        return ips.map((ip, index) => `IP_${index + 1}=${ip}`).join('\n');
    },

    getLocalReadIds: function() {
        try {
            const readIds = localStorage.getItem(this.READ_ANNOUNCEMENTS_KEY);
            return readIds ? JSON.parse(readIds) : [];
        } catch (e) { return []; }
    },

    saveLocalReadIds: function(readIds) {
        try {
            localStorage.setItem(this.READ_ANNOUNCEMENTS_KEY, JSON.stringify(readIds));
        } catch (e) {}
    },

    checkLocalLog: function(messageId) {
        return this.getLocalReadIds().includes(messageId);
    },

    saveToLocalLog: function(messageId) {
        const readIds = this.getLocalReadIds();
        if (!readIds.includes(messageId)) {
            readIds.push(messageId);
            this.saveLocalReadIds(readIds);
        }
    },

    // פונקציה מתוקנת: קריאת טקסט עם פרמטר זמן
    apiGetTextFile: async function(path) {
        const token = auth.getToken();
        if (!token) throw new Error("לא נמצא טוקן.");
        // --- כאן בוצע התיקון ---
        const apiUrl = `${auth.API_BASE}/GetTextFile?token=${token}&what=${encodeURIComponent(path)}&_=${new Date().getTime()}`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`שגיאת רשת (${response.status})`);
        const result = await response.json();
        if (result.responseStatus !== 'OK') throw new Error(result.message || 'שגיאה בקריאת קובץ');
        return result.contents || "";
    },

    apiUploadTextFile: async function(path, content) {
        const token = auth.getToken();
        if (!token) throw new Error("לא נמצא טוקן.");
        const apiUrl = `${auth.API_BASE}/UploadTextFile`;
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token, what: path, contents: content })
        });
        if (!response.ok) throw new Error(`שגיאת רשת (${response.status})`);
        const result = await response.json();
        if (result.responseStatus !== 'OK') throw new Error(result.message);
    },

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
        return result;
    },

    fetchAnnouncementIniContent: async function(path) {
        return this.apiGetTextFile(path);
    },
    
    parseAnnouncementIniContent: function(id, content, mtime) {
        const announcement = { id, title: `הודעה #${id}`, content: '', isRead: false, date: mtime || '' };
        if (!content) return announcement; 

        const lines = content.split('\n');
        let contentStarted = false;

        lines.forEach(line => {
            const parts = line.split('=');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const value = parts.slice(1).join('=').trim();
                if (key === 'title' || key === 'כותרת') {
                    announcement.title = value;
                    contentStarted = false;
                } else if (key === 'content' || key === 'תוכן הודעה') {
                    announcement.content = value;
                    contentStarted = true;
                }
            } else if (contentStarted) {
                 announcement.content += '\n' + line.trim();
            }
        });
        
        announcement.content = announcement.content.replace(/\n/g, '<br>');
        return announcement;
    },

    updateBadge: function() {
        const badge = document.getElementById('unread-count-badge');
        if (!badge) return;
        if (this.unreadCount > 0) {
            badge.textContent = this.unreadCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    },
    
    renderAnnouncementsList: function(showUnreadOnly = false) {
        const container = document.getElementById('announcements-list-container');
        if (!container) return;

        const filteredList = showUnreadOnly ? this.allAnnouncements.filter(m => !m.isRead) : this.allAnnouncements;

        if (filteredList.length === 0) {
            container.innerHTML = `<p class="info-message"><i class="fas fa-info-circle"></i> אין הודעות להצגה.</p>`;
            return;
        }

        const token = auth.getToken();
        if (!token) return;

        let listHtml = filteredList.map(msg => {
            const audioPlayer = msg.audioPath 
                ? `<div class="audio-player-wrapper"><audio controls controlslist="nodownload" src="${auth.API_BASE}/DownloadFile?token=${token}&path=${encodeURIComponent(msg.audioPath)}"></audio></div>` 
                : '';
            
            const safeTitle = String(msg.title || '').replace(/"/g, '&quot;');

            return `
            <div class="announcement-item ${msg.isRead ? 'is-read' : ''}" data-message-id="${msg.id}">
                <div class="announcement-header">
                    <h4>${msg.title}</h4>
                    <div class="announcement-meta">
                        <button class="button announcement-reply-btn" data-message-id="${msg.id}" data-message-title="${safeTitle}">
                            <i class="fas fa-reply"></i> שלח תשובה
                        </button>
                        ${!msg.isRead ? `<button class="button button-primary mark-one-read-btn">סמן כנקרא</button>` : ''}
                    </div>
                </div>
                <div class="announcement-content">${msg.content}</div>
                ${audioPlayer}
                <div class="announcement-footer">
                    <span class="announcement-date">${msg.date}</span>
                    <span class="read-status-ticks"><i class="fas fa-check-double"></i></span>
                </div>
            </div>`;
        }).join('');

        container.innerHTML = listHtml;
        
        container.querySelectorAll('.mark-one-read-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const messageId = e.target.closest('.announcement-item').dataset.messageId;
                this.markAsRead(messageId);
            });
        });

        container.querySelectorAll('.announcement-reply-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const messageId = e.target.closest('.announcement-reply-btn').dataset.messageId;
                const messageTitle = e.target.closest('.announcement-reply-btn').dataset.messageTitle;
                if (typeof announcementsReplyController !== 'undefined') {
                    announcementsReplyController.showReplyModal(messageId, messageTitle);
                }
            });
        });
    },

    _displayMainModal: function() {
        const toolbar = this.modalOverlay.querySelector('.announcements-toolbar');
        
        if (toolbar && !document.getElementById('show-replies-log-btn')) {
            toolbar.insertAdjacentHTML('beforeend', 
                `<button id="show-replies-log-btn" class="button"><i class="fas fa-history"></i> הצג תגובות שנשלחו</button>`
            );
            document.getElementById('show-replies-log-btn').addEventListener('click', () => {
                if (typeof announcementsReplyController !== 'undefined') {
                    announcementsReplyController.showLogModal();
                }
            });
        }

        if (toolbar) {
            toolbar.style.display = 'flex'; 
        }
        
        const markAllBtn = document.getElementById('mark-all-read-btn');
        if (markAllBtn) {
            markAllBtn.style.display = this.unreadCount > 0 ? 'inline-flex' : 'none';
        }

        this.renderAnnouncementsList(document.getElementById('unread-filter-checkbox').checked);
        this.modalOverlay.classList.add('visible');
    },

    showMainModal: function() {
        const container = document.getElementById('announcements-list-container');
        if (container) {
            container.innerHTML = `<div id="loading" style="padding: 2rem;"><i class="fas fa-spinner fa-spin"></i> טוען הודעות...</div>`;
        }
        
        const toolbar = this.modalOverlay.querySelector('.announcements-toolbar');
        if (toolbar) {
            toolbar.style.display = 'none';
        }
        
        this.modalOverlay.classList.add('visible');
        
        this.checkForAnnouncements(false).then(() => {
            this._displayMainModal();
        });
    },

    hideMainModal: function() {
        this.modalOverlay.classList.remove('visible');
    },
    
    showPopup: function(message) {
        const token = auth.getToken();
        const audioPlayer = message.audioPath
            ? `<div class="audio-player-wrapper"><audio controls controlslist="nodownload" src="${auth.API_BASE}/DownloadFile?token=${token}&path=${encodeURIComponent(message.audioPath)}"></audio></div>`
            : '';
            
        document.getElementById('popup-title').innerHTML = `<i class="fas fa-info-circle"></i> ${message.title}`;
        document.getElementById('popup-meta').innerHTML = `<i class="fas fa-clock"></i> <span>${message.date || 'לא ידוע'}</span>`;
        document.getElementById('popup-body').innerHTML = `${message.content}${audioPlayer}`;
        
        this.popupOverlay.dataset.messageId = message.id;
        this.popupOverlay.dataset.messageTitle = message.title; 
        this.popupOverlay.classList.add('visible');
    },

    hidePopup: function() {
        this.popupOverlay.classList.remove('visible');
    }
};