// ======================================================
//  smti-message-controller.js - מערכת הודעות משרת חיצוני
// ======================================================

const smtiMessageController = {
    API_URL: 'https://smti.uk/marie-mikra/api/message',
    STORAGE_KEY: 'smti_read_messages',
    
    modalOverlay: null,
    announcementButton: null,
    currentMessage: null,
    currentMessageId: null,

    init: async function() {
        this.announcementButton = document.getElementById('announcements-btn');
        if (this.announcementButton) {
            this.announcementButton.style.visibility = 'hidden';
        }
        
        this.injectModalHtml();
        this.addEventListeners();
        await this.checkForMessage(true);
    },

    injectModalHtml: function() {
        if (document.getElementById('smti-message-modal-overlay')) return;

        const modalHtml = `
            <div id="smti-message-modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.6); z-index: 9999; justify-content: center; align-items: center; direction: rtl;">
                <div class="modal-container large" style="max-width: 800px; width: 92%; max-height: 90vh; display: flex; flex-direction: column; background: #fff; border-radius: 8px; box-shadow: 0 5px 25px rgba(0,0,0,0.3); overflow: hidden;">
                    <div class="modal-header" style="padding: 12px 20px; background-color: #f8f9fa; border-bottom: 1px solid #dee2e6; display: flex; justify-content: space-between; align-items: center;">
                        <h2 style="margin: 0; font-size: 1.2rem; color: #333;"><i class="fas fa-bullhorn"></i> הודעת מערכת</h2>
                        <span id="smti-modal-close-btn" class="close-btn" title="סגירה" style="cursor: pointer; font-size: 1.5rem;">&times;</span>
                    </div>
                    <div id="smti-message-body" class="modal-body" style="padding: 20px; overflow-y: auto; flex: 1;"></div>
                    <div class="modal-footer" style="padding: 12px 20px; background-color: #f8f9fa; border-top: 1px solid #dee2e6; display: flex; justify-content: center;">
                        <button id="smti-confirm-read-btn" class="button button-success" style="font-size: 1.1rem; padding: 0.6rem 2rem;">
                            <i class="fas fa-check"></i> קראתי
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this.modalOverlay = document.getElementById('smti-message-modal-overlay');
    },

    addEventListeners: function() {
        if (this.announcementButton) {
            this.announcementButton.addEventListener('click', () => {
                if (this.currentMessage) {
                    this.showModal();
                }
            });
        }

        document.getElementById('smti-modal-close-btn').addEventListener('click', () => {
            this.hideModal();
        });

        document.getElementById('smti-confirm-read-btn').addEventListener('click', () => {
            if (this.currentMessageId) {
                this.markAsRead(this.currentMessageId);
            }
            this.hideModal();
        });
    },

    checkForMessage: async function(isInitialCheck = false) {
        try {
            const response = await fetch(this.API_URL, { cache: 'no-store' });
            
            if (!response.ok) {
                this.hideButton();
                return;
            }

            const data = await response.json();

            if (!data || !data.message || String(data.message).trim() === '') {
                this.currentMessage = null;
                this.currentMessageId = null;
                this.hideButton();
                return;
            }

            this.currentMessage = data.message;
            this.currentMessageId = data.id_message ? String(data.id_message) : null;

            if (this.announcementButton) {
                this.announcementButton.style.visibility = 'visible';
            }

            const isRead = this.currentMessageId ? this.isMessageRead(this.currentMessageId) : false;
            this.updateBadge(!isRead);

            if (isInitialCheck && !isRead) {
                this.showModal();
            }

        } catch (error) {
            this.hideButton();
        }
    },

    showModal: function() {
        if (!this.currentMessage || !this.modalOverlay) return;

        const bodyContainer = document.getElementById('smti-message-body');
        bodyContainer.innerHTML = this.currentMessage;

        const scripts = bodyContainer.querySelectorAll('script');
        scripts.forEach(oldScript => {
            const newScript = document.createElement('script');
            Array.from(oldScript.attributes).forEach(attr => {
                newScript.setAttribute(attr.name, attr.value);
            });
            newScript.textContent = oldScript.textContent;
            oldScript.parentNode.replaceChild(newScript, oldScript);
        });

        this.modalOverlay.style.display = 'flex';
    },

    hideModal: function() {
        if (this.modalOverlay) {
            this.modalOverlay.style.display = 'none';
        }
    },

    hideButton: function() {
        if (this.announcementButton) {
            this.announcementButton.style.visibility = 'hidden';
        }
        this.updateBadge(false);
    },

    updateBadge: function(hasUnread) {
        const badge = document.getElementById('unread-count-badge');
        if (!badge) return;
        if (hasUnread) {
            badge.textContent = '1';
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    },

    getReadIds: function() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            return [];
        }
    },

    isMessageRead: function(id) {
        return this.getReadIds().includes(String(id));
    },

    markAsRead: function(id) {
        const strId = String(id);
        const readIds = this.getReadIds();
        if (!readIds.includes(strId)) {
            readIds.push(strId);
            try {
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(readIds));
            } catch (e) {}
        }
        this.updateBadge(false);
    }
};