// ============================
// Remédios do Di - App Logic
// ============================

(function () {
    'use strict';

    // --- Data Store ---
    const STORAGE_KEY = 'diRemedios';
    const HISTORY_KEY = 'diRemediosHistory';

    let medications = [];
    let history = [];
    let checkInterval = null;
    let clockInterval = null;
    let swRegistration = null;
    let activeAlertMedId = null;
    let snoozeTimers = {};
    let confirmCallback = null;
    let alertDismissedTimes = {}; // Evitar re-disparar alerta após fechar

    // --- DOM Elements ---
    const $ = (id) => document.getElementById(id);

    const DOM = {
        headerClock: $('headerClock'),
        totalMeds: $('totalMeds'),
        nextTime: $('nextTime'),
        totalDone: $('totalDone'),
        medsGrid: $('medsGrid'),
        emptyState: $('emptyState'),
        historyList: $('historyList'),
        emptyHistory: $('emptyHistory'),
        btnAddMed: $('btnAddMed'),

        // Modal
        modalOverlay: $('modalOverlay'),
        modalTitle: $('modalTitle'),
        medForm: $('medForm'),
        medId: $('medId'),
        medName: $('medName'),
        medDosage: $('medDosage'),
        medInterval: $('medInterval'),
        medFirstDose: $('medFirstDose'),
        medDuration: $('medDuration'),
        medNotes: $('medNotes'),
        colorPicker: $('colorPicker'),
        btnCloseModal: $('btnCloseModal'),
        btnCancel: $('btnCancel'),

        // Alert
        alertOverlay: $('alertOverlay'),
        alertMedName: $('alertMedName'),
        alertDosage: $('alertDosage'),
        alertNotes: $('alertNotes'),
        btnDone: $('btnDone'),
        btnSnooze: $('btnSnooze'),
        btnSkip: $('btnSkip'),

        // Confirm
        confirmOverlay: $('confirmOverlay'),
        confirmTitle: $('confirmTitle'),
        confirmMessage: $('confirmMessage'),
        btnConfirmOk: $('btnConfirmOk'),
        btnConfirmCancel: $('btnConfirmCancel'),
    };

    // --- Utility Functions ---

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    function formatTime(date) {
        return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function formatTimeFull(date) {
        return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function padZero(n) {
        return n.toString().padStart(2, '0');
    }

    function formatCountdown(ms) {
        if (ms <= 0) return 'AGORA!';
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}h ${padZero(minutes)}m ${padZero(seconds)}s`;
        }
        return `${padZero(minutes)}m ${padZero(seconds)}s`;
    }

    function todayKey() {
        const d = new Date();
        return `${d.getFullYear()}-${padZero(d.getMonth() + 1)}-${padZero(d.getDate())}`;
    }

    // --- Storage (API + localStorage fallback) ---

    function saveMedicationsLocal() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(medications));
    }

    function saveHistoryLocal() {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }

    function loadMedicationsLocal() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            medications = data ? JSON.parse(data) : [];
        } catch {
            medications = [];
        }
    }

    function loadHistoryLocal() {
        try {
            const data = localStorage.getItem(HISTORY_KEY);
            history = data ? JSON.parse(data) : [];
            const today = todayKey();
            history = history.filter(h => h.date === today);
        } catch {
            history = [];
        }
    }

    // --- API Functions ---

    async function apiGet(endpoint) {
        try {
            const res = await fetch(`/api/${endpoint}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err) {
            console.warn(`API GET /${endpoint} falhou:`, err.message);
            return null;
        }
    }

    async function apiPost(endpoint, data) {
        try {
            const res = await fetch(`/api/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err) {
            console.warn(`API POST /${endpoint} falhou:`, err.message);
            return null;
        }
    }

    async function apiDelete(endpoint) {
        try {
            const res = await fetch(`/api/${endpoint}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err) {
            console.warn(`API DELETE /${endpoint} falhou:`, err.message);
            return null;
        }
    }

    async function syncFromServer() {
        const data = await apiGet('data');
        if (data) {
            medications = data.medications || [];
            const today = todayKey();
            history = (data.history || []).filter(h => h.date === today);
            // Atualizar cache local
            saveMedicationsLocal();
            saveHistoryLocal();
            return true;
        }
        return false;
    }

    async function loadAll() {
        // Carregar do cache local primeiro (rápido)
        loadMedicationsLocal();
        loadHistoryLocal();
        // Depois sincronizar com servidor (pode demorar)
        const synced = await syncFromServer();
        if (synced) {
            renderMedications();
            renderHistory();
        }
    }

    // --- Dose Time Calculation ---

    function getAllDoseTimes(med) {
        const times = [];
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const [firstH, firstM] = med.firstDose.split(':').map(Number);
        let doseTime = new Date(today);
        doseTime.setHours(firstH, firstM, 0, 0);

        // If the first dose for today is before midnight yesterday, adjust
        // Generate times for the full day
        const startOfDay = new Date(today);
        const endOfDay = new Date(today);
        endOfDay.setHours(23, 59, 59, 999);

        // Go backwards from firstDose to find the earliest dose today
        let earliest = new Date(doseTime);
        while (earliest.getTime() - med.interval * 3600000 >= startOfDay.getTime()) {
            earliest = new Date(earliest.getTime() - med.interval * 3600000);
        }

        // Now go forward from earliest to generate all doses for today
        let t = new Date(earliest);
        while (t <= endOfDay) {
            times.push(new Date(t));
            t = new Date(t.getTime() + med.interval * 3600000);
        }

        return times;
    }

    function getNextDoseTime(med) {
        const now = new Date();
        const times = getAllDoseTimes(med);

        // Check if there's a snooze active for this med
        if (snoozeTimers[med.id]) {
            return snoozeTimers[med.id];
        }

        for (const t of times) {
            // Check if this time has been given/skipped today
            const wasHandled = history.some(h =>
                h.medId === med.id &&
                h.time === formatTime(t) &&
                h.date === todayKey()
            );
            if (!wasHandled && t >= new Date(now.getTime() - 60000)) {
                return t;
            }
        }

        // All doses for today are done - show first dose tomorrow
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const [firstH, firstM] = med.firstDose.split(':').map(Number);
        tomorrow.setHours(firstH, firstM, 0, 0);
        return tomorrow;
    }

    function getTimeUntilNextDose(med) {
        const next = getNextDoseTime(med);
        return next.getTime() - Date.now();
    }

    // --- Notifications ---

    function requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    function showBrowserNotification(title, body) {
        if ('Notification' in window && Notification.permission === 'granted') {
            const notif = new Notification(title, {
                body: body,
                icon: '🐾',
                tag: 'di-remedio',
                requireInteraction: true
            });
            notif.onclick = () => {
                window.focus();
                notif.close();
            };
        }
    }

    // --- Alarm Sound System (loud, continuous, like a phone call) ---

    let alarmAudioCtx = null;
    let alarmInterval = null;
    let alarmVibrationInterval = null;
    let alarmGainNode = null;

    function startAlarmSound() {
        stopAlarmSound(); // Limpar qualquer alarme anterior

        try {
            alarmAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            alarmGainNode = alarmAudioCtx.createGain();
            alarmGainNode.connect(alarmAudioCtx.destination);
            alarmGainNode.gain.value = 1.0; // VOLUME MÁXIMO

            function playRingCycle() {
                if (!alarmAudioCtx || alarmAudioCtx.state === 'closed') return;

                // Ciclo 1: tom agudo urgente (BIP BIP BIP)
                for (let i = 0; i < 3; i++) {
                    const osc = alarmAudioCtx.createOscillator();
                    const gain = alarmAudioCtx.createGain();
                    osc.connect(gain);
                    gain.connect(alarmGainNode);

                    osc.type = 'square';
                    osc.frequency.value = 1200; // Tom agudo alto

                    const startTime = alarmAudioCtx.currentTime + i * 0.25;
                    gain.gain.setValueAtTime(0.6, startTime);
                    gain.gain.setValueAtTime(0, startTime + 0.15);
                    gain.gain.setValueAtTime(0, startTime + 0.25);

                    osc.start(startTime);
                    osc.stop(startTime + 0.25);
                }

                // Ciclo 2: tom de alarme (mais grave, urgente)
                const osc2 = alarmAudioCtx.createOscillator();
                const gain2 = alarmAudioCtx.createGain();
                osc2.connect(gain2);
                gain2.connect(alarmGainNode);

                osc2.type = 'sawtooth';
                osc2.frequency.value = 880;

                const t2 = alarmAudioCtx.currentTime + 0.8;
                gain2.gain.setValueAtTime(0.5, t2);
                gain2.gain.exponentialRampToValueAtTime(0.01, t2 + 0.4);

                osc2.start(t2);
                osc2.stop(t2 + 0.4);

                // Ciclo 3: tom alto final
                const osc3 = alarmAudioCtx.createOscillator();
                const gain3 = alarmAudioCtx.createGain();
                osc3.connect(gain3);
                gain3.connect(alarmGainNode);

                osc3.type = 'square';
                osc3.frequency.value = 1400;

                const t3 = alarmAudioCtx.currentTime + 1.3;
                gain3.gain.setValueAtTime(0.6, t3);
                gain3.gain.exponentialRampToValueAtTime(0.01, t3 + 0.3);

                osc3.start(t3);
                osc3.stop(t3 + 0.3);
            }

            // Tocar imediatamente e repetir a cada 2 segundos
            playRingCycle();
            alarmInterval = setInterval(playRingCycle, 2000);

            // Vibração contínua (celular) - vibra forte por 1s, pausa 0.5s, repete
            if ('vibrate' in navigator) {
                function vibrateLoop() {
                    navigator.vibrate([800, 200, 800, 200, 800, 500]);
                }
                vibrateLoop();
                alarmVibrationInterval = setInterval(vibrateLoop, 3500);
            }

        } catch (err) {
            console.error('Erro ao tocar alarme:', err);
        }
    }

    function stopAlarmSound() {
        if (alarmInterval) {
            clearInterval(alarmInterval);
            alarmInterval = null;
        }
        if (alarmVibrationInterval) {
            clearInterval(alarmVibrationInterval);
            alarmVibrationInterval = null;
        }
        if (alarmAudioCtx && alarmAudioCtx.state !== 'closed') {
            try {
                alarmAudioCtx.close();
            } catch { /* ignore */ }
            alarmAudioCtx = null;
        }
        // Parar vibração
        if ('vibrate' in navigator) {
            navigator.vibrate(0);
        }
    }

    // --- Alert Modal (estilo chamada telefônica) ---

    function showAlert(med) {
        if (activeAlertMedId) return; // Já mostrando um alerta

        activeAlertMedId = med.id;
        DOM.alertMedName.textContent = med.name;
        DOM.alertDosage.textContent = `Dosagem: ${med.dosage}`;
        DOM.alertNotes.textContent = med.notes || '';
        DOM.alertOverlay.classList.add('active');

        // INICIAR ALARME ALTO E CONTÍNUO
        startAlarmSound();

        // Notificação do navegador
        showBrowserNotification(
            '🚨 HORA DO REMÉDIO DO DI! 🚨',
            `💊 ${med.name} - ${med.dosage}\n⚠️ ABRA O APP AGORA!`
        );
    }

    function hideAlert() {
        // Marcar horário como dispensado para evitar re-disparo
        if (activeAlertMedId) {
            alertDismissedTimes[activeAlertMedId] = Date.now();
        }

        DOM.alertOverlay.classList.remove('active');
        activeAlertMedId = null;

        // PARAR O ALARME
        stopAlarmSound();
    }

    // --- Confirm Dialog ---

    function showConfirm(title, message, callback) {
        DOM.confirmTitle.textContent = title;
        DOM.confirmMessage.textContent = message;
        confirmCallback = callback;
        DOM.confirmOverlay.classList.add('active');
    }

    function hideConfirm() {
        DOM.confirmOverlay.classList.remove('active');
        confirmCallback = null;
    }

    // --- Toast ---

    function showToast(message, type = 'success') {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `${type === 'success' ? '✅' : type === 'info' ? 'ℹ️' : '⚠️'} ${message}`;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'toastOut 0.4s ease-out forwards';
            setTimeout(() => toast.remove(), 400);
        }, 3000);
    }

    // --- Render Functions ---

    function renderStatusCards() {
        DOM.totalMeds.textContent = medications.length;

        // Find nearest next dose
        if (medications.length > 0) {
            let nearestTime = Infinity;
            let nearestMed = null;
            medications.forEach(med => {
                const timeUntil = getTimeUntilNextDose(med);
                if (timeUntil < nearestTime) {
                    nearestTime = timeUntil;
                    nearestMed = med;
                }
            });
            if (nearestMed) {
                const nextDose = getNextDoseTime(nearestMed);
                DOM.nextTime.textContent = formatTime(nextDose);
            }
        } else {
            DOM.nextTime.textContent = '--:--';
        }

        // Count today's doses
        const todayDoses = history.filter(h => h.date === todayKey() && h.status === 'given').length;
        DOM.totalDone.textContent = todayDoses;
    }

    function renderMedCard(med) {
        const nextDose = getNextDoseTime(med);
        const timeUntil = nextDose.getTime() - Date.now();
        const allTimes = getAllDoseTimes(med);

        let countdownClass = '';
        let nextDoseClass = '';
        let cardUrgent = '';

        if (timeUntil <= 0) {
            countdownClass = 'soon';
            nextDoseClass = 'now';
            cardUrgent = 'urgent';
        } else if (timeUntil <= 30 * 60 * 1000) {
            countdownClass = 'soon';
            nextDoseClass = 'soon';
        }

        const timeBadges = allTimes.map(t => {
            const timeStr = formatTime(t);
            const wasGiven = history.some(h => h.medId === med.id && h.time === timeStr && h.date === todayKey() && h.status === 'given');
            const wasSkipped = history.some(h => h.medId === med.id && h.time === timeStr && h.date === todayKey() && h.status === 'skipped');
            const isNext = !wasGiven && !wasSkipped && t.getTime() === nextDose.getTime();

            let badgeClass = 'med-time-badge';
            if (wasGiven) badgeClass += ' done';
            else if (isNext) badgeClass += ' active';

            return `<span class="${badgeClass}">${timeStr}${wasGiven ? ' ✓' : wasSkipped ? ' ⏭' : ''}</span>`;
        }).join('');

        const card = document.createElement('div');
        card.className = `med-card ${cardUrgent}`;
        card.setAttribute('data-color', med.color);
        card.setAttribute('data-id', med.id);

        card.innerHTML = `
            <div class="med-card-header">
                <div>
                    <div class="med-name">${escapeHtml(med.name)}</div>
                    <div class="med-dosage">${escapeHtml(med.dosage)}</div>
                </div>
                <div class="med-card-actions">
                    <button class="btn-edit" title="Editar" data-id="${med.id}" aria-label="Editar ${med.name}">✏️</button>
                    <button class="btn-delete" title="Remover" data-id="${med.id}" aria-label="Remover ${med.name}">🗑️</button>
                </div>
            </div>
            <div class="med-schedule">
                <div class="med-schedule-row">
                    <span class="med-schedule-label">Intervalo</span>
                    <span class="med-schedule-value">A cada ${med.interval}h</span>
                </div>
                <div class="med-schedule-row">
                    <span class="med-schedule-label">Próxima Dose</span>
                    <span class="med-schedule-value med-next-dose ${nextDoseClass}">${formatTime(nextDose)}</span>
                </div>
            </div>
            <div class="med-countdown ${countdownClass}" data-med-id="${med.id}">
                ${timeUntil <= 0 ? '⚡ É HORA! Dê o remédio agora!' : `⏳ Faltam ${formatCountdown(timeUntil)}`}
            </div>
            <div class="med-times-list">${timeBadges}</div>
            ${med.notes ? `<div class="med-notes">📝 ${escapeHtml(med.notes)}</div>` : ''}
            ${med.duration ? `<div class="med-notes">📅 Tratamento: ${med.duration} dias</div>` : ''}
            <button class="btn-give-dose" data-id="${med.id}">💊 Marcar Dose como Dada</button>
        `;

        return card;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function renderMedications() {
        DOM.medsGrid.innerHTML = '';

        if (medications.length === 0) {
            DOM.emptyState.style.display = 'block';
            DOM.medsGrid.style.display = 'none';
        } else {
            DOM.emptyState.style.display = 'none';
            DOM.medsGrid.style.display = 'grid';

            // Sort by next dose time (most urgent first)
            const sorted = [...medications].sort((a, b) => {
                return getTimeUntilNextDose(a) - getTimeUntilNextDose(b);
            });

            sorted.forEach(med => {
                DOM.medsGrid.appendChild(renderMedCard(med));
            });
        }

        renderStatusCards();
    }

    function renderHistory() {
        const today = todayKey();
        const todayHistory = history.filter(h => h.date === today);

        if (todayHistory.length === 0) {
            DOM.historyList.innerHTML = '';
            DOM.historyList.appendChild(DOM.emptyHistory || createEmptyHistory());
            return;
        }

        DOM.historyList.innerHTML = '';

        // Sort by time, most recent first
        todayHistory.sort((a, b) => b.timestamp - a.timestamp);

        todayHistory.forEach(h => {
            const item = document.createElement('div');
            item.className = 'history-item';
            item.innerHTML = `
                <span class="history-time">${h.time}</span>
                <div class="history-divider" data-color="${h.color}"></div>
                <div class="history-info">
                    <div class="history-med-name">${escapeHtml(h.medName)}</div>
                    <div class="history-dosage">${escapeHtml(h.dosage)}</div>
                </div>
                <span class="history-status ${h.status}">${h.status === 'given' ? 'Dada' : 'Pulada'}</span>
            `;
            DOM.historyList.appendChild(item);
        });
    }

    function createEmptyHistory() {
        const div = document.createElement('div');
        div.className = 'empty-state-small';
        div.id = 'emptyHistory';
        div.innerHTML = '<p>Nenhuma dose administrada hoje</p>';
        return div;
    }

    // --- Update Countdowns (runs every second) ---

    function updateCountdowns() {
        medications.forEach(med => {
            const el = document.querySelector(`[data-med-id="${med.id}"]`);
            if (!el) return;

            const nextDose = getNextDoseTime(med);
            const timeUntil = nextDose.getTime() - Date.now();

            if (timeUntil <= 0) {
                el.textContent = '⚡ É HORA! Dê o remédio agora!';
                el.className = 'med-countdown soon';

                // Trigger alert if within 1 minute window
                if (timeUntil > -60000 && !activeAlertMedId) {
                    // Verificar se já foi dispensado recentemente (evitar re-disparo)
                    const recentlyDismissed = alertDismissedTimes[med.id] && 
                        (Date.now() - alertDismissedTimes[med.id]) < 120000; // 2 minutos de proteção
                    
                    if (!recentlyDismissed) {
                        const wasHandled = history.some(h =>
                            h.medId === med.id &&
                            h.time === formatTime(nextDose) &&
                            h.date === todayKey()
                        );
                        if (!wasHandled) {
                            showAlert(med);
                        }
                    }
                }
            } else {
                el.textContent = `⏳ Faltam ${formatCountdown(timeUntil)}`;
                el.className = timeUntil <= 30 * 60 * 1000 ? 'med-countdown soon' : 'med-countdown';
            }
        });

        renderStatusCards();
    }

    // --- Clock ---

    function updateClock() {
        DOM.headerClock.textContent = formatTimeFull(new Date());
    }

    // --- Modal Functions ---

    function openModal(editMed = null) {
        if (editMed) {
            DOM.modalTitle.textContent = 'Editar Remédio';
            DOM.medId.value = editMed.id;
            DOM.medName.value = editMed.name;
            DOM.medDosage.value = editMed.dosage;
            DOM.medInterval.value = editMed.interval;
            DOM.medFirstDose.value = editMed.firstDose;
            DOM.medDuration.value = editMed.duration || '';
            DOM.medNotes.value = editMed.notes || '';

            // Set color
            document.querySelectorAll('.color-option').forEach(btn => {
                btn.classList.toggle('selected', btn.dataset.color === editMed.color);
            });
        } else {
            DOM.modalTitle.textContent = 'Adicionar Remédio';
            DOM.medForm.reset();
            DOM.medId.value = '';

            // Set default first dose to current time
            const now = new Date();
            DOM.medFirstDose.value = `${padZero(now.getHours())}:${padZero(now.getMinutes())}`;

            // Reset color to blue
            document.querySelectorAll('.color-option').forEach(btn => {
                btn.classList.toggle('selected', btn.dataset.color === 'blue');
            });
        }

        DOM.modalOverlay.classList.add('active');
        setTimeout(() => DOM.medName.focus(), 300);
    }

    function closeModal() {
        DOM.modalOverlay.classList.remove('active');
    }

    function getSelectedColor() {
        const selected = document.querySelector('.color-option.selected');
        return selected ? selected.dataset.color : 'blue';
    }

    // --- CRUD Operations ---

    async function addMedication(medData) {
        medications.push(medData);
        saveMedicationsLocal();
        renderMedications();
        renderHistory();
        showToast(`${medData.name} adicionado com sucesso!`);
        // Sincronizar com servidor
        await apiPost('medications', medData);
        scheduleSwNotifications();
    }

    async function updateMedication(id, medData) {
        const index = medications.findIndex(m => m.id === id);
        if (index !== -1) {
            medications[index] = { ...medications[index], ...medData };
            saveMedicationsLocal();
            renderMedications();
            showToast(`${medData.name} atualizado!`);
            // Sincronizar com servidor
            await apiPost('medications', medications[index]);
            scheduleSwNotifications();
        }
    }

    function deleteMedication(id) {
        const med = medications.find(m => m.id === id);
        if (!med) return;

        showConfirm(
            'Remover Remédio',
            `Tem certeza que deseja remover "${med.name}" da lista?`,
            async () => {
                medications = medications.filter(m => m.id !== id);
                saveMedicationsLocal();
                renderMedications();
                showToast(`${med.name} removido.`, 'info');
                // Sincronizar com servidor
                await apiDelete(`medications/${id}`);
                scheduleSwNotifications();
            }
        );
    }

    async function recordDose(medId, time, status) {
        const med = medications.find(m => m.id === medId);
        if (!med) return;

        const record = {
            medId: med.id,
            medName: med.name,
            dosage: med.dosage,
            color: med.color,
            time: time || formatTime(new Date()),
            date: todayKey(),
            status: status, // 'given' or 'skipped'
            timestamp: Date.now()
        };

        history.push(record);
        saveHistoryLocal();
        renderHistory();
        renderMedications();

        if (status === 'given') {
            showToast(`Dose de ${med.name} registrada! 🎉`);
        } else {
            showToast(`Dose de ${med.name} pulada.`, 'warning');
        }
        // Sincronizar com servidor
        await apiPost('history', record);
        scheduleSwNotifications();
    }

    // --- Event Handlers ---

    function setupEventListeners() {
        // Add medication button
        DOM.btnAddMed.addEventListener('click', () => openModal());

        // Close modal
        DOM.btnCloseModal.addEventListener('click', closeModal);
        DOM.btnCancel.addEventListener('click', closeModal);
        DOM.modalOverlay.addEventListener('click', (e) => {
            if (e.target === DOM.modalOverlay) closeModal();
        });

        // Form submit
        DOM.medForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const medData = {
                name: DOM.medName.value.trim(),
                dosage: DOM.medDosage.value.trim(),
                interval: parseInt(DOM.medInterval.value),
                firstDose: DOM.medFirstDose.value,
                duration: DOM.medDuration.value ? parseInt(DOM.medDuration.value) : null,
                notes: DOM.medNotes.value.trim(),
                color: getSelectedColor(),
            };

            const editId = DOM.medId.value;
            if (editId) {
                updateMedication(editId, medData);
            } else {
                medData.id = generateId();
                medData.createdAt = Date.now();
                addMedication(medData);
            }

            closeModal();
        });

        // Color picker
        DOM.colorPicker.addEventListener('click', (e) => {
            const btn = e.target.closest('.color-option');
            if (!btn) return;
            document.querySelectorAll('.color-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });

        // Medication card actions (delegation)
        DOM.medsGrid.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.btn-edit');
            const deleteBtn = e.target.closest('.btn-delete');
            const doseBtn = e.target.closest('.btn-give-dose');

            if (editBtn) {
                const med = medications.find(m => m.id === editBtn.dataset.id);
                if (med) openModal(med);
            }

            if (deleteBtn) {
                deleteMedication(deleteBtn.dataset.id);
            }

            if (doseBtn) {
                const med = medications.find(m => m.id === doseBtn.dataset.id);
                if (med) {
                    const nextDose = getNextDoseTime(med);
                    recordDose(med.id, formatTime(nextDose), 'given');
                }
            }
        });

        // Alert actions - com proteção contra re-disparo
        DOM.btnDone.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            console.log('🐾 Botão DOSE ADMINISTRADA clicado');
            if (activeAlertMedId) {
                const medId = activeAlertMedId;
                const med = medications.find(m => m.id === medId);
                // PRIMEIRO: parar o alarme e fechar
                hideAlert();
                // DEPOIS: registrar a dose
                if (med) {
                    const nextDose = getNextDoseTime(med);
                    recordDose(med.id, formatTime(nextDose), 'given');
                }
                delete snoozeTimers[medId];
            }
        });

        DOM.btnSnooze.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            console.log('🐾 Botão SNOOZE clicado');
            if (activeAlertMedId) {
                const medId = activeAlertMedId;
                // PRIMEIRO: parar o alarme e fechar
                const snoozeTime = new Date(Date.now() + 5 * 60 * 1000);
                snoozeTimers[medId] = snoozeTime;
                hideAlert();
                showToast('⏰ Lembrete configurado para 5 minutos.', 'info');
                renderMedications();
            }
        });

        DOM.btnSkip.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            console.log('🐾 Botão PULAR clicado');
            if (activeAlertMedId) {
                const medId = activeAlertMedId;
                const med = medications.find(m => m.id === medId);
                // PRIMEIRO: parar o alarme e fechar
                hideAlert();
                // DEPOIS: registrar como pulada
                if (med) {
                    const nextDose = getNextDoseTime(med);
                    recordDose(med.id, formatTime(nextDose), 'skipped');
                }
                delete snoozeTimers[medId];
            }
        });

        // Confirm dialog
        DOM.btnConfirmOk.addEventListener('click', () => {
            if (confirmCallback) confirmCallback();
            hideConfirm();
        });

        DOM.btnConfirmCancel.addEventListener('click', hideConfirm);
        DOM.confirmOverlay.addEventListener('click', (e) => {
            if (e.target === DOM.confirmOverlay) hideConfirm();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (DOM.alertOverlay.classList.contains('active')) {
                    // Don't dismiss alert with Escape
                } else if (DOM.confirmOverlay.classList.contains('active')) {
                    hideConfirm();
                } else if (DOM.modalOverlay.classList.contains('active')) {
                    closeModal();
                }
            }
        });

        // Request notification permission on first interaction
        document.addEventListener('click', () => {
            requestNotificationPermission();
        }, { once: true });
    }

    // --- Check for expired medications ---

    function checkExpiredTreatments() {
        const now = Date.now();
        medications.forEach(med => {
            if (med.duration && med.createdAt) {
                const expiresAt = med.createdAt + med.duration * 24 * 3600 * 1000;
                if (now > expiresAt) {
                    showToast(`Tratamento de ${med.name} pode ter finalizado! Verifique com o veterinário.`, 'warning');
                }
            }
        });
    }

    // --- Web Push & Service Worker ---

    // Função utilitária para converter a chave VAPID
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/\-/g, '+')
            .replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    async function registerServiceWorker() {
        if ('serviceWorker' in navigator && 'PushManager' in window) {
            try {
                swRegistration = await navigator.serviceWorker.register('/sw.js');
                console.log('🐾 Service Worker registrado com sucesso!');

                // Pedir permissão de notificação
                if (Notification.permission === 'default') {
                    const permission = await Notification.requestPermission();
                    if (permission === 'granted') {
                        showToast('🔔 Notificações ativadas!', 'success');
                        await subscribeToWebPush();
                    }
                } else if (Notification.permission === 'granted') {
                    await subscribeToWebPush();
                }
            } catch (err) {
                console.error('Erro ao registrar Service Worker ou Push:', err);
            }
        }
    }

    async function subscribeToWebPush() {
        if (!swRegistration) return;
        
        try {
            // Pegar a chave pública do servidor
            const response = await fetch(`${API_BASE_URL}/api/vapidPublicKey`);
            if (!response.ok) return;
            const vapidPublicKey = await response.text();
            
            const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);
            
            // Fazer a inscrição no navegador
            const subscription = await swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: convertedVapidKey
            });
            
            // Enviar a inscrição para o nosso backend
            await fetch(`${API_BASE_URL}/api/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(subscription)
            });
            console.log('✅ Inscrito com sucesso no Web Push!');
        } catch (err) {
            console.error('Erro ao assinar Web Push:', err);
        }
    }

    function scheduleSwNotifications() {
        // Agora quem cuida das notificações é o Servidor na Nuvem via Push.
        // O navegador não precisa mais agendar nada localmente.
        console.log('Notificações agora são gerenciadas na nuvem!');
    }

    function setupSwMessageListener() {
        if (!navigator.serviceWorker) return;
        
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'ACTION_DONE') {
                const med = medications.find(m => m.id === event.data.medId);
                if (med) {
                    const nextDose = getNextDoseTime(med);
                    recordDose(med.id, formatTime(nextDose), 'given');
                }
                hideAlert(); // Ocultar o alerta visual caso esteja aberto
            } else if (event.data && event.data.type === 'ACTION_SNOOZE') {
                const snoozeTime = new Date(Date.now() + 5 * 60 * 1000);
                snoozeTimers[event.data.medId] = snoozeTime;
                showToast('⏰ Lembrete configurado para 5 minutos.', 'info');
                renderMedications();
                hideAlert();
            }
        });
    }

    // --- Initialization ---

    async function init() {
        // Carregar dados do cache local (rápido) + servidor (sync)
        await loadAll();
        setupEventListeners();
        renderMedications();
        renderHistory();
        updateClock();
        checkExpiredTreatments();

        // Registrar Service Worker para notificações em background
        await registerServiceWorker();
        setupSwMessageListener();

        // Agendar notificações após SW estar pronto
        if (swRegistration) {
            navigator.serviceWorker.ready.then(() => {
                scheduleSwNotifications();
            });
        }

        // Update clock every second
        clockInterval = setInterval(updateClock, 1000);

        // Update countdowns every second
        checkInterval = setInterval(() => {
            updateCountdowns();
        }, 1000);

        // Sincronizar com servidor a cada 30 segundos
        // (para receber mudanças feitas em outro dispositivo)
        setInterval(async () => {
            const synced = await syncFromServer();
            if (synced) {
                renderMedications();
                renderHistory();
                scheduleSwNotifications();
            }
        }, 30 * 1000);

        console.log('🐾 Remédios do Di - Aplicação iniciada!');
    }

    // Start the app
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
