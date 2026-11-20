export const DESKTOP_MODE = {
  id: 'desktop',
  title: 'Desktop / Steam Mode',
  genre: 'Virtual Desktop',
  vramGb: 2,
  coverUrl: null,
  steamAppId: '',
  description: 'Full Linux desktop environment with Steam & Proton-GE ready to launch any title.',
};

export const GAMES = [
  {
    id: 'cyber-drift-2089',
    title: 'Cyber Drift 2089',
    genre: 'Action RPG',
    vramGb: 10,
    coverUrl: '/covers/cyber-drift.jpg',
    steamAppId: '1091500',
    description: 'High-speed neon metropolis action with ray-traced reflections and Proton-GE DX12.',
  },
  {
    id: 'aetherblade-chronicles',
    title: 'Aetherblade Chronicles',
    genre: 'Tactical Action',
    vramGb: 8,
    coverUrl: '/covers/aetherblade.jpg',
    steamAppId: '1245620',
    description: 'Precision melee combat across an eclipsed floating citadel.',
  },
  {
    id: 'apex-velocity-gt',
    title: 'Apex Velocity GT',
    genre: 'Sim Racing',
    vramGb: 8,
    coverUrl: '/covers/apex-velocity.jpg',
    steamAppId: '805550',
    description: 'Endurance GT3 motorsport simulation at locked 60 FPS NVENC low latency.',
  },
  {
    id: 'helios-protocol',
    title: 'Helios Protocol',
    genre: 'Sci-Fi FPS',
    vramGb: 12,
    coverUrl: '/covers/helios-protocol.jpg',
    steamAppId: '1172470',
    description: 'Zero-gravity tactical skirmishes aboard an orbital research station.',
  },
  {
    id: 'hollow-bastion',
    title: 'Hollow Bastion',
    genre: 'Roguelite',
    vramGb: 4,
    coverUrl: '/covers/hollow-bastion.jpg',
    steamAppId: '367520',
    description: 'Explore subterranean crystal ruins in a hand-crafted dark roguelite.',
  },
  {
    id: 'orbital-frontier',
    title: 'Orbital Frontier',
    genre: 'Strategy Sim',
    vramGb: 6,
    coverUrl: '/covers/orbital-frontier.jpg',
    steamAppId: '281990',
    description: 'Construct ringworld infrastructure and command deep-space logistics.',
  },
];

export function resolveGame(gameId) {
  if (!gameId || gameId === 'desktop') {
    return DESKTOP_MODE;
  }
  return GAMES.find((game) => game.id === gameId) || null;
}
