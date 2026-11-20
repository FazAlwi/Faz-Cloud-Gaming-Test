import { Router } from 'express';
import { DESKTOP_MODE, GAMES } from '../data/games.js';

export const gamesRouter = Router();

gamesRouter.get('/', (_req, res) => {
  res.json({
    games: GAMES,
    desktopMode: DESKTOP_MODE,
  });
});
