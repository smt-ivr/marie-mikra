// js/system-info-controller.js

const systemInfoController = {
    container: null,
    isLoaded: false,

    init: async function(forceRefresh = false) {
        // אם הנתונים טעונים וגם לא ביקשנו רענון בכוח - עצור
        if (this.isLoaded && !forceRefresh) return;
        
        this.container = document.getElementById('system-info-container');
        if (!this.container) return;

        // וידוא שהאלמנט ריק ולא נראה (visibility: hidden מוגדר ב-CSS)
        
        try {
            // אינדיקציה ויזואלית לרענון (חצי שקוף)
            if (forceRefresh) {
                this.container.style.opacity = '0.5';
            }

            const data = await this.fetchCustomerData();
            
            if (data && data.responseStatus === 'OK') {
                this.render(data);
                // הוספת מחלקה שמציגה את האלמנט (visibility: visible)
                this.container.classList.add('loaded'); 
                this.isLoaded = true;
            } else {
                console.warn("System info not available");
                // נשאר hidden וריק
            }
        } catch (error) {
            console.error("SystemInfoController Error:", error);
            // נשאר hidden וריק
        } finally {
            // החזרת השקיפות למצב רגיל
            if (this.container && forceRefresh) {
                this.container.style.opacity = '1';
            }
        }
    },

    fetchCustomerData: async function() {
        const token = auth.getToken();
        if (!token) return null;
        const apiUrl = `${auth.API_BASE}/GetCustomerData?token=${token}&_=${new Date().getTime()}`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`Network error: ${response.status}`);
        return await response.json();
    },

    render: function(data) {
        const name = data.name || 'מערכת';
        const mainDid = data.mainDid || '---';
        const units = parseFloat(data.units || 0).toFixed(1);
        const reseller = data.resellerCreditFile || '-';
        const site = data.systemSite || '-';
        const unitsStyle = units < 10 ? 'sys-units-warning' : '';

        const html = `
            <div class="sys-info-row" style="margin-bottom: 2px;">
                <span class="sys-value name" title="${name}">${name}</span>
                <span class="sys-divider">|</span>
                <span class="sys-value">${mainDid}</span>
            </div>
            <div class="sys-info-row">
                <span class="${unitsStyle}" title="יתרת יחידות: ${units}">${units} יחידות</span>
                <span class="sys-divider">|</span>
                <span title="משווק">${reseller}</span>
                <span class="sys-divider">|</span>
                <span title="שרת">${site}</span>
            </div>
        `;

        this.container.innerHTML = html;
        this.container.title = `שם המערכת: ${name}\nמספר ראשי: ${mainDid}\nאימייל: ${data.email}\nיתרת יחידות: ${units}\nמשווק: ${reseller}\nשרת: ${site}`;
    }
};