// ======================================================
//  mfa-controller.js - בקר ניהול אימות דו-שלבי (MFA)
// (גרסה 6.4 - חלון קבוע 600px, תיקון UI המתנה)
// (*** שילוב עיצוב כרטיסיות חדש ***)
// ======================================================

const mfaController = {
    modalOverlay: null,
    apiToken: null,
    API_BASE: 'https://www.call2all.co.il/ym/api',

    // משתנה מצב לשמירת נתונים בין שלבים
    state: {
        groupedMethods: new Map(), // יאחסן את כל השיטות המקובצות
        selectedGroupKey: null,    // המפתח של הקבוצה שנבחרה (VALUE)
        rememberMe: false,         // האם "זכור אותי" נבחר
        rememberNote: ''           // הכינוי של "זכור אותי"
    },

    // --- אייקונים (מהדמו החדש) ---
    ICONS: {
        PHONE: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`,
        EMAIL: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>`,
        DEFAULT: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.69 14a6.9 6.9 0 0 0 .31-2V5l-8-3-3.16 1.18"></path><path d="M4.73 4.73L4 5v7c0 6 8 10 8 10a20.29 20.29 0 0 0 5.66-3.23"></path></svg>`
    },
    BADGE_ICONS: {
        CALL: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`,
        SMS: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`,
        EMAIL: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>`
    },

    // --- משתני DOM (נוספו חדשים) ---
    cardTemplate: null,
    cardsWrapper: null,

    // נקרא מ-script.js בעת טעינת האפליקציה
    initialize: function() {
        this.injectModalHtml();
        this.modalOverlay = document.getElementById('mfa-modal-overlay'); // ודא שהוא מאותחל
        
        // --- איתור רכיבי ה-DOM החדשים ---
        this.cardTemplate = document.getElementById('mfa-card-template');
        this.cardsWrapper = document.getElementById('mfa-cards-wrapper');

        // הוספת מאזינים לכפתורי המודאל
        this.modalOverlay.querySelector('.close-btn').addEventListener('click', () => this.hideModal());
        
        // --- מאזינים לשלב 2 (אפשרויות) ---
        this.modalOverlay.querySelector('#mfa-step2-send-btn').addEventListener('click', () => this.sendCode());
        this.modalOverlay.querySelector('#mfa-step2-back-btn').addEventListener('click', () => this.showStep('mfa-step-1-select-method'));
        
        // --- מאזינים לשלב 3 (קוד) ---
        this.modalOverlay.querySelector('#mfa-step3-verify-btn').addEventListener('click', () => this.verifyCode());
        this.modalOverlay.querySelector('#mfa-step3-back-btn').addEventListener('click', () => this.showStep('mfa-step-2-select-options'));
        
        // מאפשר אישור בלחיצת אנטר
        this.modalOverlay.querySelector('#mfa-code-input').addEventListener('keyup', (e) => {
            if (e.key === 'Enter') this.verifyCode();
        });

        // מאזין לתיבת "זכור אותי"
        const rememberCheckbox = this.modalOverlay.querySelector('#mfa-remember-me');
        const rememberNoteWrapper = this.modalOverlay.querySelector('#mfa-remember-note-wrapper');
        const rememberNoteInput = rememberNoteWrapper.querySelector('input');
        
        rememberCheckbox.addEventListener('change', () => {
            const isChecked = rememberCheckbox.checked;
            rememberNoteWrapper.style.opacity = isChecked ? '1' : '0.5';
            rememberNoteInput.disabled = !isChecked;
            if (!isChecked) {
                rememberNoteInput.value = ''; // נקה תיאור אם התיבה לא מסומנת
            }
        });
    },

    // נקרא מ-auth.js כאשר נדרש אימות
    startAuth: function(token) {
        this.apiToken = token;
        if (!this.modalOverlay) {
            console.error("MFA Modal HTML not injected!");
            return;
        }
        // איפוס מצב בכל התחלה חדשה
        this.state = {
            groupedMethods: new Map(),
            selectedGroupKey: null,
            rememberMe: false,
            rememberNote: ''
        };
        this.showModal();
        this.loadMethods();
    },

    // פונקציית API פנימית
    apiCall: async function(endpoint, params = {}) {
        if (!this.apiToken) throw new Error("MFA: No token provided.");
        
        params.token = this.apiToken;
        const queryString = new URLSearchParams(params).toString();
        const url = `${this.API_BASE}/${endpoint}?${queryString}`;
        
        const response = await fetch(url);
        if (!response.ok) throw new Error(`MFA: שגיאת רשת (${response.status})`);
        
        const data = await response.json();
        if ('responseStatus' in data && data.responseStatus !== 'OK') {
             throw new Error(data.message || `MFA: אירעה שגיאה בפעולה: ${endpoint}`);
        }
        return data;
    },

    // שלב 1: טעינת שיטות האימות
    loadMethods: async function() {
        this.showStep('mfa-loading-step');
        try {
            const data = await this.apiCall('MFASession', { action: 'getMFAMethods' });
            this.groupAndRenderMethods(data.mfaMethods || []);
            this.showStep('mfa-step-1-select-method');
        } catch (error) {
            this.showError(error.message);
        }
    },

    // שלב 1.5: קיבוץ והצגת שיטות האימות (שילוב העיצוב החדש)
    groupAndRenderMethods: function(methods) {
        this.state.groupedMethods.clear(); // נקה נתונים קודמים
        if (!this.cardsWrapper || !this.cardTemplate) {
            console.error("MFA Card elements not found!");
            return;
        }
        this.cardsWrapper.innerHTML = ""; // נקה את התצוגה הקודמת

        // --- תיקון לוגי: קבץ לפי VALUE (האמצעי) ---
        methods.forEach(method => {
            // *** תיקון: חישוב סוגי שליחה תקפים, ללא סינון ***
            let validSendTypes = [];
            if (method.SEND_TYPE && Array.isArray(method.SEND_TYPE)) {
                validSendTypes = method.SEND_TYPE.filter(t => ["CALL", "SMS", "EMAIL"].includes(t));
            }
            
            // שמור את סוגי השליחה התקינים על האובייקט (עדיין שימושי)
            method.validSendTypes = validSendTypes;
            
            const key = method.VALUE || 'default'; 
            if (!this.state.groupedMethods.has(key)) {
                this.state.groupedMethods.set(key, {
                    value: method.VALUE,
                    // קח את הסטטוס והסוג מהשיטה הראשונה בקבוצה
                    status: method.STATUS, 
                    type: method.TYPE,     
                    methods: [] // יחזיק את כל אובייקטי השיטה
                });
            }
            this.state.groupedMethods.get(key).methods.push(method);
        });

        if (this.state.groupedMethods.size === 0) {
            this.cardsWrapper.innerHTML = `<p class="mfa-info-message" style="grid-column: 1 / -1;">לא נמצאו שיטות אימות זמינות.</p>`;
            return;
        }
        
        // --- לולאת הרנדור החדשה (מבוססת Template) ---
        this.state.groupedMethods.forEach((group, groupKey) => { // groupKey הוא ה-VALUE
            
            const card = this.cardTemplate.content.cloneNode(true).firstElementChild;
            const isPending = group.status === 'PENDING';

            // איחוד כל המקורות וההערות
            const allNikes = [...new Set(group.methods.map(m => this.translateNike(m.NIKE)))].join(' | ');
            const allNotes = [...new Set(group.methods.map(m => m.NOTE).filter(Boolean))].join('; ');

            // איחוד כל סוגי השליחה הזמינים
            const allValidSendTypes = [...new Set(group.methods.flatMap(m => m.validSendTypes || []))];

            card.querySelector(".card-icon").innerHTML = this.ICONS[group.type] || this.ICONS.DEFAULT;
            card.querySelector(".card-title").textContent = this.translateType(group.type);
            card.querySelector(".card-source").textContent = allNikes;
            card.querySelector(".card-value").textContent = group.value;

            if (allNotes) {
                card.querySelector(".card-note").textContent = allNotes;
            } else {
                card.querySelector(".card-note").remove();
            }

            // --- טיפול בתגיות (Badges) ---
            const sendTypesWrapper = card.querySelector(".card-send-types");
            if (allValidSendTypes.length > 0) {
                sendTypesWrapper.innerHTML = allValidSendTypes.map(st => this.getSendTypeBadge(st)).join("");
            } else {
                sendTypesWrapper.remove();
            }

            // --- טיפול בסטטוס ובלחיצה ---
            const statusElem = card.querySelector(".card-status");
            let statusText = "";

            if (isPending) {
                card.classList.add("disabled");
                statusText = "מושבת (ממתין לאימות באתר)";
                statusElem.classList.add("pending");
            
            } else if (group.status === "ACTIVE" && allValidSendTypes.length > 0) {
                // פעיל *רק* אם הסטטוס ACTIVE ויש לו לפחות סוג שליחה תקין אחד
                statusText = "לחץ לביצוע אימות";
                card.addEventListener("click", () => {
                    this.state.selectedGroupKey = groupKey; // groupKey הוא ה-VALUE
                    this.renderSendOptions(this.state.selectedGroupKey);
                    this.showStep('mfa-step-2-select-options');
                });
            
            } else {
                // כל מקרה אחר (PASSKEY, סטטוס לא פעיל, או פעיל ללא סוג שליחה תקין)
                card.classList.add("disabled");
                statusText = "לא ניתן לשלוח אימות";
                statusElem.classList.add("unavailable");
            }
            
            statusElem.textContent = statusText;
            this.cardsWrapper.appendChild(card);
        });
    },

    // שלב 2: הצגת אפשרויות השליחה (תיקון לוגיקה)
    renderSendOptions: function(groupKey) {
        const group = this.state.groupedMethods.get(groupKey);
        if (!group) return;

        // --- איחוד הכינויים לכותרת ---
        const allNikes = [...new Set(group.methods.map(m => this.translateNike(m.NIKE)))].join(' | ');

        document.getElementById('mfa-step2-details-type').textContent = `סוג: (${allNikes})`;
        document.getElementById('mfa-step2-details-value').innerHTML = `ערך: <span dir="ltr">${group.value}</span>`;

        // --- יצירת כפתורי רדיו עבור כל אפשרות שליחה מכל שיטה ---
        const radioContainer = document.getElementById('mfa-step2-radio-container');
        let radioHtml = '';
        let checked = false;
        
        group.methods.forEach(method => { // לולאה על כל שיטה (למשל "פרופיל", "נוסף ידנית")
            // השתמש רק בסוגי השליחה שסוננו מראש
            const sendTypes = method.validSendTypes || [];
            sendTypes.forEach((sendType) => { // לולאה על כל אפשרות שליחה (למשל SMS, CALL)
                const id = `mfa-method-${method.ID}-send-${sendType}`;
                radioHtml += `
                    <div class="mfa-radio-option">
                        <input type="radio" 
                               id="${id}" 
                               name="mfaSendType" 
                               value="${sendType}" 
                               data-mfa-id="${method.ID}"
                               ${!checked ? 'checked' : ''}>
                        <label for="${id}">${this.translateSendTypeRadio(sendType)}</label>
                    </div>
                `;
                checked = true; // סמן שכבר בחרנו את הראשון
            });
        });
        
        radioContainer.innerHTML = radioHtml;

        // איפוס שדות "זכור אותי"
        document.getElementById('mfa-remember-me').checked = false;
        const rememberNoteInput = document.getElementById('mfa-remember-note');
        const rememberNoteWrapper = document.getElementById('mfa-remember-note-wrapper');
        
        rememberNoteInput.value = '';
        rememberNoteWrapper.style.opacity = '0.5';
        rememberNoteInput.disabled = true;
    },

    // שלב 2.5: שליחת קוד למשתמש (מופעל משלב 2)
    sendCode: async function() {
        const sendButton = this.modalOverlay.querySelector('#mfa-step2-send-btn');
        const selectedRadio = this.modalOverlay.querySelector('input[name="mfaSendType"]:checked');
        
        if (!selectedRadio) {
            alert('יש לבחור אופן שליחה');
            return;
        }

        const mfaId = selectedRadio.dataset.mfaId;
        const sendType = selectedRadio.value;
        const group = this.state.groupedMethods.get(this.state.selectedGroupKey);

        // שמירת נתוני "זכור אותי" במשתנה ה-state
        this.state.rememberMe = this.modalOverlay.querySelector('#mfa-remember-me').checked;
        this.state.rememberNote = this.modalOverlay.querySelector('#mfa-remember-note').value;

        const originalText = sendButton.innerHTML;
        sendButton.disabled = true;
        sendButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> שולח...`;

        try {
            await this.apiCall('MFASession', { action: 'sendMFA', mfaId, mfaSendType: sendType });
            
            this.modalOverlay.querySelector('#mfa-sent-to').innerHTML = `הקוד נשלח אל: <b dir="ltr">${group.value}</b>.`;
            this.modalOverlay.querySelector('#mfa-code-input').value = '';
            this.modalOverlay.querySelector('#mfa-error-details').classList.add('hidden');
            
            this.showStep('mfa-step-3-enter-code');
            this.modalOverlay.querySelector('#mfa-code-input').focus();
            
        } catch (error) {
            this.showError(error.message); // הצג שגיאה גלובלית
        } finally {
            sendButton.disabled = false;
            sendButton.innerHTML = `<i class="fas fa-paper-plane"></i> שלח קוד אימות`;
        }
    },

    // שלב 3: אימות הקוד שהוזן
    verifyCode: async function() {
        const verifyButton = this.modalOverlay.querySelector('#mfa-step3-verify-btn');
        const codeInput = this.modalOverlay.querySelector('#mfa-code-input');
        const code = codeInput.value;

        if (code.length < 4) return; // מניעת שליחה ריקה

        verifyButton.disabled = true;
        verifyButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> מאמת...`;
        this.modalOverlay.querySelector('#mfa-error-details').classList.add('hidden');
        
        const apiParams = {
            action: 'validMFA',
            mfaCode: code
        };
        
        // --- שימוש בנתוני "זכור אותי" ושליחת '1' ---
        if (this.state.rememberMe) {
            apiParams.mfaRememberMe = 1; // שולח 1 במפורש
            if (this.state.rememberNote) {
                apiParams.mfaRememberNote = this.state.rememberNote;
            }
        }

        try {
            const result = await this.apiCall('MFASession', apiParams);
            
            if (result.mfa_valid_status === 'VALID') {
                this.showStep('mfa-success-step');
                setTimeout(() => {
                    this.hideModal();
                    location.reload(); 
                }, 2000);
            } else {
                let errorMessage = result.mfa_valid_message || `אירעה שגיאה באימות הקוד.`;
                
                // חזרה אוטומטית אם נגמרו הניסיונות
                if (result.mfa_valid_status === 'OVERTRY') {
                    errorMessage += ` לא נותרו ניסיונות. יש לשלוח קוד חדש.`;
                    setTimeout(() => this.showStep('mfa-step-1-select-method'), 1500); // חזור להתחלה
                } else if (result.mfa_valid_left > 0) {
                    errorMessage += ` נותרו לך ${result.mfa_valid_left} ניסיונות.`;
                } else {
                     errorMessage += ` לא נותרו ניסיונות. יש לשלוח קוד חדש.`;
                    setTimeout(() => this.showStep('mfa-step-1-select-method'), 1500); // חזור להתחלה
                }
                
                const errorEl = this.modalOverlay.querySelector('#mfa-error-details');
                errorEl.textContent = errorMessage;
                errorEl.classList.remove('hidden');
                
                codeInput.focus();
                codeInput.select();
            }
        } catch (error) {
            this.showError(error.message); // הצג שגיאה גלובלית
        } finally {
            verifyButton.disabled = false;
            verifyButton.innerHTML = `<i class="fas fa-check-circle"></i> אימות קוד`;
        }
    },

    // --- פונקציות עזר ותרגום (מעודכנות) ---
    translateNike: (nike) => ({
        'CREATE_PHONE': 'מנהל המערכת',
        'RESET_MAIL': 'מייל שחזור',
        'PROFILE': 'אימות מהגדרות הפרופיל',
        'MASTER_LOGIN': 'אימות מנהל (ריסיילר)',
        'BY_CUSTOMER': 'נוסף על ידי הלקוח'
    }[nike] || nike || 'אימות כללי'),

    translateSendTypeRadio: (type) => ({
        'CALL': 'שיחה קולית', 
        'SMS': 'הודעת SMS', 
        'EMAIL': 'הודעת מייל'
    }[type] || type),
    
    getCardIcon: (type) => ({
        'PHONE': 'fa-phone-alt', 
        'EMAIL': 'fa-envelope'
    }[type] || 'fa-user-shield'),

    // --- פונקציות עזר ותרגום (מהדמו החדש) ---
    translateType: (type) => ({
        "PHONE": "אימות לטלפון",
        "EMAIL": "הודעה למייל",
    }[type] || type),

    getSendTypeBadge: (sendType) => {
        const text = ({'CALL': 'שיחה', 'SMS': 'הודעת SMS', 'EMAIL': 'מייל'})[sendType] || sendType;
        return `<span class="card-send-type-badge">${mfaController.BADGE_ICONS[sendType] || ''} ${text}</span>`;
    },

    // --- ניהול תצוגה ---
    showModal: function() { this.modalOverlay.classList.add('visible'); },
    hideModal: function() { this.modalOverlay.classList.remove('visible'); },

    showStep: function(stepId) {
        this.modalOverlay.querySelectorAll('.mfa-step').forEach(step => {
            step.classList.add('hidden');
        });
        
        // עדכון כותרת וגוף
        const stepElement = this.modalOverlay.querySelector(`#${stepId}`);
        if (stepElement) {
            stepElement.classList.remove('hidden');
            const title = stepElement.dataset.title || 'ביצוע אימות דו-שלבי';
            this.modalOverlay.querySelector('#mfa-modal-title-text').textContent = title;
        }
        
        // הסתרת כותרת תחתונה קבועה בשלבי טעינה/הצלחה
        const footer = this.modalOverlay.querySelector('.modal-footer');
        if (footer) { // בדוק אם הפוטר קיים
            if (stepId === 'mfa-loading-step' || stepId === 'mfa-success-step' || stepId === 'mfa-error-step') {
                footer.classList.add('hidden');
            } else {
                footer.classList.remove('hidden');
            }
        }
    },

    showError: function(message) {
        this.modalOverlay.querySelector('#mfa-global-error-text').textContent = message;
        this.showStep('mfa-error-step');
    },

    // --- הזרקת HTML (תיקון 1 + 2 + 5) ---
    injectModalHtml: function() {
        if (document.getElementById('mfa-modal-overlay')) return;

        const modalHtml = `
            <div id="mfa-modal-overlay">
                <div class="mfa-modal-container" id="mfa-modal-container">
                    <div class="modal-header">
                        <h2 id="mfa-modal-title-text" class="mfa-modal-title">טוען...</h2>
                        <span class="close-btn" title="סגירה">&times;</span>
                    </div>
                    
                    <div class="modal-body" id="mfa-modal-body">
                        
                        <div id="mfa-loading-step" class="mfa-step mfa-message-box" data-title="טוען נתונים...">
                            <i class="fas fa-spinner fa-spin mfa-loading-icon"></i>
                            <h2>טוען שיטות אימות...</h2>
                        </div>

                        <div id="mfa-step-1-select-method" class="mfa-step hidden" data-title="ביצוע אימות דו-שלבי">
                            <p class="mfa-instructions">
                                <i class="fas fa-info-circle"></i> לצורך אבטחה, יש לבצע אימות.
                                <span style="font-weight: bold;">אנא בחרו את אמצעי האימות:</span>
                            </p>
                            
                            <div class="mfa-cards-container">
                                <div class="cards-wrapper" id="mfa-cards-wrapper">
                                    </div>
                            </div>

                            <template id="mfa-card-template">
                                <div class="mfa-card" role="button" tabindex="0">
                                    <div class="card-header">
                                        <span class="card-icon"></span>
                                        <div class="card-title-group">
                                            <div class="card-title"></div>
                                            <div class="card-source"></div>
                                        </div>
                                    </div>
                                    <div class="card-body">
                                        <div class="card-value"></div>
                                        <div class="card-note"></div>
                                    </div>
                                    <div class="card-footer">
                                        <div class="card-send-types"></div>
                                        <div class="card-status"></div>
                                    </div>
                                </div>
                            </template>
                            </div>

                        <div id="mfa-step-2-select-options" class="mfa-step hidden" data-title="בחירת צורת אימות">
                            
                            <div class="mfa-options-box">
                                <strong>פרטי אמצעי האימות:</strong>
                                <div id="mfa-step2-details-type"></div>
                                <div id="mfa-step2-details-value"></div>
                            </div>
                            
                            <div class="mfa-options-box">
                                <strong>בחרו אופן שליחה:</strong>
                                <div id="mfa-step2-radio-container">
                                    </div>
                            </div>

                            <div class="mfa-options-box mfa-remember-section">
                                <div class="mfa-remember-checkbox">
                                    <input type="checkbox" id="mfa-remember-me">
                                    <label for="mfa-remember-me">זכור אותי ל-30 יום</label>
                                </div>
                                <div id="mfa-remember-note-wrapper" class="mfa-remember-note-wrapper">
                                    <label for="mfa-remember-note">תיאור (אופציונלי, לדוגמה: "מחשב במשרד"):</label>
                                    <input type="text" id="mfa-remember-note" placeholder="מחשב במשרד">
                                </div>
                            </div>
                            
                            <div class="mfa-step-actions">
                                <button type="button" id="mfa-step2-send-btn" class="button button-success"><i class="fas fa-paper-plane"></i> שלח קוד אימות</button>
                                <button type="button" id="mfa-step2-back-btn" class="button button-archive"><i class="fas fa-arrow-right"></i> חזרה</button>
                            </div>
                        </div>

                        <div id="mfa-step-3-enter-code" class="mfa-step hidden mfa-code-container" data-title="הזנת קוד אימות">
                            <h3>הזנת קוד אבטחה</h3>
                            <p id="mfa-sent-to"></p>
                            <input type="text" id="mfa-code-input" class="mfa-code-input" placeholder="------" required dir="ltr" inputmode="numeric" pattern="[0-9]*" maxlength="6">
                            <div id="mfa-error-details" class="mfa-error-message hidden"></div>
                            
                            <div class="mfa-step-actions">
                                <button type="button" id="mfa-step3-verify-btn" class="button button-success"><i class="fas fa-check-circle"></i> אימות קוד</button>
                                <button type="button" id="mfa-step3-back-btn" class="button button-archive"><i class="fas fa-arrow-right"></i> חזרה</button>
                            </div>
                        </div>

                        <div id="mfa-success-step" class="mfa-step hidden mfa-message-box" data-title="האימות הושלם">
                            <i class="fas fa-check-circle mfa-success-icon"></i>
                            <h2>האימות הושלם בהצלחה!</h2>
                            <p>מרענן את המערכת...</p>
                        </div>
                        
                        <div id="mfa-error-step" class="mfa-step hidden mfa-message-box" data-title="שגיאה">
                            <i class="fas fa-exclamation-triangle mfa-error-icon"></i>
                            <h2>אירעה שגיאה</h2>
                            <p id="mfa-global-error-text"></p>
                        </div>

                    </div>
                    
                    </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
};