// ====================================================================
//  points-archive-process-controller.js - ניהול תהליך ארכוב נקודות
// ====================================================================

const pointsArchiveProcessController = {

    SOURCE_PATH: 'ivr2:/Points/Split',
    TARGET_BASE_PATH: 'ivr2:Points',

    init: function() {
        const newName = prompt("נא הזן שם תיאורי עבור דוח הנקודות הנוכחי (לדוגמה: 'חודש-תשרי'):");
        if (!newName || newName.trim() === '') {
            return; // המשתמש ביטל או לא הכניס שם
        }

        const fullTargetPath = `${this.TARGET_BASE_PATH}/${newName}`;
        this.showConfirmationModal(newName, () => {
            this.executeArchiveAction(fullTargetPath);
        });
    },

    showConfirmationModal: function(folderName, onConfirm) {
        const oldModal = document.getElementById('points-archive-confirm-modal');
        if (oldModal) oldModal.remove();

        const modalHtml = `
            <div id="points-archive-confirm-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 3000;">
                <div class="modal-container" style="width: 500px; border-top: 5px solid var(--color-danger);">
                    <div class="modal-header"><h2><i class="fas fa-exclamation-triangle"></i> אזהרה חמורה!</h2></div>
                    <div class="modal-body" style="text-align: center; font-size: 1.1rem; line-height: 1.6;">
                        <p>פעולה זו מארכבת את כל נתוני הנקודות הנוכחיים תחת השם "<strong>${folderName}</strong>" ומתחילה צבירה חדשה.</p>
                        <p style="font-weight: bold; color: var(--color-danger);">
                            יש לוודא שאף משתמש אינו נמצא במערכת בתהליך צבירת נקודות בזמן ביצוע הפעולה.
                        </p>
                        <p>התעלמות מאזהרה זו עלולה לגרום לשיבושים חמורים במנגנון הנקודות.</p>
                        <p><strong>האם אתה בטוח שברצונך להמשיך?</strong></p>
                    </div>
                    <div class="modal-footer">
                        <button id="confirm-points-archive-btn" class="button button-danger"><i class="fas fa-check"></i> כן, אני מבין ומאשר</button>
                        <button id="cancel-points-archive-btn" class="button button-archive"><i class="fas fa-times"></i> ביטול</button>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modalElement = document.getElementById('points-archive-confirm-modal');
        document.getElementById('confirm-points-archive-btn').addEventListener('click', () => { onConfirm(); modalElement.remove(); });
        document.getElementById('cancel-points-archive-btn').addEventListener('click', () => modalElement.remove());
    },

    executeArchiveAction: async function(targetPath) {
        try {
            const token = auth.getToken();
            if (!token) throw new Error("לא נמצא טוקן.");

            const apiUrl = `${auth.API_BASE}/FileAction?token=${token}&action=move&what=${encodeURIComponent(this.SOURCE_PATH)}&target=${encodeURIComponent(targetPath)}`;
            
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`שגיאת רשת (${response.status})`);
            
            const result = await response.json();
            if (!result.success) throw new Error(result.message || 'הפעולה נכשלה בשרת.');

            alert('הארכוב והאיפוס הושלמו בהצלחה!');
            // רענון תצוגת הנקודות כדי להציג את המצב החדש (דוח ריק)
            pointsController.init(true);

        } catch (error) {
            alert(`שגיאה בביצוע הפעולה: ${error.message}`);
        }
    }
};