// ======================================================
//  realtime-calls-controller.js - ניהול צפייה בשיחות בזמן אמת
// ======================================================

const realtimeCallsController = {
    // הגדרות
    POLLING_INTERVAL: 1000, // בדיקה כל שניה
    API_ENDPOINT: 'GetIncomingCalls',
    EXCLUDED_DIDS: ['0775024359'], // מספרים להסתרה

    // רכיבי DOM
    btnContainer: null,
    badgeElement: null,
    modalOverlay: null,
    tableBody: null,
    
    intervalId: null,
    activeCallsData: [],
    isModalOpen: false,

    init: function() {
        this.injectModalHtml(); // רק מזריק את המודאל, הכפתור כבר ב-HTML
        this.cacheDom();
        
        // --- שינוי: הופך את הכפתור לגלוי כעת כשיש חיבור ---
        if (this.btnContainer) {
            this.btnContainer.style.visibility = 'visible';
        }
        // --------------------------------------------------

        this.addEventListeners();
        this.startPolling();
    },

    injectModalHtml: function() {
        // הוספת המודאל לגוף הדף (אם עדיין לא קיים)
        if (document.getElementById('realtime-calls-modal-overlay')) return;

        const modalHtml = `
            <div id="realtime-calls-modal-overlay">
                <div class="modal-container large">
                    <div class="modal-header">
                        <h2><i class="fas fa-satellite-dish"></i> שיחות פעילות בזמן אמת</h2>
                        <span class="close-btn" title="סגירה">&times;</span>
                    </div>
                    <div class="modal-body">
                        <div id="realtime-calls-table-container">
                            <table class="report-table" id="realtime-calls-table">
                                <thead>
                                    <tr>
                                        <th>סטטוס</th>
                                        <th>מספר מתקשר</th>
                                        <th>זיהוי</th> <th>שם מזוהה</th>
                                        <th>מיקום במערכת</th>
                                        <th>משך זמן</th>
                                    </tr>
                                </thead>
                                <tbody id="realtime-calls-tbody">
                                    <tr><td colspan="6" style="text-align:center;">טוען נתונים...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <div class="live-indicator">
                            <span class="pulsing-dot"></span> המערכת מנטרת בזמן אמת
                        </div>
                        <button id="realtime-modal-close-btn" class="button button-archive">סגור</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    },

    cacheDom: function() {
        this.btnContainer = document.getElementById('realtime-calls-btn');
        this.badgeElement = document.getElementById('realtime-calls-badge');
        this.modalOverlay = document.getElementById('realtime-calls-modal-overlay');
        this.tableBody = document.getElementById('realtime-calls-tbody');
    },

    addEventListeners: function() {
        // פתיחת המודאל
        if (this.btnContainer) {
            this.btnContainer.addEventListener('click', () => this.openModal());
        }

        // סגירת המודאל - רק בכפתורים (X או סגור)
        this.modalOverlay.querySelector('.close-btn').addEventListener('click', () => this.closeModal());
        document.getElementById('realtime-modal-close-btn').addEventListener('click', () => this.closeModal());
        
        // הערה: בוטל המאזין לסגירה בלחיצה על הרקע (Overlay)
    },

    startPolling: function() {
        this.fetchCallsData();
        this.intervalId = setInterval(() => this.fetchCallsData(), this.POLLING_INTERVAL);
    },

    fetchCallsData: async function() {
        try {
            const token = auth.getToken();
            if (!token) return;

            const apiUrl = `${auth.API_BASE}/${this.API_ENDPOINT}?token=${token}`;
            const response = await fetch(apiUrl);
            
            if (!response.ok) return; 
            
            const data = await response.json();
            
            if (data.responseStatus === 'OK') {
                this.processCalls(data.calls || []);
            }
        } catch (error) {
            console.error("Realtime monitor error:", error);
        }
    },

    processCalls: function(rawCalls) {
        const filteredCalls = rawCalls.filter(call => {
            if (this.EXCLUDED_DIDS.includes(call.did)) return false;
            return true;
        });

        this.activeCallsData = filteredCalls;
        this.updateBadge(filteredCalls.length);

        if (this.isModalOpen) {
            this.renderTable();
        }
    },

    updateBadge: function(count) {
        if (!this.badgeElement) return;
        
        this.badgeElement.textContent = count;
        
        if (count > 0) {
            this.btnContainer.classList.add('has-calls');
            this.badgeElement.classList.remove('hidden');
            this.badgeElement.classList.add('active');
        } else {
            this.btnContainer.classList.remove('has-calls');
            this.badgeElement.classList.add('hidden');
            this.badgeElement.classList.remove('active');
        }
    },

    openModal: function() {
        this.isModalOpen = true;
        this.modalOverlay.classList.add('visible');
        this.renderTable();
    },

    closeModal: function() {
        this.isModalOpen = false;
        this.modalOverlay.classList.remove('visible');
    },

    renderTable: function() {
        if (!this.tableBody) return;

        if (this.activeCallsData.length === 0) {
            this.tableBody.innerHTML = `<tr><td colspan="6" class="empty-state"><i class="fas fa-check-circle"></i> אין שיחות פעילות כרגע</td></tr>`;
            return;
        }

        const html = this.activeCallsData.map(call => {
            const parsedCaller = this.parseCallerId(call.callerIdNum);
            const duration = this.formatDuration(call.duration);
            const location = call.path ? `<span dir="ltr">${call.path}</span>` : 'נכנס למערכת / מחייג';
            
            return `
                <tr>
                    <td class="status-cell"><div class="status-dot"></div> פעיל</td>
                    <td>${parsedCaller.phone}</td>
                    <td class="id-cell">${parsedCaller.code}</td>
                    <td class="name-cell">${parsedCaller.name}</td>
                    <td>${location}</td>
                    <td class="time-cell">${duration}</td>
                </tr>
            `;
        }).join('');

        this.tableBody.innerHTML = html;
    },
    parseCallerId: function(rawString) {
        if (!rawString) return { phone: '---', code: '-', name: '---' };
        
        let phone = rawString;
        let code = '-';
        let name = '-';

        if (rawString.includes(' זיהוי ')) {
            const parts = rawString.split(' זיהוי ');
            phone = parts[0].trim();
            const rest = parts[1] ? parts[1].trim() : '';

            // ניסיון לחלץ קוד (מספר בהתחלה) ושם
            const match = rest.match(/^(\d+)\s+(.*)$/);
            if (match) {
                code = match[1];
                name = match[2];
            } else if (/^\d+$/.test(rest)) {
                // אם כל היתר הוא רק מספרים, זה הקוד ואין שם
                code = rest;
                name = '---';
            } else {
                // אם אין מספר ברור, הכל הולך לשם
                name = rest;
            }
        }
        
        return { phone, code, name };
    },

    formatDuration: function(seconds) {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }
};

// --- שינוי: הקוד האוטומטי שהיה כאן נמחק ---