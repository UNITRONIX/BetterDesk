/**
 * Chat over HTTP (routes/chat.routes.js; all need chat.access): file
 * upload and download, and message search (the Go server has no search
 * yet, so it answers an empty list, P8). Messages, contacts, groups and
 * presence go over the WebSocket /ws/chat-operator/panel instead.
 * Also the directory of who has a profile picture (routes/avatars.routes.js).
 */

import * as v from 'valibot';
import { api, request, wrapped, ApiError, clientMessages } from './client.ts';

/** The largest file the server takes (multer limit) */
export const MAX_CHAT_FILE = 50 * 1024 * 1024;

const Uploaded = v.looseObject({
	success: v.optional(v.boolean()),
	file_id: v.string(),
	filename: v.optional(v.string()),
	size: v.optional(v.number()),
	url: v.optional(v.string())
});
export type Uploaded = v.InferOutput<typeof Uploaded>;

export async function uploadChatFile(file: File): Promise<Uploaded> {
	const body = new FormData();
	body.append('file', file);
	const raw = await request('/api/chat/upload', { method: 'POST', body });
	const out = v.safeParse(Uploaded, raw);
	if (!out.success) throw new ApiError(clientMessages.invalid, 200, { code: 'invalid_response', data: raw });
	return out.output;
}

/** Where a shared file downloads from (only hex ids reach the server) */
export function chatFileUrl(fileId: string): string {
	return `/api/chat/files/${encodeURIComponent(fileId.replace(/[^a-f0-9]/gi, ''))}`;
}

export const FoundMessage = v.looseObject({
	id: v.optional(v.union([v.string(), v.number()])),
	conversation_id: v.optional(v.string()),
	from_id: v.optional(v.string()),
	from_name: v.optional(v.string()),
	text: v.optional(v.string()),
	created_at: v.optional(v.union([v.string(), v.number()])),
	timestamp: v.optional(v.union([v.string(), v.number()]))
});
export type FoundMessage = v.InferOutput<typeof FoundMessage>;

export function searchChat(q: string, signal?: AbortSignal): Promise<FoundMessage[]> {
	return api(
		v.pipe(
			v.looseObject({ messages: v.optional(v.array(FoundMessage)) }),
			v.transform((o) => o.messages ?? [])
		),
		'/api/chat/search',
		{ query: { q }, signal }
	);
}

const AvatarEntry = v.looseObject({
	id: v.union([v.number(), v.string()]),
	username: v.optional(v.nullable(v.string())),
	avatar_version: v.optional(v.nullable(v.union([v.string(), v.number()])))
});
export type AvatarEntry = v.InferOutput<typeof AvatarEntry>;

/** Console users with a profile picture */
export function listAvatars(): Promise<AvatarEntry[]> {
	return api(
		v.pipe(
			wrapped(v.looseObject({ users: v.optional(v.array(AvatarEntry)) })),
			v.transform((d) => d.users ?? [])
		),
		'/api/users/avatars'
	);
}
