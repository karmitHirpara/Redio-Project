import { Track, Playlist } from '../types';
import { generateId } from '../lib/utils';

export const mockTracks: Track[] = [
  {
    id: generateId(),
    name: 'Summer Vibes',
    artist: 'DJ Solar',
    duration: 215,
    size: 5242880,
    dateAdded: new Date('2025-11-10'),
    filePath: '/music/summer-vibes.mp3',
    hash: 'hash1'
  },
  {
    id: generateId(),
    name: 'Midnight Drive',
    artist: 'The Nocturnes',
    duration: 198,
    size: 4718592,
    dateAdded: new Date('2025-11-12'),
    filePath: '/music/midnight-drive.mp3',
    hash: 'hash2'
  },
  {
    id: generateId(),
    name: 'Electric Dreams',
    artist: 'Synthwave Station',
    duration: 267,
    size: 6291456,
    dateAdded: new Date('2025-11-14'),
    filePath: '/music/electric-dreams.mp3',
    hash: 'hash3'
  },
  {
    id: generateId(),
    name: 'Morning Coffee',
    artist: 'Acoustic Blend',
    duration: 183,
    size: 4404019,
    dateAdded: new Date('2025-11-15'),
    filePath: '/music/morning-coffee.mp3',
    hash: 'hash4'
  },
  {
    id: generateId(),
    name: 'Rush Hour',
    artist: 'Urban Beats',
    duration: 201,
    size: 4823449,
    dateAdded: new Date('2025-11-13'),
    filePath: '/music/rush-hour.mp3',
    hash: 'hash5'
  },
  {
    id: generateId(),
    name: 'Sunset Boulevard',
    artist: 'Coast FM',
    duration: 234,
    size: 5505024,
    dateAdded: new Date('2025-11-11'),
    filePath: '/music/sunset-boulevard.mp3',
    hash: 'hash6'
  },
  {
    id: generateId(),
    name: 'Neon Lights',
    artist: 'City Pulse',
    duration: 192,
    size: 4608000,
    dateAdded: new Date('2025-11-09'),
    filePath: '/music/neon-lights.mp3',
    hash: 'hash7'
  },
  {
    id: generateId(),
    name: 'Rainy Day Jazz',
    artist: 'The Blue Notes',
    duration: 276,
    size: 6553600,
    dateAdded: new Date('2025-11-08'),
    filePath: '/music/rainy-day-jazz.mp3',
    hash: 'hash8'
  },
  {
    id: generateId(),
    name: 'Weekend Anthem',
    artist: 'Party Mix',
    duration: 189,
    size: 4534886,
    dateAdded: new Date('2025-11-16'),
    filePath: '/music/weekend-anthem.mp3',
    hash: 'hash9'
  },
  {
    id: generateId(),
    name: 'Deep Focus',
    artist: 'Ambient Sounds',
    duration: 312,
    size: 7340032,
    dateAdded: new Date('2025-11-07'),
    filePath: '/music/deep-focus.mp3',
    hash: 'hash10'
  }
];

export const mockPlaylists: Playlist[] = [
  {
    id: generateId(),
    name: 'Morning Show',
    tracks: [mockTracks[3], mockTracks[5], mockTracks[1]],
    locked: false,
    createdAt: new Date('2025-11-10'),
    duration: 615
  },
  {
    id: generateId(),
    name: 'Evening Drive',
    tracks: [mockTracks[0], mockTracks[2], mockTracks[4], mockTracks[6]],
    locked: false,
    createdAt: new Date('2025-11-12'),
    duration: 875
  },
  {
    id: generateId(),
    name: 'Late Night Mix',
    tracks: [mockTracks[7], mockTracks[9]],
    locked: true,
    createdAt: new Date('2025-11-14'),
    duration: 588
  }
];
