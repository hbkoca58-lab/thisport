const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const { PeerServer } = require('peer');
const express = require('express');

let mainWindow;
let expressApp;
let server;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1300, 
        height: 900,
        frame: false, 
        backgroundColor: '#050505',
        webPreferences: { 
            nodeIntegration: true, 
            contextIsolation: false,
            webSecurity: false
        }
    });
    
    mainWindow.loadURL('http://localhost:3000/');
}

app.whenReady().then(() => {
    expressApp = express();
    expressApp.use(express.static(__dirname)); 
    
    server = expressApp.listen(3000, () => {
        console.log("Local Express server running on port 3000");
        
        try { 
            PeerServer({ port: 9000, path: '/thisport' }); 
            console.log("PeerServer active on port 9000.");
        } catch(e){
            console.error("PeerServer failed to start:", e);
        }

        ipcMain.handle('get-screen-sources', async (event, type) => {
            const sources = await desktopCapturer.getSources({ 
                types: [type === 'screen' ? 'screen' : 'window'],
                thumbnailSize: { width: 300, height: 200 }
            });
            return sources.map(s => ({ 
                id: s.id, 
                name: s.name, 
                thumbnail: s.thumbnail.toDataURL() 
            }));
        });

        createWindow();
    });
});

app.on('window-all-closed', () => { 
    if (process.platform !== 'darwin') app.quit(); 
});

ipcMain.on('minimize-window', () => mainWindow.minimize());
ipcMain.on('close-window', () => mainWindow.close());

// FULLSCREEN (MAXIMIZE) FIX
ipcMain.on('toggle-maximize', () => {
    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});

// BUG YENİLEME HİLESİ
ipcMain.on('fix-bug', () => {
    if (mainWindow) {
        mainWindow.minimize(); 
        setTimeout(() => {
            mainWindow.restore();
            mainWindow.focus();
        }, 50);
    }
});