// ===================================
//  auth.js - חיבור למערכת
//  כל הפניות עוברות דרך השרת של מארי מקרא, שמחזיק את הטוקן ומוסיף אותו.
//  הדפדפן לא שומר טוקן ולא בודק אותו.
// ===================================

const auth = {
    API_BASE: location.origin + '/marie-mikra/api/yemot',
    connectionStatus: { status: 'ok', message: 'מחובר' },

    async initialize() {
        return true;
    }
};