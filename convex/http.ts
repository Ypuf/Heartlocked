import { httpRouter } from 'convex/server'
import { internal } from './_generated/api'
import { httpAction } from './_generated/server'

const http = httpRouter()

http.route({
	pathPrefix: '/users/',
	method: 'GET',
	handler: httpAction(async (ctx, req) => {
		const userId = new URL(req.url).pathname.slice('/users/'.length)
		if (!/^\d{15,25}$/.test(userId)) return new Response('bad user id', { status: 400 })
		const effects = await ctx.runQuery(internal.effects.forUserInternal, { userId })
		return Response.json(effects)
	}),
})

export default http
