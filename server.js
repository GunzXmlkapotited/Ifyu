// server.js - My Duit Payment System with Supabase (Single Table)
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = 13898;
const SECRET_KEY = 'oceanPaymentSecretKey2024';

// ============================================
// KONFIGURASI SUPABASE
// ============================================
const SUPABASE_URL = 'https://ousvifkyifrulfhiklso.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_uWMARDJoJ8O5OwXJVhK-VQ_RU66Sg_2';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ============================================
// KONFIGURASI MYDUIT
// ============================================
let MYDUIT_CONFIG = {
    API_KEY: 'Myd_4ff69c63499342ae',
    BASE_URL: 'https://app.myduit.web.id/api'
};

// ============================================
// CACHE & DATA (Semua data disimpan di tabel users)
// ============================================
const JSONBIN_CACHE_FILE = path.join(__dirname, '.jsonbin-cache.json');

let users = [];
let dataLoaded = false;

// ============================================
// FUNGSI SUPABASE CRUD (Hanya 1 Tabel)
// ============================================

// --- READ ALL DATA ---
async function readFromSupabase() {
    try {
        console.log('📡 Reading data from Supabase...');
        
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .order('id', { ascending: true });

        if (error) throw error;

        console.log('✅ Data loaded from Supabase');
        return {
            users: data || [],
            lastUpdated: new Date().toISOString()
        };
    } catch (error) {
        console.error('❌ Error reading from Supabase:', error.message);
        return null;
    }
}

// --- WRITE ALL DATA ---
async function writeToSupabase(data) {
    try {
        console.log('📡 Writing data to Supabase...');
        
        // Hapus data lama
        await supabase.from('users').delete().neq('id', 0);

        // Insert data baru
        if (data.users?.length > 0) {
            const { error } = await supabase.from('users').insert(data.users);
            if (error) throw error;
        }

        console.log('✅ Data written to Supabase');
        return true;
    } catch (error) {
        console.error('❌ Error writing to Supabase:', error.message);
        return false;
    }
}

// --- SAVE USER (Single) ---
async function saveUser(user) {
    try {
        // Cek apakah user sudah ada
        const { data: existing } = await supabase
            .from('users')
            .select('id')
            .eq('username', user.username)
            .single();

        if (existing) {
            // Update
            const { error } = await supabase
                .from('users')
                .update(user)
                .eq('username', user.username);
            if (error) throw error;
        } else {
            // Insert
            const { error } = await supabase
                .from('users')
                .insert([user]);
            if (error) throw error;
        }
        return true;
    } catch (error) {
        console.error('Error saving user:', error.message);
        return false;
    }
}

// --- UPDATE BALANCE ---
async function updateBalance(username, newBalance) {
    try {
        const { error } = await supabase
            .from('users')
            .update({ balance: newBalance })
            .eq('username', username);
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('Error updating balance:', error.message);
        return false;
    }
}

// --- UPDATE USER DATA (untuk menyimpan data tambahan) ---
async function updateUserData(username, dataField) {
    try {
        // Ambil data user saat ini
        const { data: user, error: fetchError } = await supabase
            .from('users')
            .select('data')
            .eq('username', username)
            .single();
            
        if (fetchError) throw fetchError;
        
        // Merge data
        const currentData = user?.data || {};
        const mergedData = { ...currentData, ...dataField };
        
        const { error } = await supabase
            .from('users')
            .update({ data: mergedData })
            .eq('username', username);
            
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('Error updating user data:', error.message);
        return false;
    }
}

// --- GET USER DATA ---
async function getUserData(username) {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('data')
            .eq('username', username)
            .single();
            
        if (error) throw error;
        return data?.data || {};
    } catch (error) {
        console.error('Error getting user data:', error.message);
        return {};
    }
}

// --- CACHE FUNCTIONS ---
function saveToCache(data) {
    try {
        fs.writeFileSync(JSONBIN_CACHE_FILE, JSON.stringify({
            data: data,
            timestamp: new Date().toISOString()
        }, null, 2));
    } catch (error) {
        console.error('Error saving cache:', error.message);
    }
}

function readFromCache() {
    try {
        if (fs.existsSync(JSONBIN_CACHE_FILE)) {
            const cache = JSON.parse(fs.readFileSync(JSONBIN_CACHE_FILE, 'utf8'));
            console.log('📂 Using cached data from:', cache.timestamp);
            return cache.data || {};
        }
    } catch (error) {
        console.error('Error reading cache:', error.message);
    }
    return {};
}

function initDataStructure() {
    return {
        users: [],
        lastUpdated: new Date().toISOString()
    };
}

// ============================================
// AUTO-RESTORE
// ============================================
async function autoRestoreData() {
    try {
        console.log('🔄 Auto-restore: Loading data from Supabase...');
        
        const data = await readFromSupabase();
        
        if (!data || !data.users || data.users.length === 0) {
            console.log('⚠️ Data kosong, membuat struktur baru...');
            const newData = initDataStructure();
            await writeToSupabase(newData);
            
            users = newData.users;
        } else {
            users = data.users || [];
        }
        
        dataLoaded = true;
        
        console.log('✅ Auto-restore completed!');
        console.log(`   👤 Users: ${users.length}`);
        console.log(`   🕐 Last Updated: ${data?.lastUpdated || 'N/A'}`);
        
        await createDefaultAdmin();
        await checkAndSyncLocalData();
        
        return true;
    } catch (error) {
        console.error('❌ Auto-restore failed:', error.message);
        console.log('📂 Using local cache...');
        
        const cacheData = readFromCache();
        if (cacheData.users) {
            users = cacheData.users || [];
            dataLoaded = true;
            console.log('✅ Data restored from local cache');
        } else {
            const newData = initDataStructure();
            users = newData.users;
            dataLoaded = true;
            console.log('🆕 New data structure initialized');
        }
        
        await createDefaultAdmin();
        return false;
    }
}

async function checkAndSyncLocalData() {
    try {
        const localFiles = ['users.json'];
        let hasLocalData = false;
        
        for (const file of localFiles) {
            const filePath = path.join(__dirname, file);
            if (fs.existsSync(filePath)) {
                hasLocalData = true;
                break;
            }
        }
        
        if (hasLocalData) {
            console.log('📂 Found local data files, syncing to Supabase...');
            await syncLocalDataToSupabase();
        }
    } catch (error) {
        console.error('Error checking local data:', error.message);
    }
}

async function syncLocalDataToSupabase() {
    try {
        const filePath = path.join(__dirname, 'users.json');
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(content);
            const localUsers = Array.isArray(parsed) ? parsed : (parsed.users || []);
            console.log(`📂 Loaded ${localUsers.length} users from users.json`);
            
            if (localUsers.length > 0 && users.length === 0) {
                console.log('🔄 Syncing local data to Supabase...');
                const mergedUsers = mergeData(users, localUsers, 'username');
                const mergedData = {
                    users: mergedUsers,
                    lastUpdated: new Date().toISOString()
                };
                
                await writeToSupabase(mergedData);
                users = mergedData.users;
                console.log('✅ Local data synced to Supabase');
            }
        }
    } catch (error) {
        console.error('Error syncing local data:', error.message);
    }
}

function mergeData(existingData, newData, idField) {
    const merged = [...existingData];
    const existingIds = new Set(merged.map(item => item[idField]));
    
    for (const item of newData) {
        if (!existingIds.has(item[idField])) {
            merged.push(item);
        }
    }
    
    return merged;
}

async function saveAllData() {
    try {
        const data = {
            users,
            lastUpdated: new Date().toISOString()
        };
        
        await writeToSupabase(data);
        saveToCache(data);
        console.log('✅ Data auto-saved to Supabase');
        return true;
    } catch (error) {
        console.error('❌ Error auto-saving data:', error.message);
        saveToCache({ users });
        return false;
    }
}

// ============================================
// CREATE DEFAULT ADMIN
// ============================================
async function createDefaultAdmin() {
    try {
        const adminExists = users.find(u => u.username === 'admin');
        
        if (!adminExists) {
            console.log('👤 Creating default admin user...');
            
            const hashedPassword = await bcrypt.hash('adminnyduitpayment', 10);
            
            const adminUser = {
                id: users.length + 1,
                username: 'admin',
                email: 'admin@oceanpayment.com',
                password: hashedPassword,
                balance: 0,
                role: 'admin',
                is_active: true,
                created_at: new Date().toISOString(),
                last_login: null,
                data: {
                    transactions: [],
                    withdraws: [],
                    apiKeys: []
                }
            };
            
            users.push(adminUser);
            await saveAllData();
            
            console.log('✅ Default admin created!');
            console.log('   👤 Username: admin');
            console.log('   🔑 Password: adminnyduitpayment');
            console.log('   👑 Role: admin');
            console.log(`   🔗 Access: http://localhost:${PORT}/admin`);
        } else {
            if (adminExists.role !== 'admin') {
                adminExists.role = 'admin';
                await saveAllData();
                console.log('⬆️ Existing user "admin" upgraded to admin role');
            } else {
                console.log('✅ Admin user already exists');
            }
        }
    } catch (error) {
        console.error('❌ Error creating default admin:', error.message);
    }
}

// ============================================
// KONFIGURASI WITHDRAW & TOPUP
// ============================================
const WITHDRAW_METHODS = [
    { id: 'dana', name: 'DANA', type: 'ewallet', icon: 'Dana', placeholder: 'Nomor DANA' },
    { id: 'gopay', name: 'GoPay', type: 'ewallet', icon: 'GoPay', placeholder: 'Nomor GoPay' },
    { id: 'ovo', name: 'OVO', type: 'ewallet', icon: 'OVO', placeholder: 'Nomor OVO' }
];

const TOPUP_PACKAGES = [
    { id: '1k', nominal: 1000, label: 'Rp 1.000' },
    { id: '5k', nominal: 5000, label: 'Rp 5.000' },
    { id: '10k', nominal: 10000, label: 'Rp 10.000' },
    { id: '15k', nominal: 15000, label: 'Rp 15.000' },
    { id: '20k', nominal: 20000, label: 'Rp 20.000' },
    { id: '30k', nominal: 30000, label: 'Rp 30.000' },
    { id: '40k', nominal: 40000, label: 'Rp 40.000' },
    { id: '50k', nominal: 50000, label: 'Rp 50.000' },
    { id: '75k', nominal: 75000, label: 'Rp 75.000' },
    { id: '100k', nominal: 100000, label: 'Rp 100.000' },
    { id: '150k', nominal: 150000, label: 'Rp 150.000' },
    { id: '200k', nominal: 200000, label: 'Rp 200.000' },
];

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

const ensureDataLoaded = async (req, res, next) => {
    if (!dataLoaded) {
        await autoRestoreData();
    }
    next();
};

app.use(ensureDataLoaded);

function generateApiKey() {
    return 'op_' + crypto.randomBytes(32).toString('hex');
}

// ============================================
// MIDDLEWARE - Validasi API Key
// ============================================
const validateApiKey = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    
    if (!apiKey) {
        return res.status(401).json({ 
            success: false, 
            error: 'API Key diperlukan. Gunakan header X-API-Key atau parameter api_key' 
        });
    }
    
    // Cari user yang memiliki API key di data mereka
    let foundUser = null;
    let foundKey = null;
    
    for (const user of users) {
        const userData = user.data || {};
        const apiKeys = userData.apiKeys || [];
        const keyData = apiKeys.find(k => k.key === apiKey && k.is_active !== false);
        if (keyData) {
            foundUser = user;
            foundKey = keyData;
            break;
        }
    }
    
    if (!foundUser || !foundKey) {
        return res.status(401).json({ 
            success: false, 
            error: 'API Key tidak valid atau sudah dinonaktifkan' 
        });
    }
    
    foundKey.last_used = new Date().toISOString();
    await updateUserData(foundUser.username, { apiKeys: foundUser.data?.apiKeys || [] });
    await saveAllData();
    
    req.apiKey = foundKey;
    req.apiUser = foundUser;
    next();
};

const validateToken = (token) => {
    if (!token) return null;
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const user = users.find(u => u.username === decoded.username);
        if (!user) return null;
        return decoded;
    } catch (error) {
        return null;
    }
};

const requireAuth = (req, res, next) => {
    const token = req.cookies.token;
    const decoded = validateToken(token);
    
    if (!decoded) {
        res.clearCookie('token');
        return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
    }
    
    req.user = decoded;
    next();
};

const redirectIfNotLoggedIn = (req, res, next) => {
    const token = req.cookies.token;
    const decoded = validateToken(token);
    
    if (!decoded) {
        res.clearCookie('token');
        return res.redirect('/about');
    }
    
    req.user = decoded;
    next();
};

const redirectIfLoggedIn = (req, res, next) => {
    const token = req.cookies.token;
    const decoded = validateToken(token);
    
    if (decoded) {
        return res.redirect('/dashboard');
    }
    
    next();
};

// ============================================
// ADMIN MIDDLEWARE
// ============================================
const requireAdmin = (req, res, next) => {
    const token = req.cookies.token;
    const decoded = validateToken(token);
    
    if (!decoded) {
        res.clearCookie('token');
        return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
    }
    
    const user = users.find(u => u.username === decoded.username);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Akses ditolak. Hanya admin yang diizinkan' });
    }
    
    req.user = decoded;
    next();
};

// ============================================
// HELPER FUNCTIONS untuk akses data user
// ============================================
function getUserTransactions(username) {
    const user = users.find(u => u.username === username);
    if (!user) return [];
    return user.data?.transactions || [];
}

function getUserWithdraws(username) {
    const user = users.find(u => u.username === username);
    if (!user) return [];
    return user.data?.withdraws || [];
}

function getUserApiKeys(username) {
    const user = users.find(u => u.username === username);
    if (!user) return [];
    return user.data?.apiKeys || [];
}

async function addUserTransaction(username, transaction) {
    const user = users.find(u => u.username === username);
    if (!user) return false;
    
    const transactions = user.data?.transactions || [];
    transactions.push(transaction);
    
    await updateUserData(username, { transactions });
    return true;
}

async function addUserWithdraw(username, withdraw) {
    const user = users.find(u => u.username === username);
    if (!user) return false;
    
    const withdraws = user.data?.withdraws || [];
    withdraws.push(withdraw);
    
    await updateUserData(username, { withdraws });
    return true;
}

async function addUserApiKey(username, apiKey) {
    const user = users.find(u => u.username === username);
    if (!user) return false;
    
    const apiKeys = user.data?.apiKeys || [];
    apiKeys.push(apiKey);
    
    await updateUserData(username, { apiKeys });
    return true;
}

async function removeUserApiKey(username, keyId) {
    const user = users.find(u => u.username === username);
    if (!user) return false;
    
    const apiKeys = user.data?.apiKeys || [];
    const newApiKeys = apiKeys.filter(k => k.id !== keyId);
    
    await updateUserData(username, { apiKeys: newApiKeys });
    return true;
}

async function toggleUserApiKey(username, keyId) {
    const user = users.find(u => u.username === username);
    if (!user) return false;
    
    const apiKeys = user.data?.apiKeys || [];
    const key = apiKeys.find(k => k.id === keyId);
    if (!key) return false;
    
    key.is_active = key.is_active === false ? true : false;
    await updateUserData(username, { apiKeys });
    return true;
}

// ============================================
// ROUTES - Halaman
// ============================================

app.get('/', (req, res) => {
    const token = req.cookies.token;
    const decoded = validateToken(token);
    
    if (decoded) {
        return res.redirect('/dashboard');
    }
    res.redirect('/about');
});

app.get('/about', (req, res) => {
    const token = req.cookies.token;
    if (token && !validateToken(token)) {
        res.clearCookie('token');
    }
    res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

app.get('/dashboard', redirectIfNotLoggedIn, (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard', 'dashboard.html'));
});

app.get('/login', redirectIfLoggedIn, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', redirectIfLoggedIn, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/topup', redirectIfNotLoggedIn, (req, res) => {
    res.sendFile(path.join(__dirname, 'topup', 'topup.html'));
});

app.get('/withdraw', redirectIfNotLoggedIn, (req, res) => {
    res.sendFile(path.join(__dirname, 'withdraw', 'withdraw.html'));
});

app.get('/profile', redirectIfNotLoggedIn, (req, res) => {
    res.sendFile(path.join(__dirname, 'profile', 'profile.html'));
});

app.get('/docs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'docs.html'));
});

app.get('/admin', redirectIfNotLoggedIn, (req, res) => {
    const token = req.cookies.token;
    const decoded = validateToken(token);
    const user = users.find(u => u.username === decoded.username);
    
    if (!user || user.role !== 'admin') {
        return res.status(403).send('Akses ditolak. Hanya admin yang diizinkan');
    }
    
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ============================================
// API: STATUS & RELOAD
// ============================================
app.get('/api/status', async (req, res) => {
    res.json({
        success: true,
        dataLoaded: dataLoaded,
        platform: 'Supabase (Single Table)',
        supabaseUrl: SUPABASE_URL,
        myduitApiKey: MYDUIT_CONFIG.API_KEY,
        stats: {
            users: users.length
        },
        lastUpdated: new Date().toISOString()
    });
});

app.get('/api/reload', async (req, res) => {
    const secret = req.query.secret;
    const RELOAD_SECRET = 'ocean_reload_2024';
    
    if (secret !== RELOAD_SECRET) {
        return res.status(401).json({
            success: false,
            error: 'Secret tidak valid'
        });
    }
    
    try {
        await autoRestoreData();
        res.json({
            success: true,
            message: 'Data berhasil di-reload dari Supabase',
            stats: {
                users: users.length
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// API: USER & SALDO
// ============================================
app.get('/api/user', (req, res) => {
    const token = req.cookies.token;
    const decoded = validateToken(token);
    
    if (!decoded) {
        res.clearCookie('token');
        return res.status(401).json({ user: null });
    }
    
    const fullUser = users.find(u => u.username === decoded.username);
    if (!fullUser) {
        res.clearCookie('token');
        return res.status(401).json({ user: null });
    }
    
    res.json({ 
        user: {
            username: fullUser.username,
            email: fullUser.email,
            balance: fullUser.balance || 0,
            role: fullUser.role || 'user',
            createdAt: fullUser.created_at || fullUser.createdAt
        }
    });
});

app.get('/api/balance', requireAuth, (req, res) => {
    const user = users.find(u => u.username === req.user.username);
    res.json({ 
        balance: user?.balance || 0,
        formatted: 'Rp ' + (user?.balance || 0).toLocaleString()
    });
});

// ============================================
// API: API KEY MANAGEMENT
// ============================================
app.get('/api/api-keys', requireAuth, async (req, res) => {
    const username = req.user.username;
    const userKeys = getUserApiKeys(username);
    res.json({ 
        success: true, 
        keys: userKeys.map(k => ({
            id: k.id,
            key: k.key,
            name: k.name,
            username: k.username,
            isActive: k.is_active !== false,
            createdAt: k.created_at || k.createdAt,
            lastUsed: k.last_used || k.lastUsed,
            expiresAt: k.expires_at || k.expiresAt
        }))
    });
});

app.post('/api/api-keys/generate', requireAuth, async (req, res) => {
    const { name } = req.body;
    const username = req.user.username;
    
    if (!name || name.length < 3) {
        return res.status(400).json({ 
            success: false, 
            error: 'Nama API Key minimal 3 karakter' 
        });
    }
    
    const newKey = {
        id: 'key_' + Date.now(),
        key: generateApiKey(),
        name: name.trim(),
        username: username,
        is_active: true,
        created_at: new Date().toISOString(),
        last_used: null,
        expires_at: null
    };
    
    await addUserApiKey(username, newKey);
    await saveAllData();
    
    res.json({ 
        success: true, 
        message: 'API Key berhasil dibuat',
        key: newKey
    });
});

app.delete('/api/api-keys/:keyId', requireAuth, async (req, res) => {
    const { keyId } = req.params;
    const username = req.user.username;
    
    const userKeys = getUserApiKeys(username);
    const keyExists = userKeys.some(k => k.id === keyId);
    
    if (!keyExists) {
        return res.status(404).json({ 
            success: false, 
            error: 'API Key tidak ditemukan' 
        });
    }
    
    await removeUserApiKey(username, keyId);
    await saveAllData();
    
    res.json({ 
        success: true, 
        message: 'API Key berhasil dihapus' 
    });
});

app.patch('/api/api-keys/:keyId/toggle', requireAuth, async (req, res) => {
    const { keyId } = req.params;
    const username = req.user.username;
    
    const userKeys = getUserApiKeys(username);
    const key = userKeys.find(k => k.id === keyId);
    
    if (!key) {
        return res.status(404).json({ 
            success: false, 
            error: 'API Key tidak ditemukan' 
        });
    }
    
    await toggleUserApiKey(username, keyId);
    await saveAllData();
    
    const updatedKeys = getUserApiKeys(username);
    const updatedKey = updatedKeys.find(k => k.id === keyId);
    
    res.json({ 
        success: true, 
        message: `API Key ${updatedKey?.is_active ? 'diaktifkan' : 'dinonaktifkan'}`,
        isActive: updatedKey?.is_active
    });
});

// ============================================
// API ADMIN: MANAJEMEN USER
// ============================================
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const safeUsers = users.map(u => ({
            id: u.id,
            username: u.username,
            email: u.email,
            balance: u.balance || 0,
            role: u.role || 'user',
            createdAt: u.created_at || u.createdAt,
            lastLogin: u.last_login || u.lastLogin || null,
            isActive: u.is_active !== false,
            transactionCount: (u.data?.transactions || []).length,
            withdrawCount: (u.data?.withdraws || []).length,
            apiKeyCount: (u.data?.apiKeys || []).length
        }));
        
        res.json({
            success: true,
            data: safeUsers,
            total: safeUsers.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.put('/api/admin/users/:username', requireAdmin, async (req, res) => {
    try {
        const { username } = req.params;
        const { balance, role, isActive, password } = req.body;
        
        const user = users.find(u => u.username === username);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User tidak ditemukan'
            });
        }
        
        if (balance !== undefined && balance >= 0) {
            user.balance = balance;
        }
        
        if (role && ['user', 'admin'].includes(role)) {
            user.role = role;
        }
        
        if (isActive !== undefined) {
            user.is_active = isActive;
        }
        
        if (password && password.length >= 6) {
            user.password = await bcrypt.hash(password, 10);
        }
        
        await saveUser(user);
        await saveAllData();
        
        res.json({
            success: true,
            message: 'User berhasil diupdate',
            data: {
                username: user.username,
                balance: user.balance,
                role: user.role,
                isActive: user.is_active
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.delete('/api/admin/users/:username', requireAdmin, async (req, res) => {
    try {
        const { username } = req.params;
        
        const adminCount = users.filter(u => u.role === 'admin').length;
        const userToDelete = users.find(u => u.username === username);
        
        if (!userToDelete) {
            return res.status(404).json({
                success: false,
                error: 'User tidak ditemukan'
            });
        }
        
        if (userToDelete.role === 'admin' && adminCount <= 1) {
            return res.status(400).json({
                success: false,
                error: 'Tidak dapat menghapus admin terakhir'
            });
        }
        
        const index = users.findIndex(u => u.username === username);
        users.splice(index, 1);
        
        await saveAllData();
        
        res.json({
            success: true,
            message: 'User berhasil dihapus'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// API ADMIN: MANAJEMEN API KEY MYDUIT
// ============================================
app.get('/api/admin/myduit-status', requireAdmin, async (req, res) => {
    try {
        let isActive = false;
        let message = '';
        let lastCheck = new Date().toISOString();
        
        try {
            const response = await axios.get(`${MYDUIT_CONFIG.BASE_URL}/invoice`, {
                params: {
                    apikey: MYDUIT_CONFIG.API_KEY,
                    amount: 1000
                },
                timeout: 10000
            });
            
            if (response.data && response.data.success === true) {
                isActive = true;
                message = 'API Key aktif dan berfungsi dengan baik';
            } else {
                message = 'API Key tidak merespons dengan benar';
            }
        } catch (error) {
            isActive = false;
            if (error.response) {
                message = `API Key error: ${error.response.data?.message || error.response.statusText}`;
            } else if (error.request) {
                message = 'Tidak dapat terhubung ke server MyDuit';
            } else {
                message = `Error: ${error.message}`;
            }
        }
        
        res.json({
            success: true,
            data: {
                apiKey: MYDUIT_CONFIG.API_KEY,
                isActive: isActive,
                message: message,
                lastCheck: lastCheck,
                baseUrl: MYDUIT_CONFIG.BASE_URL
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.put('/api/admin/myduit-key', requireAdmin, async (req, res) => {
    try {
        const { apiKey } = req.body;
        
        if (!apiKey || apiKey.length < 10) {
            return res.status(400).json({
                success: false,
                error: 'API Key tidak valid'
            });
        }
        
        const oldApiKey = MYDUIT_CONFIG.API_KEY;
        MYDUIT_CONFIG.API_KEY = apiKey;
        myDuitService.apiKey = apiKey;
        
        try {
            const response = await axios.get(`${MYDUIT_CONFIG.BASE_URL}/invoice`, {
                params: {
                    apikey: apiKey,
                    amount: 1000
                },
                timeout: 10000
            });
            
            if (!response.data || response.data.success !== true) {
                MYDUIT_CONFIG.API_KEY = oldApiKey;
                myDuitService.apiKey = oldApiKey;
                return res.status(400).json({
                    success: false,
                    error: 'API Key baru tidak valid atau tidak aktif'
                });
            }
        } catch (error) {
            MYDUIT_CONFIG.API_KEY = oldApiKey;
            myDuitService.apiKey = oldApiKey;
            return res.status(400).json({
                success: false,
                error: 'API Key baru tidak dapat digunakan: ' + (error.response?.data?.message || error.message)
            });
        }
        
        await saveAllData();
        
        res.json({
            success: true,
            message: 'API Key MyDuit berhasil diperbarui',
            data: {
                apiKey: MYDUIT_CONFIG.API_KEY,
                isActive: true
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// API: RESET ADMIN PASSWORD
// ============================================
app.post('/api/admin/reset-password', async (req, res) => {
    try {
        const { username, currentPassword, newPassword } = req.body;
        
        const admin = users.find(u => u.username === username && u.role === 'admin');
        if (!admin) {
            return res.status(404).json({
                success: false,
                error: 'Admin tidak ditemukan'
            });
        }
        
        if (currentPassword) {
            const valid = await bcrypt.compare(currentPassword, admin.password);
            if (!valid) {
                return res.status(400).json({
                    success: false,
                    error: 'Password saat ini salah'
                });
            }
        }
        
        if (newPassword && newPassword.length >= 6) {
            admin.password = await bcrypt.hash(newPassword, 10);
            await saveAllData();
            
            res.json({
                success: true,
                message: 'Password admin berhasil diubah'
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Password baru minimal 6 karakter'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// API: CHANGE PASSWORD
// ============================================
app.post('/api/change-password', requireAuth, async (req, res) => {
    const { password } = req.body;
    const user = users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (password && password.length >= 6) {
        user.password = await bcrypt.hash(password, 10);
        await saveAllData();
        res.json({ success: true, message: 'Password updated successfully' });
    } else {
        res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
});

// ============================================
// API: TOPUP
// ============================================
app.get('/api/topup-packages', (req, res) => {
    res.json(TOPUP_PACKAGES);
});

app.post('/api/invoice', requireAuth, async (req, res) => {
    try {
        const { amount } = req.body;
        const username = req.user.username;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Jumlah topup tidak valid' });
        }

        if (amount < 1000) {
            return res.status(400).json({ error: 'Minimal topup Rp 1000' });
        }

        if (amount > 2000000) {
            return res.status(400).json({ error: 'Maksimal topup Rp 2.000.000' });
        }
        
        const result = await myDuitService.createInvoice(amount, username, 'custom');
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.get('/api/status/:invoiceId', requireAuth, async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const result = await myDuitService.checkInvoiceStatus(invoiceId);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.get('/api/transactions', requireAuth, (req, res) => {
    const username = req.user.username;
    const userTransactions = getUserTransactions(username)
        .sort((a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt));
    res.json(userTransactions);
});

// ============================================
// API: WITHDRAW
// ============================================
app.get('/api/withdraw-methods', requireAuth, (req, res) => {
    res.json({ 
        success: true,
        methods: WITHDRAW_METHODS 
    });
});

app.post('/api/withdraw', requireAuth, async (req, res) => {
    try {
        const { amount, method, accountNumber, accountName } = req.body;
        const username = req.user.username;

        const methodConfig = WITHDRAW_METHODS.find(m => m.id === method);
        if (!methodConfig) {
            return res.status(400).json({ error: 'Metode pembayaran tidak valid' });
        }

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Jumlah withdraw tidak valid' });
        }

        if (amount < 20000) {
            return res.status(400).json({ error: 'Minimal withdraw Rp 20.000' });
        }

        if (amount > 10000000) {
            return res.status(400).json({ error: 'Maksimal withdraw Rp 10.000.000' });
        }

        if (!accountNumber || accountNumber.length < 5) {
            return res.status(400).json({ error: 'Nomor akun tidak valid' });
        }

        if (!accountName || accountName.length < 3) {
            return res.status(400).json({ error: 'Nama pemilik akun tidak valid' });
        }

        const user = users.find(u => u.username === username);
        if (!user) {
            return res.status(404).json({ error: 'User tidak ditemukan' });
        }

        const currentBalance = user.balance || 0;
        if (amount > currentBalance) {
            return res.status(400).json({ 
                error: `Saldo tidak cukup! Saldo Anda: Rp ${currentBalance.toLocaleString()}` 
            });
        }

        const result = await myDuitService.createWithdraw(
            amount, 
            method, 
            accountNumber, 
            accountName,
            false
        );
        
        if (result.success && result.data) {
            user.balance = currentBalance - amount;
            await saveAllData();

            const withdrawData = {
                id: result.data.id || 'WD-' + Date.now(),
                username: username,
                amount: amount,
                fee: result.data.fee || 0,
                method: method,
                method_name: methodConfig.name,
                account_number: accountNumber,
                account_name: accountName,
                instant: false,
                status: result.data.status || 'pending',
                created_at: new Date().toISOString(),
                external_id: result.data.id || null,
                message: result.data.message || 'Withdraw diproses'
            };
            
            await addUserWithdraw(username, withdrawData);
            await saveAllData();

            const transaction = {
                id: withdrawData.id,
                invoice_id: withdrawData.id,
                username: username,
                amount: amount,
                status: 'pending',
                nominal: amount,
                type: 'withdraw',
                method: method,
                method_name: methodConfig.name,
                account_number: accountNumber,
                account_name: accountName,
                created_at: new Date().toISOString(),
                external_id: result.data.id || null
            };
            
            await addUserTransaction(username, transaction);
            await saveAllData();

            res.json({
                success: true,
                message: result.message || 'Permintaan withdraw berhasil!',
                data: withdrawData,
                newBalance: user.balance
            });
        } else {
            const errorMsg = result.message || 'Gagal melakukan withdraw';
            res.status(400).json({ error: errorMsg });
        }
    } catch (error) {
        console.error('Withdraw error:', error);
        res.status(500).json({ 
            error: error.message || 'Terjadi kesalahan saat memproses withdraw' 
        });
    }
});

// ============================================
// API: PUBLIC ENDPOINTS (Dengan API Key)
// ============================================
app.get('/api/v1/balance', validateApiKey, (req, res) => {
    const user = req.apiUser;
    res.json({
        success: true,
        data: {
            username: user.username,
            balance: user.balance || 0,
            formatted: 'Rp ' + (user.balance || 0).toLocaleString()
        }
    });
});

app.get('/api/v1/transactions', validateApiKey, (req, res) => {
    const username = req.apiUser.username;
    const userTransactions = getUserTransactions(username)
        .sort((a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt));
    
    res.json({
        success: true,
        data: userTransactions
    });
});

app.post('/api/v1/invoice', validateApiKey, async (req, res) => {
    try {
        const { amount } = req.body;
        const username = req.apiUser.username;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Jumlah topup tidak valid' 
            });
        }

        if (amount < 1000) {
            return res.status(400).json({ 
                success: false, 
                error: 'Minimal topup Rp 1000' 
            });
        }

        if (amount > 2000000) {
            return res.status(400).json({ 
                success: false, 
                error: 'Maksimal topup Rp 2.000.000' 
            });
        }
        
        const result = await myDuitService.createInvoice(amount, username, 'custom');
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.get('/api/v1/status/:invoiceId', validateApiKey, async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const result = await myDuitService.checkInvoiceStatus(invoiceId);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.post('/api/v1/withdraw', validateApiKey, async (req, res) => {
    try {
        const { amount, method, accountNumber, accountName } = req.body;
        const username = req.apiUser.username;

        const methodConfig = WITHDRAW_METHODS.find(m => m.id === method);
        if (!methodConfig) {
            return res.status(400).json({ 
                success: false, 
                error: 'Metode pembayaran tidak valid' 
            });
        }

        if (!amount || amount <= 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Jumlah withdraw tidak valid' 
            });
        }

        if (amount < 20000) {
            return res.status(400).json({ 
                success: false, 
                error: 'Minimal withdraw Rp 20000' 
            });
        }

        if (amount > 10000000) {
            return res.status(400).json({ 
                success: false, 
                error: 'Maksimal withdraw Rp 10.000.000' 
            });
        }

        if (!accountNumber || accountNumber.length < 5) {
            return res.status(400).json({ 
                success: false, 
                error: 'Nomor akun tidak valid' 
            });
        }

        if (!accountName || accountName.length < 3) {
            return res.status(400).json({ 
                success: false, 
                error: 'Nama pemilik akun tidak valid' 
            });
        }

        const user = req.apiUser;
        const currentBalance = user.balance || 0;
        if (amount > currentBalance) {
            return res.status(400).json({ 
                success: false,
                error: `Saldo tidak cukup! Saldo Anda: Rp ${currentBalance.toLocaleString()}` 
            });
        }

        const result = await myDuitService.createWithdraw(
            amount, 
            method, 
            accountNumber, 
            accountName,
            false
        );
        
        if (result.success && result.data) {
            user.balance = currentBalance - amount;
            await saveAllData();

            const withdrawData = {
                id: result.data.id || 'WD-' + Date.now(),
                username: username,
                amount: amount,
                fee: result.data.fee || 0,
                method: method,
                method_name: methodConfig.name,
                account_number: accountNumber,
                account_name: accountName,
                instant: false,
                status: result.data.status || 'pending',
                created_at: new Date().toISOString(),
                external_id: result.data.id || null,
                message: result.data.message || 'Withdraw diproses'
            };
            
            await addUserWithdraw(username, withdrawData);
            await saveAllData();

            const transaction = {
                id: withdrawData.id,
                invoice_id: withdrawData.id,
                username: username,
                amount: amount,
                status: 'pending',
                nominal: amount,
                type: 'withdraw',
                method: method,
                method_name: methodConfig.name,
                account_number: accountNumber,
                account_name: accountName,
                created_at: new Date().toISOString(),
                external_id: result.data.id || null
            };
            
            await addUserTransaction(username, transaction);
            await saveAllData();

            res.json({
                success: true,
                message: result.message || 'Permintaan withdraw berhasil!',
                data: withdrawData,
                newBalance: user.balance
            });
        } else {
            const errorMsg = result.message || 'Gagal melakukan withdraw';
            res.status(400).json({ 
                success: false,
                error: errorMsg 
            });
        }
    } catch (error) {
        console.error('Withdraw error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Terjadi kesalahan saat memproses withdraw' 
        });
    }
});

// ============================================
// MYDUIT SERVICE
// ============================================
class MyDuitService {
    constructor(apiKey = MYDUIT_CONFIG.API_KEY) {
        this.apiKey = apiKey;
        this.baseUrl = MYDUIT_CONFIG.BASE_URL;
    }

    async createInvoice(amount, username, packageId) {
        try {
            if (!amount || amount <= 0) {
                throw new Error('Jumlah pembayaran harus lebih dari 0');
            }

            const response = await axios.get(`${this.baseUrl}/invoice`, {
                params: {
                    apikey: this.apiKey,
                    amount: amount
                }
            });

            if (!response.data.success) {
                throw new Error('Gagal membuat invoice');
            }

            const transaction = {
                id: response.data.invoice_id,
                invoice_id: response.data.invoice_id,
                username: username,
                package_id: packageId || 'custom',
                amount: amount,
                fee: response.data.fee || 0,
                total: response.data.total,
                status: 'pending',
                nominal: amount,
                type: 'topup',
                created_at: new Date().toISOString(),
                expired_at: response.data.expired_at
            };
            
            await addUserTransaction(username, transaction);
            await saveAllData();

            return {
                success: true,
                invoiceId: response.data.invoice_id,
                amount: response.data.amount,
                fee: response.data.fee,
                total: response.data.total,
                qrisImage: response.data.qris_image,
                paymentLink: response.data.payment_link,
                expiredAt: response.data.expired_at
            };
        } catch (error) {
            console.error('Error creating invoice:', error.message);
            throw error;
        }
    }

    async checkInvoiceStatus(invoiceId) {
        try {
            if (!invoiceId) {
                throw new Error('Invoice ID diperlukan');
            }

            const response = await axios.get(`${this.baseUrl}/invoice/status`, {
                params: {
                    apikey: this.apiKey,
                    invoice_id: invoiceId
                }
            });

            const status = response.data.status;
            
            // Cari transaksi di semua user
            let foundTransaction = null;
            let foundUsername = null;
            
            for (const user of users) {
                const transactions = user.data?.transactions || [];
                const tx = transactions.find(t => t.invoice_id === invoiceId);
                if (tx) {
                    foundTransaction = tx;
                    foundUsername = user.username;
                    break;
                }
            }
            
            if (foundTransaction && foundTransaction.status !== status) {
                foundTransaction.status = status;
                if (status === 'paid') {
                    foundTransaction.processed_at = new Date().toISOString();
                    
                    const user = users.find(u => u.username === foundUsername);
                    if (user) {
                        const amountToAdd = foundTransaction.nominal || foundTransaction.amount;
                        user.balance = (user.balance || 0) + amountToAdd;
                        await saveAllData();
                        console.log(`💰 Saldo ${user.username} bertambah Rp ${amountToAdd.toLocaleString()}`);
                    }
                }
                await updateUserData(foundUsername, { transactions: users.find(u => u.username === foundUsername)?.data?.transactions || [] });
                await saveAllData();
            }

            return {
                success: true,
                invoiceId: response.data.invoice_id,
                amount: response.data.amount,
                fee: response.data.fee,
                total: response.data.total,
                status: response.data.status,
                qrisImage: response.data.qris_image,
                paymentLink: response.data.payment_link,
                expiredAt: response.data.expired_at,
                createdAt: response.data.created_at
            };
        } catch (error) {
            console.error('Error checking status:', error.message);
            throw error;
        }
    }

    async createWithdraw(amount, method, accountNumber, accountName, instant = false) {
        try {
            if (!amount || amount <= 0) {
                throw new Error('Jumlah withdraw tidak valid');
            }
            
            if (amount < 20000) {
                throw new Error('Minimal withdraw Rp 20.000');
            }

            const methodMapping = {
                'dana': 'dana',
                'gopay': 'gopay', 
                'ovo': 'ovo'
            };

            const methodParam = methodMapping[method] || method;

            const response = await axios.get(`${this.baseUrl}/withdraw/create`, {
                params: {
                    apikey: this.apiKey,
                    amount: amount,
                    method: methodParam,
                    account_number: accountNumber,
                    account_name: accountName,
                    instant: instant ? 1 : 0
                }
            });

            if (!response.data || !response.data.success) {
                const errorMsg = response.data?.message || 'Gagal melakukan withdraw';
                throw new Error(errorMsg);
            }

            const withdrawData = response.data.data || response.data;

            return {
                success: true,
                data: {
                    id: withdrawData.id || 'WD-' + Date.now(),
                    amount: withdrawData.amount || amount,
                    fee: withdrawData.fee || 0,
                    total: withdrawData.total || amount,
                    status: withdrawData.status || 'pending',
                    method: withdrawData.method || method,
                    account_number: withdrawData.account_number || accountNumber,
                    account_name: withdrawData.account_name || accountName,
                    message: response.data.message || 'Withdraw berhasil diproses'
                },
                message: response.data.message || 'Withdraw berhasil diproses'
            };
        } catch (error) {
            console.error('Error create withdraw:', error.message);
            if (error.response) {
                const errorMsg = error.response.data?.message || 'Gagal memproses withdraw';
                throw new Error(errorMsg);
            }
            throw error;
        }
    }
}

const myDuitService = new MyDuitService();

// ============================================
// AUTH ROUTES
// ============================================
app.post('/register', async (req, res) => {
    const { username, password, email } = req.body;
    
    if (!username || !password || !email) {
        return res.status(400).json({ error: 'Semua field harus diisi!' });
    }
    
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username sudah digunakan!' });
    }
    
    const hashed = await bcrypt.hash(password, 10);
    const newUser = { 
        id: users.length + 1, 
        username, 
        email, 
        password: hashed,
        balance: 0,
        role: users.length === 0 ? 'admin' : 'user',
        is_active: true,
        created_at: new Date().toISOString(),
        last_login: null,
        data: {
            transactions: [],
            withdraws: [],
            apiKeys: []
        }
    };
    users.push(newUser);
    await saveAllData();
    
    res.json({ success: true, message: 'Registrasi berhasil!', user: username });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Semua field harus diisi!' });
    }
    
    const user = users.find(u => u.username === username);
    if (!user) {
        return res.status(400).json({ error: 'Username tidak ditemukan!' });
    }
    
    if (user.is_active === false) {
        return res.status(400).json({ error: 'Akun Anda telah dinonaktifkan!' });
    }
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
        return res.status(400).json({ error: 'Password salah!' });
    }
    
    user.last_login = new Date().toISOString();
    await saveAllData();
    
    const token = jwt.sign({ 
        id: user.id, 
        username: user.username, 
        email: user.email,
        role: user.role || 'user'
    }, SECRET_KEY, { expiresIn: '8h' });
    
    res.cookie('token', token, { 
        httpOnly: true,
        secure: false,
        sameSite: 'lax'
    });
    
    const isAdmin = user.role === 'admin';
    const redirectUrl = isAdmin ? '/admin' : '/dashboard';
    
    res.json({ 
        success: true, 
        message: 'Login berhasil!', 
        balance: user.balance || 0,
        role: user.role || 'user',
        redirect: redirectUrl,
        isAdmin: isAdmin
    });
});

app.post('/logout', (req, res) => {
    res.clearCookie('token', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax'
    });
    
    res.json({ 
        success: true, 
        message: 'Logout berhasil!',
        redirect: '/about'
    });
});

// ============================================
// ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
    console.error('❌ Error:', err);
    res.status(500).json({ error: err.message || 'Terjadi kesalahan server' });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, async () => {
    console.log('========================================');
    console.log('🌊 My Duit - Payment System (Single Table)');
    console.log(`🌐 Server: http://localhost:${PORT}`);
    console.log('📦 Database: Supabase (1 Tabel: users)');
    console.log('========================================');
    console.log('🔄 Auto-Restore: ON (Otomatis saat server start)');
    console.log('========================================');
    
    await autoRestoreData();
    
    console.log('========================================');
    console.log('📊 Database Status:');
    console.log(`   👤 Users: ${users.length}`);
    console.log('========================================');
    console.log('👑 Admin Panel:');
    console.log(`   🔗 http://localhost:${PORT}/admin`);
    console.log('   👤 Username: admin');
    console.log('   🔑 Password: adminnyduitpayment');
    console.log('========================================');
    console.log('📡 API ENDPOINTS:');
    console.log('   GET    /api/status        - Cek status data');
    console.log('   GET    /api/reload?secret=xxx - Reload manual');
    console.log('========================================');
    console.log('🔓 PUBLIC API (v1):');
    console.log('   GET    /api/v1/balance');
    console.log('   GET    /api/v1/transactions');
    console.log('   POST   /api/v1/invoice');
    console.log('   GET    /api/v1/status/:invoiceId');
    console.log('   POST   /api/v1/withdraw');
    console.log('========================================');
    console.log('🔐 ADMIN API:');
    console.log('   GET    /api/admin/users');
    console.log('   PUT    /api/admin/users/:username');
    console.log('   DELETE /api/admin/users/:username');
    console.log('   GET    /api/admin/myduit-status');
    console.log('   PUT    /api/admin/myduit-key');
    console.log('========================================');
    console.log('🔑 API Key management di /api/api-keys');
    console.log('📖 API Docs di /api-docs');
    console.log('========================================');
});