import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
	type QueryCtx,
} from './_generated/server'

declare const process: { env: Record<string, string | undefined> }

const USER_ID =/^\d{15,25}$/
const EFFECT_NAME = /^[a-z0-9_-]{1,32}$/

function checkKey(key: string) {
	const expected = process.env.API_KEY
	if (!expected || key !== expected) throw new ConvexError('bad api key')
}

function checkUser(userId: string) {
	if (!USER_ID.test(userId)) throw new ConvexError('bad user id')
}

function checkName(name: string) {
	if (!EFFECT_NAME.test(name)) throw new ConvexError('bad effect name')
}

function serialize(effects: Doc<'effects'>[]) {
	const now = Date.now()
	const out: Record<
		string,
		{ created_at: number; expires_at: number | null; details: unknown }
	> = {}
	for (const e of effects) {
		if (e.expiresAt !== null && e.expiresAt <= now) continue
		out[e.name] = {
			created_at: e.createdAt / 1000,
			expires_at: e.expiresAt === null ? null : e.expiresAt / 1000,
			details: e.details,
		}
	}
	return out
}

async function effectsOf(ctx: QueryCtx, userId: string) {
	return ctx.db
		.query('effects')
		.withIndex('by_user', q => q.eq('userId', userId))
		.collect()
}

export const forUser = query({
	args: { userId: v.string() },
	handler: async (ctx, { userId }) => {
		checkUser(userId)
		return serialize(await effectsOf(ctx, userId))
	},
})

export const forUserInternal = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, { userId }) => serialize(await effectsOf(ctx, userId)),
})

export const set = mutation({
	args: {
		key: v.string(),
		userId: v.string(),
		name: v.string(),
		details: v.optional(v.any()),
		duration: v.optional(v.union(v.number(), v.null())),
	},
	handler: async (ctx, { key, userId, name, details, duration }) => {
		checkKey(key)
		checkUser(userId)
		checkName(name)
		if (duration != null && !(duration > 0))
			throw new ConvexError('duration must be positive')

		const now = Date.now()
		const expiresAt = duration != null ? now + duration * 1000 : null

		const existing = await ctx.db
			.query('effects')
			.withIndex('by_user_name', q => q.eq('userId', userId).eq('name', name))
			.unique()
		if (existing?.expiryJob) await ctx.scheduler.cancel(existing.expiryJob)

		const fields = { userId, name, details: details ?? {}, createdAt: now, expiresAt }
		const id = existing
			? (await ctx.db.replace(existing._id, fields), existing._id)
			: await ctx.db.insert('effects', fields)

		if (expiresAt !== null) {
			const expiryJob = await ctx.scheduler.runAt(expiresAt, internal.effects.expire, {
				id,
			})
			await ctx.db.patch(id, { expiryJob })
		}
	},
})

export const remove = mutation({
	args: { key: v.string(), userId: v.string(), name: v.string() },
	handler: async (ctx, { key, userId, name }) => {
		checkKey(key)
		const existing = await ctx.db
			.query('effects')
			.withIndex('by_user_name', q => q.eq('userId', userId).eq('name', name))
			.unique()
		if (!existing) return false
		if (existing.expiryJob) await ctx.scheduler.cancel(existing.expiryJob)
		await ctx.db.delete(existing._id)
		return true
	},
})

export const clear = mutation({
	args: { key: v.string(), userId: v.string() },
	handler: async (ctx, { key, userId }) => {
		checkKey(key)
		const effects = await effectsOf(ctx, userId)
		for (const e of effects) {
			if (e.expiryJob) await ctx.scheduler.cancel(e.expiryJob)
			await ctx.db.delete(e._id)
		}
		return effects.length
	},
})

export const expire = internalMutation({
	args: { id: v.id('effects') },
	handler: async (ctx, { id }) => {
		const effect = await ctx.db.get(id)
		if (effect?.expiresAt != null && effect.expiresAt <= Date.now())
			await ctx.db.delete(id)
	},
})
