import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { issueSession, requireOrganizer, requireSameOrigin } from './auth.js';
import type { NamiDatabase } from './database.js';

type InvitationRole = 'contributor' | 'viewer';
type CreateInvitationBody = { role: InvitationRole; expiresInDays?: number };
type RedeemBody = { nickname?: string };

type InvitationRow = {
  id: string;
  event_id: string;
  role: InvitationRole;
  actor_id: string | null;
  guest_name: string | null;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
  last_redeemed_at: number | null;
  redemption_count: number;
};

type InvitationPreviewRow = InvitationRow & {
  title: string;
  description: string;
  start_date: string;
  end_date: string | null;
};

const createInvitationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['role'],
  properties: {
    role: { type: 'string', enum: ['contributor', 'viewer'] },
    expiresInDays: { type: 'integer', minimum: 1, maximum: 365 },
  },
} as const;

const redeemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    nickname: { type: 'string', maxLength: 80 },
  },
} as const;

function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

function validSecret(secret: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(secret);
}

function organizerCanManage(database: NamiDatabase, actorId: string, eventId: string) {
  return Boolean(database.prepare(`
    SELECT 1 FROM event_access
    WHERE actor_id = ? AND event_id = ? AND role = 'organizer'
  `).get(actorId, eventId));
}

function invitationStatus(row: InvitationRow, now = Date.now()) {
  if (row.revoked_at) return 'revoked' as const;
  if (row.expires_at && row.expires_at <= now) return 'expired' as const;
  if (row.actor_id) return 'redeemed' as const;
  return 'active' as const;
}

function serializeInvitation(row: InvitationRow) {
  return {
    id: row.id,
    role: row.role,
    status: invitationStatus(row),
    guestName: row.guest_name,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastRedeemedAt: row.last_redeemed_at,
    redemptionCount: row.redemption_count,
  };
}

function invitationQuery() {
  return `
    SELECT invitations.id, invitations.event_id, invitations.role,
           invitations.actor_id, actors.display_name AS guest_name,
           invitations.expires_at, invitations.revoked_at,
           invitations.created_at, invitations.last_redeemed_at,
           invitations.redemption_count
    FROM invitations
    LEFT JOIN actors ON actors.id = invitations.actor_id
  `;
}

function invitationPreviewQuery() {
  return `
    SELECT invitations.id, invitations.event_id, invitations.role,
           invitations.actor_id, actors.display_name AS guest_name,
           invitations.expires_at, invitations.revoked_at,
           invitations.created_at, invitations.last_redeemed_at,
           invitations.redemption_count, events.title, events.description,
           events.start_date, events.end_date
    FROM invitations
    LEFT JOIN actors ON actors.id = invitations.actor_id
    JOIN events ON events.id = invitations.event_id
  `;
}

export function registerInvitations(app: FastifyInstance, database: NamiDatabase, secureCookies: boolean) {
  const organizerOnly = requireOrganizer(database);
  const sameOrigin = requireSameOrigin(secureCookies);

  app.get<{ Params: { eventId: string } }>('/api/events/:eventId/invitations', {
    preHandler: organizerOnly,
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!organizerCanManage(database, request.namiActor!.id, request.params.eventId)) {
      return reply.code(404).send({ error: 'Event not found.' });
    }
    const rows = database.prepare(`${invitationQuery()}
      WHERE invitations.event_id = ?
      ORDER BY invitations.created_at DESC
    `).all(request.params.eventId) as InvitationRow[];
    return { invitations: rows.map(serializeInvitation) };
  });

  app.post<{ Params: { eventId: string }; Body: CreateInvitationBody }>('/api/events/:eventId/invitations', {
    schema: { body: createInvitationSchema },
    preHandler: [sameOrigin, organizerOnly],
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!organizerCanManage(database, request.namiActor!.id, request.params.eventId)) {
      return reply.code(404).send({ error: 'Event not found.' });
    }
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const now = Date.now();
    const expiresAt = request.body.expiresInDays
      ? now + request.body.expiresInDays * 24 * 60 * 60 * 1000
      : null;
    database.prepare(`
      INSERT INTO invitations (
        id, event_id, created_by, role, secret_hash, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, request.params.eventId, request.namiActor!.id, request.body.role, hashSecret(secret), expiresAt, now);
    const row = database.prepare(`${invitationQuery()} WHERE invitations.id = ?`).get(id) as InvitationRow;
    return reply.code(201).send({
      invitation: serializeInvitation(row),
      invitePath: `/invite/${secret}`,
    });
  });

  app.post<{ Params: { eventId: string; invitationId: string } }>('/api/events/:eventId/invitations/:invitationId/revoke', {
    preHandler: [sameOrigin, organizerOnly],
  }, async (request, reply) => {
    if (!organizerCanManage(database, request.namiActor!.id, request.params.eventId)) {
      return reply.code(404).send({ error: 'Event not found.' });
    }
    const invitation = database.prepare(`
      SELECT actor_id FROM invitations WHERE id = ? AND event_id = ?
    `).get(request.params.invitationId, request.params.eventId) as { actor_id: string | null } | undefined;
    if (!invitation) return reply.code(404).send({ error: 'Invitation not found.' });
    const now = Date.now();
    database.transaction(() => {
      database.prepare('UPDATE invitations SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(now, request.params.invitationId);
      if (invitation.actor_id) {
        database.prepare('DELETE FROM event_access WHERE actor_id = ? AND event_id = ?').run(invitation.actor_id, request.params.eventId);
        database.prepare('DELETE FROM sessions WHERE actor_id = ?').run(invitation.actor_id);
      }
    })();
    return reply.code(204).send();
  });

  app.get<{ Params: { secret: string } }>('/api/invitations/:secret', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!validSecret(request.params.secret)) return reply.code(404).send({ error: 'Invitation not found.' });
    const row = database.prepare(`${invitationPreviewQuery()}
      WHERE invitations.secret_hash = ?
    `).get(hashSecret(request.params.secret)) as InvitationPreviewRow | undefined;
    if (!row) return reply.code(404).send({ error: 'Invitation not found.' });
    if (invitationStatus(row) === 'revoked') return reply.code(410).send({ error: 'This invitation was revoked.' });
    if (invitationStatus(row) === 'expired') return reply.code(410).send({ error: 'This invitation has expired.' });
    return {
      invitation: {
        event: {
          id: row.event_id,
          title: row.title,
          description: row.description,
          startDate: row.start_date,
          endDate: row.end_date,
        },
        role: row.role,
        redeemedAs: row.guest_name,
      },
    };
  });

  app.post<{ Params: { secret: string }; Body: RedeemBody }>('/api/invitations/:secret/redeem', {
    schema: { body: redeemSchema },
    preHandler: sameOrigin,
    config: { rateLimit: { max: 20, timeWindow: '1 minute', groupId: 'invitation-redemption' } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!validSecret(request.params.secret)) return reply.code(404).send({ error: 'Invitation not found.' });
    const secretHash = hashSecret(request.params.secret);
    const result = database.transaction(() => {
      const row = database.prepare(`${invitationQuery()} WHERE invitations.secret_hash = ?`).get(secretHash) as InvitationRow | undefined;
      if (!row) return { error: 'Invitation not found.', statusCode: 404 } as const;
      const status = invitationStatus(row);
      if (status === 'revoked') return { error: 'This invitation was revoked.', statusCode: 410 } as const;
      if (status === 'expired') return { error: 'This invitation has expired.', statusCode: 410 } as const;

      let actorId = row.actor_id;
      let displayName = row.guest_name;
      if (!actorId) {
        const nickname = request.body.nickname?.trim() ?? '';
        if (!nickname) return { error: 'Please enter your name.', statusCode: 400 } as const;
        actorId = randomUUID();
        displayName = nickname;
        database.prepare(`
          INSERT INTO actors (id, kind, display_name, password_hash, created_at)
          VALUES (?, 'guest', ?, NULL, ?)
        `).run(actorId, nickname, Date.now());
        database.prepare(`
          INSERT INTO event_access (actor_id, event_id, role, created_at)
          VALUES (?, ?, ?, ?)
        `).run(actorId, row.event_id, row.role, Date.now());
        database.prepare('UPDATE invitations SET actor_id = ? WHERE id = ?').run(actorId, row.id);
      }
      const now = Date.now();
      database.prepare(`
        UPDATE invitations
        SET last_redeemed_at = ?, redemption_count = redemption_count + 1
        WHERE id = ?
      `).run(now, row.id);
      return { actorId, displayName: displayName!, eventId: row.event_id, role: row.role } as const;
    })();

    if ('error' in result) return reply.code(result.statusCode ?? 400).send({ error: result.error });
    issueSession(database, reply, result.actorId, secureCookies);
    return {
      event: { id: result.eventId },
      access: { role: result.role, displayName: result.displayName },
    };
  });
}
