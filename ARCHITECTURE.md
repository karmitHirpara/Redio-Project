# System Architecture

## Overview

Radio Automation is a full-stack application designed for professional broadcast operations with a React frontend and Node.js backend.

## Tech Stack

### Frontend
- **Framework**: React 18 with TypeScript
- **Styling**: Tailwind CSS v4
- **State Management**: React Hooks (useState, useEffect)
- **Animations**: Motion (Framer Motion)
- **UI Components**: Shadcn/UI
- **HTTP Client**: Fetch API
- **Build Tool**: Vite

### Backend
- **Runtime**: Node.js v18+
- **Framework**: Express.js
- **Database**: SQLite3
- **File Upload**: Multer
- **Authentication**: None (add as needed)

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND                         │
│  ┌──────────────────────────────────────────────┐  │
│  │   React Components (UI Layer)                │  │
│  │  - LibraryPanel    - QueuePanel              │  │
│  │  - PlaylistManager - PlaybackBar             │  │
│  └──────────────────────────────────────────────┘  │
│                      ↕                              │
│  ┌──────────────────────────────────────────────┐  │
│  │   API Service Layer (services/api.ts)        │  │
│  │  - tracksAPI    - queueAPI                   │  │
│  │  - playlistsAPI - schedulesAPI               │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                        ↕ HTTP/REST
┌─────────────────────────────────────────────────────┐
│                    BACKEND                          │
│  ┌──────────────────────────────────────────────┐  │
│  │   Express Routes (API Endpoints)             │  │
│  │  /api/tracks     /api/queue                  │  │
│  │  /api/playlists  /api/schedules              │  │
│  └──────────────────────────────────────────────┘  │
│                      ↕                              │
│  ┌──────────────────────────────────────────────┐  │
│  │   Database Layer (SQLite)                    │  │
│  │  - tracks         - queue                    │  │
│  │  - playlists      - schedules                │  │
│  │  - playlist_tracks                           │  │
│  └──────────────────────────────────────────────┘  │
│                      ↕                              │
│  ┌──────────────────────────────────────────────┐  │
│  │   File System                                │  │
│  │  - uploads/ (audio files)                    │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Track Upload Flow
```
User selects file
    ↓
Frontend: Upload via FormData
    ↓
Backend: Multer middleware
    ↓
Validate file type & size
    ↓
Calculate SHA256 hash
    ↓
Check for duplicates
    ↓
Save file to uploads/
    ↓
Insert metadata to database
    ↓
Return track object to frontend
```

### 2. Playlist Scheduling Flow
```
User schedules playlist
    ↓
Frontend: Send schedule config
    ↓
Backend: Validate playlist exists
    ↓
Store schedule in database
    ↓
Frontend: Poll for schedule triggers
    ↓
When triggered: Load playlist to queue
    ↓
Resume queue after playlist completes
```

### 3. Queue Management Flow
```
Add track to queue
    ↓
Backend: Calculate order position
    ↓
Insert into queue table
    ↓
Frontend: Update queue display
    ↓
User reorders queue
    ↓
Backend: Update positions
    ↓
Frontend: Reflect new order
```

## Database Schema

### Tracks
```sql
CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  duration INTEGER NOT NULL,
  size INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  date_added DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### Playlists
```sql
CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  locked BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### Playlist Tracks (Junction Table)
```sql
CREATE TABLE playlist_tracks (
  playlist_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
  PRIMARY KEY (playlist_id, track_id)
)
```

### Queue
```sql
CREATE TABLE queue (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  from_playlist TEXT,
  order_position INTEGER NOT NULL,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
)
```

### Schedules
```sql
CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL,
  type TEXT NOT NULL,
  date_time DATETIME,
  queue_song_id TEXT,
  trigger_position TEXT,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
)
```

## API Design

### RESTful Endpoints

**Tracks**
- `GET /api/tracks` - List all tracks
- `POST /api/tracks/upload` - Upload new track (multipart/form-data)
- `DELETE /api/tracks/:id` - Delete track and file

**Playlists**
- `GET /api/playlists` - List all playlists with tracks
- `POST /api/playlists` - Create new playlist
- `PUT /api/playlists/:id` - Update playlist (name, locked)
- `DELETE /api/playlists/:id` - Delete playlist
- `POST /api/playlists/:id/tracks` - Add tracks to playlist
- `DELETE /api/playlists/:id/tracks/:trackId` - Remove track
- `PUT /api/playlists/:id/reorder` - Reorder tracks

**Queue**
- `GET /api/queue` - Get current queue
- `POST /api/queue` - Add track to queue
- `PUT /api/queue/reorder` - Reorder queue
- `DELETE /api/queue/:id` - Remove from queue

**Schedules**
- `GET /api/schedules` - Get pending schedules
- `POST /api/schedules` - Create schedule
- `PUT /api/schedules/:id` - Update schedule status
- `DELETE /api/schedules/:id` - Delete schedule

## Security Considerations

### Current Implementation
- File type validation (audio only)
- File size limits (50MB)
- Duplicate detection via hash
- SQL injection prevention (parameterized queries)
- CORS protection

### Recommended Additions
- Authentication (JWT)
- Rate limiting
- Input sanitization
- HTTPS enforcement
- File storage encryption
- User roles & permissions

## Performance Optimizations

### Current
- Database indexes on frequently queried fields
- Efficient SQL joins
- File streaming for uploads
- Lazy loading of large lists

### Future Improvements
- Redis caching
- CDN for audio files
- WebSocket for real-time updates
- Database connection pooling
- Audio file transcoding

## Scalability

### Current Architecture
- Single-server deployment
- SQLite database
- Local file storage

### Scaling Path
1. **Horizontal Scaling**: Add load balancer + multiple app servers
2. **Database**: Migrate to PostgreSQL with read replicas
3. **Storage**: Move to S3/CloudFront for audio files
4. **Caching**: Add Redis for sessions and frequent queries
5. **Queue**: Use RabbitMQ/SQS for job processing
6. **Monitoring**: Add APM (New Relic, DataDog)

## Error Handling

### Frontend
- Try/catch in API calls
- Toast notifications for errors
- Fallback UI states
- Loading indicators

### Backend
- Global error middleware
- Proper HTTP status codes
- Detailed error messages (dev)
- Generic messages (production)
- Error logging

## Testing Strategy

### Frontend (Recommended)
- Unit tests: React components
- Integration tests: API service layer
- E2E tests: Critical user flows

### Backend (Recommended)
- Unit tests: Route handlers
- Integration tests: Database operations
- API tests: Endpoint responses

## Deployment

### Development
- Frontend: Vite dev server
- Backend: Node.js with --watch flag

### Production
- Frontend: Build static files, deploy to CDN
- Backend: PM2/Docker container
- Database: Managed PostgreSQL
- Storage: S3-compatible object storage

## Monitoring

### Recommended Metrics
- API response times
- Database query performance
- File upload success rate
- Active queues
- Scheduled playlists executed
- Error rates
- User sessions

## Backup Strategy

### Database
- Daily automated backups
- Point-in-time recovery
- Offsite storage

### Audio Files
- Redundant storage
- Versioning enabled
- Lifecycle policies

---

This architecture is designed for reliability, maintainability, and future growth while remaining simple enough for small to medium broadcast operations.
