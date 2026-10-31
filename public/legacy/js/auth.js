// ===================================
//  auth.js - מנוע אימות וניהול טוקן
// ===================================

const auth = {
    API_BASE: 'https://www.call2all.co.il/ym/api',
    token: null,
    listenerAdded: false, // דגל לוודא שהמאזין נוסף רק פעם אחת
    connectionStatus: {
        status: 'pending', // pending, ok, error, warning
        message: 'בודק סטטוס...'
    },

    // --- פונקציית תרגום ---
    translatePassReason(reason) {
        const reasons = {
            'IS_CUSTOMER_AUTH_TOKEN': 'משתמש עם טוקן קבוע',
            'INIT_WHITELIST_IPS': 'כתובת IP ברשימה לבנה',
            'INIT_MASTER_LOGIN_WHITELIST_IPS': 'התחברות מאסטר',
            'HAVE_ACTIVE_TRUST_TOKEN': 'אסימון "זכור אותי"',
            'INHERITED_FROM_ORIGINAL_SESSION': 'ירושה מסשן קודם',
            'MFA_PASSED': 'בוצע אימות בפועל',
            'SPECIAL_VALID_TOKEN': 'טוקן עם פטור מיוחד'
        };
        return reasons[reason] || reason; // אם אין תרגום, החזר את הסיבה המקורית
    },

    async login(username, password) {
        if (!username || !password) {
            return { status: 'error', message: 'שם משתמש או סיסמה חסרים.' };
        }
        try {
            const response = await fetch(`${this.API_BASE}/Login?username=${username}&password=${password}`);
            const data = await response.json();

            if (data.responseStatus === 'OK' && data.token) {
                return { status: 'ok', token: data.token, message: 'התחברות הצליחה, מתקבל טוקן...' };
            } else {
                return { status: 'error', message: data.message || 'שם משתמש או סיסמה שגויים.' };
            }
        } catch (error) {
            return { status: 'error', message: `שגיאת רשת: ${error.message}` };
        }
    },

    async verifyToken(token) {
        if (!token) {
             return { status: 'error', message: 'לא נמצא טוקן.' };
        }
        try {
            const isPassResponse = await fetch(`${this.API_BASE}/MFASession?token=${token}&action=isPass`);
            const isPassData = await isPassResponse.json();

            if (isPassData.responseStatus !== 'OK') {
                return { status: 'error', message: isPassData.message || 'הטוקן אינו תקף.' };
            }

            if (isPassData.isPass) {
                const translatedReason = this.translatePassReason(isPassData.passReason);
                return { status: 'ok', message: `מאומת (${translatedReason})` };
            }

            const tryResponse = await fetch(`${this.API_BASE}/MFASession?token=${token}&action=try`);
            const tryData = await tryResponse.json();

            if (tryData.responseStatus === 'OK' && tryData.isPass) {
                const translatedReason = this.translatePassReason(tryData.passReason);
                return { status: 'ok', message: `מאומת (${translatedReason})` };
            }

            return { status: 'warning', message: 'נדרש אימות דו-שלבי.' };

        } catch (error) {
            return { status: 'error', message: `שגיאת רשת: ${error.message}` };
        }
    },
    
    updateConnectionStatus(status, message) {
        this.connectionStatus = { status, message };
        this.updateStatusUI();
    },

    // פונקציה זו פשוט מעדכנת את הטקסט, היא כבר לא מוסיפה מאזינים
    updateStatusUI() {
        const statusEl = document.getElementById('connection-status');
        if (!statusEl) return;
        const statusTextEl = document.getElementById('status-text');
        
        statusEl.className = `status-${this.connectionStatus.status}`;
        statusTextEl.innerHTML = this.connectionStatus.message;
    },
    
    async initialize() {
        
        // --- !!! תיקון קריטי !!! ---
        // הוסף מאזין לחיצה *אחד* קבוע על גוף הדף
        // זה יתפוס לחיצות על הקישור #mfa-link בכל מקום שהוא יופיע
        if (!this.listenerAdded) {
            document.body.addEventListener('click', (e) => {
                // בדוק אם האלמנט שנלחץ הוא הקישור שלנו
                if (e.target.id === 'mfa-link') {
                    e.preventDefault(); // בטל את פעולת ה-#
                    if (this.token) {
                        try {
                            mfaController.startAuth(this.token);
                        } catch (err) {
                            console.error("שגיאה בפתיחה ידנית של חלון אימות:", err);
                            // נסה לעדכן את ההודעה במקום שבו היא נמצאת
                            const statusTextEl = e.target.closest('span, #initial-status');
                            if (statusTextEl) {
                                statusTextEl.innerHTML = "שגיאה בפתיחת חלון האימות.";
                            }
                        }
                    } else {
                        const statusTextEl = e.target.closest('span, #initial-status');
                        if (statusTextEl) {
                             statusTextEl.innerHTML = "טוקן לא נמצא. נא לרענן.";
                        }
                    }
                }
            });
            this.listenerAdded = true; // סמן שהמאזין נוסף
        }
        // --- סוף התיקון ---

        this.updateStatusUI(); // הצג סטטוס התחלתי
        let storedToken = localStorage.getItem('api_token');
        const username = localStorage.getItem('username');
        const password = localStorage.getItem('password');

        // אם אין טוקן, נסה מיד להתחבר עם הפרטים השמורים
        if (!storedToken) {
            if (username && password) {
                this.updateConnectionStatus('pending', 'לא נמצא טוקן, מנסה ליצור אחד אוטומטית...');
                const loginResult = await this.login(username, password);
                
                if (loginResult.status === 'ok') {
                    localStorage.setItem('api_token', loginResult.token);
                    // לאחר יצירת הטוקן, נתחיל את תהליך האימות מחדש
                    return await this.initialize(); 
                } else {
                    this.updateConnectionStatus('error', `יצירת טוקן אוטומטית נכשלה: ${loginResult.message}`);
                    return false;
                }
            } else {
                // אם אין טוקן וגם אין פרטי התחברות, אז אין מה לעשות
                this.updateConnectionStatus('error', 'לא מחובר. יש להזין פרטים בהגדרות.');
                return false;
            }
        }

        // --- מכאן והלאה, הקוד ממשיך כמו קודם, ורלוונטי רק אם נמצא טוקן ---
        
        const verificationResult = await this.verifyToken(storedToken);

        if (verificationResult.status === 'ok') {
            this.token = storedToken;
            this.updateConnectionStatus('ok', `מחובר. ${verificationResult.message}`);
            return true;
        }

        if (verificationResult.status === 'warning') {
            this.token = storedToken; // שמור את הטוקן לשימוש עתידי (עבור הלחיצה על הקישור)
            
            // עדכן את הסטטוס עם הקישור, בדיוק כמו קודם
            this.updateConnectionStatus(
                'warning', 
                `${verificationResult.message} <a href="#" id="mfa-link">לחץ כאן לאימות</a>` 
            );
            
            // נסה לפתוח את המודאל אוטומטית
            // זה יעבוד עכשיו כי mfaController כבר נטען
            try {
                mfaController.startAuth(storedToken);
            } catch (e) {
                console.error("שגיאה בפתיחה אוטומטית של חלון אימות:", e);
                // עדכן שהפתיחה האוטומטית נכשלה, אבל הקישור עדיין שם
                this.updateConnectionStatus(
                    'error', 
                    `שגיאה בטעינת חלון אימות. <a href="#" id="mfa-link">נסה שוב</a>`
                );
            }
            
            return false;
        }
        
        // אם הטוקן הקיים אינו תקין, נסה לחדש אותו
        if (verificationResult.status === 'error') {
            if (username && password) {
                this.updateConnectionStatus('pending', 'הטוקן אינו תקף, מנסה לחדש אוטומטית...');
                
                const loginResult = await this.login(username, password);
                if (loginResult.status === 'ok') {
                    localStorage.setItem('api_token', loginResult.token);
                    return await this.initialize();
                } else {
                     this.updateConnectionStatus('error', `חידוש טוקן נכשל: ${loginResult.message}`);
                     return false;
                }
            } else {
                this.updateConnectionStatus('error', 'הטוקן אינו תקף. יש להתחבר מחדש.');
                return false;
            }
        }
    },
    
    getToken() {
        return this.token;
    }
};