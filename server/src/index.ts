import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { CACHE_DIR } from './services/paths.js';
import { appEvents } from './services/events.js';
import { audioRouter } from './routes/audio.js';
import { youtubeRouter } from './routes/youtube.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

appEvents.setIO(io);

app.use(cors());
app.use(express.json());

// Serve static audio files & cover art from audio-cache
app.use('/audio', express.static(CACHE_DIR));

// API Routes
app.use('/api/audio', audioRouter);
app.use('/api/youtube', youtubeRouter);

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('⚡ Client connected to real-time event bus:', socket.id);
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🎤 SupaJuka 2 Server running at http://localhost:${PORT}`);
  console.log(`📁 Audio cache: ${CACHE_DIR}`);
});
