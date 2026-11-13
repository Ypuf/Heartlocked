import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
	effects: defineTable({
		userId: v.string(),
		name: v.string(),
		details: v.any(),
		createdAt: v.number(),
		expiresAt: v.union(v.number(), v.null()),
		expiryJob: v.optional(v.id('_scheduled_functions')),
	})
		.index('by_user', ['userId'])
		.index('by_user_name', ['userId', 'name']),
})
