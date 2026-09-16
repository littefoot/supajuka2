import { Router } from 'express';
import { searchYouTube, extractYouTubeAudio } from '../services/ytdlp.js';

export const youtubeRouter = Router();

youtubeRouter.get('/search', async (req, res) => {
  const q = req.query.q as string;
  if (!q) return res.json([]);

  try {
    const results = await searchYouTube(q);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

youtubeRouter.post('/extract', async (req, res) => {
  const item = req.body;
  if (!item || !item.id) return res.status(400).json({ error: 'Video item required' });

  try {
    const metadata = await extractYouTubeAudio(item);
    res.json(metadata);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
