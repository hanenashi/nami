import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { requireActor, requireOrganizer, requireSameOrigin } from './auth.js';
import type { NamiDatabase } from './database.js';

type EventBody = {
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  timezone?: string;
};

type EventRow = {
  id: string;
  title: string;
  description: string;
  start_date: string;
  end_date: string | null;
  timezone: string | null;
  created_at: number;
  updated_at: number;
};

type EventAccessRow = EventRow & { role: 'organizer' | 'contributor' | 'viewer'; display_name: string };

const calendarDatePattern = '^\\d{4}-\\d{2}-\\d{2}$';
const eventBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'startDate'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: 'string', maxLength: 2_000 },
    startDate: { type: 'string', pattern: calendarDatePattern },
    endDate: { type: 'string', pattern: calendarDatePattern },
    timezone: { type: 'string', maxLength: 100 },
  },
} as const;

function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year > 0
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function serializeEvent(row: EventRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function registerEvents(app: FastifyInstance, database: NamiDatabase, dataRoot: string, secureCookies: boolean) {
  const organizerOnly = requireOrganizer(database);
  const signedIn = requireActor(database);

  app.get('/api/events', { preHandler: organizerOnly }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const rows = database.prepare(`
      SELECT events.id, events.title, events.description, events.start_date,
             events.end_date, events.timezone, events.created_at, events.updated_at
      FROM events
      JOIN event_access ON event_access.event_id = events.id
      WHERE event_access.actor_id = ? AND event_access.role = 'organizer'
      ORDER BY events.start_date DESC, events.created_at DESC
    `).all(request.namiActor!.id) as EventRow[];
    return { events: rows.map(serializeEvent) };
  });

  app.get<{ Params: { eventId: string } }>('/api/events/:eventId', { preHandler: signedIn }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const row = database.prepare(`
      SELECT events.id, events.title, events.description, events.start_date,
             events.end_date, events.timezone, events.created_at, events.updated_at,
             event_access.role, actors.display_name
      FROM events
      JOIN event_access ON event_access.event_id = events.id
      JOIN actors ON actors.id = event_access.actor_id
      WHERE events.id = ? AND event_access.actor_id = ?
    `).get(request.params.eventId, request.namiActor!.id) as EventAccessRow | undefined;
    if (!row) return reply.code(404).send({ error: 'Event not found.' });
    return {
      event: serializeEvent(row),
      access: { role: row.role, displayName: row.display_name },
    };
  });

  app.post<{ Body: EventBody }>('/api/events', {
    schema: { body: eventBodySchema },
    preHandler: [requireSameOrigin(secureCookies), organizerOnly],
  }, async (request, reply) => {
    const title = request.body.title.trim();
    const description = request.body.description?.trim() ?? '';
    const startDate = request.body.startDate;
    const endDate = request.body.endDate || null;
    const timezone = request.body.timezone?.trim() || null;
    if (!title) return reply.code(400).send({ error: 'Please give the event a title.' });
    if (!isCalendarDate(startDate) || (endDate && !isCalendarDate(endDate))) {
      return reply.code(400).send({ error: 'Please choose a valid date.' });
    }
    if (endDate && endDate < startDate) {
      return reply.code(400).send({ error: 'The end date must be on or after the start date.' });
    }
    if (timezone && !isTimeZone(timezone)) {
      return reply.code(400).send({ error: 'The device timezone was not recognized.' });
    }

    const id = randomUUID();
    const now = Date.now();
    database.transaction(() => {
      database.prepare(`
        INSERT INTO events (id, owner_id, title, description, start_date, end_date, timezone, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, request.namiActor!.id, title, description, startDate, endDate, timezone, now, now);
      database.prepare(`
        INSERT INTO event_access (actor_id, event_id, role, created_at)
        VALUES (?, ?, 'organizer', ?)
      `).run(request.namiActor!.id, id, now);
    })();

    const event = database.prepare(`
      SELECT id, title, description, start_date, end_date, timezone, created_at, updated_at
      FROM events WHERE id = ?
    `).get(id) as EventRow;
    return reply.code(201).send({ event: serializeEvent(event) });
  });

  app.delete<{ Params: { eventId: string }; Body: { confirmTitle: string } }>('/api/events/:eventId', {
    preHandler: [requireSameOrigin(secureCookies), organizerOnly],
    schema: { body: { type: 'object', required: ['confirmTitle'], additionalProperties: false,
      properties: { confirmTitle: { type: 'string', minLength: 1, maxLength: 120 } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const row = database.prepare('SELECT title FROM events WHERE id = ? AND owner_id = ?')
      .get(request.params.eventId, request.namiActor!.id) as { title: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'Event not found.' });
    if (request.body.confirmTitle !== row.title) return reply.code(400).send({ error: 'Event name did not match.' });
    const pending = database.prepare('SELECT id FROM upload_sessions WHERE event_id = ?')
      .all(request.params.eventId) as { id: string }[];
    const media = database.prepare('SELECT id FROM media WHERE event_id = ?').all(request.params.eventId) as { id: string }[];
    database.transaction(() => {
      database.prepare('DELETE FROM upload_sessions WHERE event_id = ?').run(request.params.eventId);
      database.prepare('DELETE FROM events WHERE id = ? AND owner_id = ?').run(request.params.eventId, request.namiActor!.id);
    })();
    for (const { id } of pending) {
      await unlink(join(dataRoot, 'uploads', id)).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') app.log.error(error);
      });
    }
    for (const { id } of media) {
      for (const directory of ['originals', 'previews']) {
        await unlink(join(dataRoot, directory, `${id}.jpg`)).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') app.log.error(error);
        });
      }
    }
    return reply.code(204).send();
  });
}
