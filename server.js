const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(bodyParser.json());
// Serve static files from the same directory
app.use(express.static(__dirname));

// --- Database Helpers ---
function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            return { medications: [], history: [], subscriptions: [], vapidKeys: null };
        }
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
        return { medications: [], history: [], subscriptions: [], vapidKeys: null };
    }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- Init Data & VAPID Keys ---
let data = loadData();
if (!data.subscriptions) data.subscriptions = [];

// Gerar chaves VAPID automaticamente se não existirem
if (!data.vapidKeys) {
    console.log("Gerando novas chaves VAPID para Web Push...");
    const vapidKeys = webpush.generateVAPIDKeys();
    data.vapidKeys = vapidKeys;
    saveData(data);
}

// Configurar web-push
webpush.setVapidDetails(
    'mailto:felipe@example.com',
    data.vapidKeys.publicKey,
    data.vapidKeys.privateKey
);

// --- REST API Endpoints ---

// Obter todos os dados
app.get('/api/data', (req, res) => {
    const currentData = loadData();
    res.json(currentData);
});

// Adicionar/Atualizar medicamento
app.post('/api/medications', (req, res) => {
    const medData = req.body;
    const currentData = loadData();
    
    const index = currentData.medications.findIndex(m => m.id === medData.id);
    if (index !== -1) {
        currentData.medications[index] = medData;
    } else {
        currentData.medications.push(medData);
    }
    
    saveData(currentData);
    res.json({ success: true });
});

// Deletar medicamento
app.delete('/api/medications/:id', (req, res) => {
    const { id } = req.params;
    const currentData = loadData();
    currentData.medications = currentData.medications.filter(m => m.id !== id);
    saveData(currentData);
    res.json({ success: true });
});

// Adicionar histórico (dado/pulado)
app.post('/api/history', (req, res) => {
    const record = req.body;
    const currentData = loadData();
    currentData.history.push(record);
    saveData(currentData);
    res.json({ success: true });
});

// --- Web Push Endpoints ---

// Obter chave pública VAPID para o frontend
app.get('/api/vapidPublicKey', (req, res) => {
    res.send(data.vapidKeys.publicKey);
});

// Salvar inscrição do navegador
app.post('/api/subscribe', (req, res) => {
    const subscription = req.body;
    const currentData = loadData();
    
    // Evitar inscrições duplicadas
    const exists = currentData.subscriptions.some(
        sub => sub.endpoint === subscription.endpoint
    );
    
    if (!exists) {
        currentData.subscriptions.push(subscription);
        saveData(currentData);
        console.log("Nova inscrição Push recebida!");
    }
    
    res.status(201).json({});
});

// --- Push Notification Scheduler (Cron) ---

function getTodayKey() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

function formatTime(dateObj) {
    const h = String(dateObj.getHours()).padStart(2, '0');
    const m = String(dateObj.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

// Verifica de hora em hora/minuto em minuto se tem remédio agora
cron.schedule('* * * * *', () => {
    const currentData = loadData();
    const now = new Date();
    
    currentData.medications.forEach(med => {
        // Encontrar o próximo horário usando a mesma lógica do frontend
        const [firstH, firstM] = med.firstDose.split(':').map(Number);
        let doseTime = new Date(now);
        doseTime.setHours(firstH, firstM, 0, 0);
        
        let t = new Date(doseTime);
        let dosesToday = [];
        // Lógica simplificada: gerar doses até agora
        while (t <= new Date(now.getTime() + 60000)) {
            // Se estivermos dentro da janela de 1 minuto da dose
            const diffMs = t.getTime() - now.getTime();
            
            // Se for exatamente a hora (diferença entre -60s e +60s)
            if (diffMs > -60000 && diffMs <= 60000) {
                // Verificar se já foi dado
                const wasHandled = currentData.history.some(h => 
                    h.medId === med.id && 
                    h.time === formatTime(t) && 
                    h.date === getTodayKey()
                );
                
                if (!wasHandled) {
                    console.log(`⏰ Disparando PUSH para ${med.name}`);
                    
                    const payload = JSON.stringify({
                        title: `🚨 HORA DO REMÉDIO: ${med.name} 🚨`,
                        body: `💊 ${med.dosage}${med.notes ? '\\n📝 ' + med.notes : ''}\\n⚠️ ABRA O APP AGORA!`,
                        medId: med.id,
                        medName: med.name,
                        dosage: med.dosage
                    });
                    
                    currentData.subscriptions.forEach(sub => {
                        webpush.sendNotification(sub, payload).catch(err => {
                            // Se a inscrição estiver expirada, removemos
                            if (err.statusCode === 410 || err.statusCode === 404) {
                                console.log("Removendo inscrição expirada.");
                                const updatedData = loadData();
                                updatedData.subscriptions = updatedData.subscriptions.filter(s => s.endpoint !== sub.endpoint);
                                saveData(updatedData);
                            } else {
                                console.error("Erro ao enviar push:", err);
                            }
                        });
                    });
                }
            }
            
            t = new Date(t.getTime() + med.interval * 3600000);
        }
    });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║     🐾 Remédios do Di - Node.js Server 🐾        ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║  Servidor rodando na porta ${PORT}                  ║
║  Pronto para ser hospedado no Glitch/Render!     ║
║                                                  ║
╚══════════════════════════════════════════════════╝
    `);
});
